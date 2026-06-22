const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const crypto = require('crypto');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const ORDINALS_API = 'https://ordinals.com';
const MAX_TIMESTAMP_DRIFT_SECONDS = 10 * 60;

function authError(status, error) {
  return { ok: false, status, error };
}

function cleanAction(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanWallet(value) {
  return String(value || '').trim();
}

function normalizeOptionalPart(value) {
  return value === undefined || value === null ? '' : String(value);
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = parseInt(String(value).replace(/^#/, ''), 10);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function nonceStoreMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*auth_nonces/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function sessionStoreMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*auth_sessions/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

async function maybeCleanExpiredNonces() {
  if (Math.random() > 0.02) return;
  try {
    await supabase
      .from('auth_nonces')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch (_) {
    // Cleanup is best-effort; auth must not depend on it.
  }
}

async function consumeNonce({ nonce, wallet, action }) {
  const { data, error } = await supabase
    .from('auth_nonces')
    .update({ used: true })
    .eq('nonce', nonce)
    .eq('wallet', wallet)
    .eq('action', action)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .select('nonce');

  if (nonceStoreMissing(error)) return authError(503, 'Auth nonce table is not installed');
  if (error) {
    console.error('Auth nonce consume error:', error);
    return authError(500, 'Auth store error');
  }
  if (!data || data.length === 0) {
    return authError(401, 'Invalid, expired, or already-used challenge');
  }
  return { ok: true };
}

async function activeRegistrationForWallet(wallet) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('wallet_address', wallet)
    .eq('status', 'active')
    .order('inscription_num', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Auth registration lookup error:', error);
    return { error: authError(500, 'Auth registration lookup failed') };
  }
  return { data };
}

async function currentOwnerFor(inscriptionId) {
  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenNum-Auth/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!ordRes.ok) return { owner: null, verified: false };
    const raw = await ordRes.json();
    return { owner: raw.address || null, verified: !!raw.address };
  } catch (e) {
    console.warn('ordinals.com unreachable during auth ownership check:', e.message);
    return { owner: null, verified: false };
  }
}

async function verifyAction({
  wallet,
  action,
  actor_num,
  target,
  ts,
  nonce,
  signature,
  requireActiveId = true,
  requireOwnership = false
}) {
  const cleanWalletValue = cleanWallet(wallet);
  const cleanActionValue = cleanAction(action);

  if (!cleanWalletValue || !cleanActionValue || !ts || !nonce || !signature) {
    return authError(400, 'Missing auth fields');
  }
  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber) || Math.abs(Date.now() / 1000 - tsNumber) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return authError(400, 'Challenge timestamp expired');
  }

  await maybeCleanExpiredNonces();

  const consumed = await consumeNonce({
    nonce,
    wallet: cleanWalletValue,
    action: cleanActionValue
  });
  if (!consumed.ok) return consumed;

  const actorPart = normalizeOptionalPart(actor_num);
  const targetPart = normalizeOptionalPart(target);
  const message = `opennum:${cleanActionValue}:${actorPart}:${targetPart}:${ts}:${nonce}`;
  let valid = false;
  try {
    valid = Verifier.verifySignature(cleanWalletValue, message, signature);
  } catch (_) {
    valid = false;
  }
  if (!valid) return authError(401, 'Invalid signature');

  let actorRegistration = null;
  if (requireActiveId || requireOwnership) {
    const result = await activeRegistrationForWallet(cleanWalletValue);
    if (result.error) return result.error;
    actorRegistration = result.data || null;

    if (requireActiveId && !actorRegistration) {
      return authError(403, 'No active OpenNum for this wallet');
    }

    const requestedActorNum = normalizeNumber(actor_num);
    if (actorRegistration && requestedActorNum !== null && Number(actorRegistration.inscription_num) !== requestedActorNum) {
      return authError(403, 'Actor number does not belong to this wallet');
    }
  }

  if (requireOwnership) {
    const inscriptionId = actorRegistration?.inscription_id ||
      (actorRegistration?.inscription_txid ? `${actorRegistration.inscription_txid}i0` : null);
    if (!inscriptionId) return authError(400, 'No inscription available for ownership check');

    const ownership = await currentOwnerFor(inscriptionId);
    if (ownership.verified && ownership.owner && ownership.owner !== cleanWalletValue) {
      return authError(409, 'This inscription has moved on-chain and must be claimed first');
    }
  }

  return {
    ok: true,
    actor_registration: actorRegistration,
    signed_message: message
  };
}

async function issueSession({ wallet, actor_num }) {
  const cleanWalletValue = cleanWallet(wallet);
  const actorNum = normalizeNumber(actor_num);
  if (!cleanWalletValue || actorNum === null) return authError(400, 'Missing session fields');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('auth_sessions')
    .insert({
      token,
      wallet: cleanWalletValue,
      actor_num: actorNum,
      expires_at: expiresAt
    });

  if (sessionStoreMissing(error)) return authError(503, 'Auth session table is not installed');
  if (error) {
    console.error('Auth session insert error:', error);
    return authError(500, 'Auth session store error');
  }
  return { ok: true, token, expires_at: expiresAt };
}

async function verifySession({ wallet, actor_num, token }) {
  const cleanWalletValue = cleanWallet(wallet);
  const actorNum = normalizeNumber(actor_num);
  const cleanToken = String(token || '').trim();
  if (!cleanWalletValue || actorNum === null || !cleanToken) {
    return authError(401, 'Invalid or expired session');
  }

  const { data, error } = await supabase
    .from('auth_sessions')
    .select('token, wallet, actor_num, expires_at, revoked')
    .eq('token', cleanToken)
    .maybeSingle();

  if (sessionStoreMissing(error)) return authError(503, 'Auth session table is not installed');
  if (error) {
    console.error('Auth session lookup error:', error);
    return authError(500, 'Auth session store error');
  }
  if (!data || data.revoked || new Date(data.expires_at).getTime() <= Date.now()) {
    return authError(401, 'Invalid or expired session');
  }
  if (data.wallet !== cleanWalletValue || Number(data.actor_num) !== actorNum) {
    return authError(401, 'Invalid or expired session');
  }
  return { ok: true, actor_num: actorNum, wallet: cleanWalletValue };
}

module.exports = { verifyAction, issueSession, verifySession };
