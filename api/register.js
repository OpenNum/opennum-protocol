const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, sanitizeText, sanitizeUrl, sanitizeLinks, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { closeCurrentHolderPeriod, ensureHolderPeriodAndProfileVersion } = require('../lib/_ownership');
const { emitEvent } = require('../lib/_activity');
const { resolveCollections } = require('../lib/_collections');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const ORDINALS_API = 'https://ordinals.com';
const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;

function stripMarketFields(payload) {
  delete payload.for_sale;
  delete payload.ask_note;
  delete payload.satflow_url;
}

function isMissingMarketColumn(error) {
  return /(for_sale|ask_note|satflow_url)/i.test(error?.message || '');
}

async function activeRegistrationForWallet(wallet) {
  const { data, error } = await supabase
    .from('registrations')
    .select('id, inscription_num, wallet_address, status')
    .eq('wallet_address', wallet)
    .eq('status', 'active')
    .order('inscription_num', { ascending: true })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rate = checkRateLimit(req, 'register', 10, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, inscription_txid, inscription_id, wallet, signature, timestamp, display_name, links, for_sale, ask_note, satflow_url } = req.body || {};

  if (!inscription_num && inscription_num !== 0 || !inscription_txid || !wallet || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, inscription_txid, wallet, signature, timestamp' });
  }
  if (!Number.isInteger(inscription_num)) {
    return res.status(400).json({ error: 'inscription_num must be an integer' });
  }
  if (!/^[0-9a-f]{64}$/i.test(inscription_txid)) {
    return res.status(400).json({ error: 'inscription_txid must be a 64-character hex string' });
  }
  if (inscription_id && !/^[0-9a-f]{64}i\d+$/i.test(inscription_id)) {
    return res.status(400).json({ error: 'inscription_id must use the format <64-character-txid>i<index>' });
  }
  if (inscription_id && !inscription_id.toLowerCase().startsWith(inscription_txid.toLowerCase() + 'i')) {
    return res.status(400).json({ error: 'inscription_id does not match inscription_txid' });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  // Verify inscription ownership via ordinals.com (JSON API)
  // If indexer is unreachable, fall through — signature is the primary proof.
  let ownershipVerified = false;
  try {
    const inscriptionId = inscription_id || `${inscription_txid}i0`;
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenNum-Indexer/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (ordRes.ok) {
      const data = await ordRes.json();
      if (data.address && data.address !== wallet) {
        return res.status(403).json({
          error: `Wallet does not own this inscription. Current owner: ${data.address.slice(0, 12)}...`
        });
      }
      if (data.number !== undefined && data.number !== inscription_num) {
        return res.status(400).json({
          error: `Inscription number mismatch. Txid belongs to #${data.number}, not #${inscription_num}.`
        });
      }
      ownershipVerified = true;
    } else {
      // Indexer returned error — log and continue; signature is sufficient for MVP
      console.warn(`ordinals.com returned ${ordRes.status} for ${inscriptionId} — skipping ownership check`);
    }
  } catch (e) {
    // Indexer timeout or network error — log and continue
    console.warn('ordinals.com unreachable:', e.message);
  }

  // Verify secp256k1 signature (BIP322: Legacy, SegWit, Taproot)
  const message = `opennum:register:${inscription_num}:${wallet}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(wallet, message, signature);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid signature. Make sure you are signing with the correct wallet.' });
    }
  } catch (e) {
    console.error('Signature verification error:', e && e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { data: activeWalletRegistration, error: walletSelectError } = await activeRegistrationForWallet(wallet);
  if (walletSelectError) {
    console.error('DB wallet select error:', walletSelectError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }

  // Check for existing registration on this number. Inactive rows can be reactivated by the current on-chain owner.
  const { data: existing, error: selectError } = await supabase
    .from('registrations')
    .select('*')
    .eq('inscription_num', inscription_num)
    .order('registered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error('DB select error:', selectError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
  if (existing) {
    if (existing.status === 'active' && existing.wallet_address === wallet) {
      return res.status(409).json({ error: 'This inscription is already registered to your wallet.' });
    }
    if (activeWalletRegistration && activeWalletRegistration.inscription_num !== inscription_num) {
      return res.status(409).json({
        error: `This wallet already has active OpenNum #${activeWalletRegistration.inscription_num}. Unbind it before registering another number.`,
        active_registration: {
          inscription_num: activeWalletRegistration.inscription_num,
          profile_url: `https://opennum.org/n/${activeWalletRegistration.inscription_num}`
        }
      });
    }
    // Inscription is registered to a different wallet, or was previously unbound/dormant.
    // If ordinals.com confirmed the current on-chain owner is the requester,
    // the inscription can be transferred/reactivated.
    if (!ownershipVerified) {
      return res.status(409).json({
        error: 'This inscription number has an existing OpenNum record. On-chain ownership could not be verified — please try again.'
      });
    }
    const oldPeriodId = await closeCurrentHolderPeriod(existing, 'transfer');

    // Verified transfer/reactivation: update existing row and reset the public profile
    // for the new holder (seeded with whatever they provided at claim time).
    const claimDisplayName = sanitizeText(display_name, 48);
    const claimLinks = (links && typeof links === 'object') ? sanitizeLinks(links) : {};
    const updatePayload = {
      inscription_txid,
      inscription_id: inscription_id || `${inscription_txid}i0`,
      wallet_address: wallet,
      signature,
      display_name: claimDisplayName,
      bio: null,
      links: claimLinks,
      for_sale: false,
      ask_note: null,
      satflow_url: null,
      current_owner: wallet,
      owner_checked_at: new Date().toISOString(),
      indexer_ruleset: 'ord-v0.18-mainnet',
      status: 'active',
      updated_at: new Date().toISOString()
    };

    let { error: updateError } = await supabase
      .from('registrations')
      .update(updatePayload)
      .eq('id', existing.id);

    if (updateError && isMissingMarketColumn(updateError)) {
      stripMarketFields(updatePayload);
      ({ error: updateError } = await supabase
        .from('registrations')
        .update(updatePayload)
        .eq('id', existing.id));
    }

    if (updateError && /inscription_id/i.test(updateError.message || '')) {
      delete updatePayload.inscription_id;
      ({ error: updateError } = await supabase
        .from('registrations')
        .update(updatePayload)
        .eq('id', existing.id));
    }

    if (updateError) {
      console.error('DB update error:', updateError);
      return res.status(500).json({ error: 'Transfer failed. Please try again.' });
    }

    const newPeriodId = await ensureHolderPeriodAndProfileVersion({
      inscription_num,
      wallet,
      profile: {
        display_name: claimDisplayName,
        bio: null,
        links: claimLinks,
        for_sale: false,
        ask_note: null,
        satflow_url: null
      },
      start_reason: 'claim'
    });

    await emitEvent({
      event_type: 'new_holder_claimed',
      subject_num: inscription_num,
      holder_period_id: newPeriodId,
      payload: {
        previous_wallet: existing.wallet_address || null,
        previous_holder_period_id: oldPeriodId || null
      }
    });

    // Warm the collection cache so the number joins its circle immediately.
    try { await resolveCollections(updatePayload.inscription_id || `${inscription_txid}i0`, inscription_num); } catch (_) {}

    return res.status(200).json({
      success: true,
      transferred: existing.status === 'active',
      reactivated: existing.status !== 'active',
      inscription_num,
      wallet,
      profile_url: `https://opennum.org/n/${inscription_num}`
    });
  }

  if (activeWalletRegistration) {
    return res.status(409).json({
      error: `This wallet already has active OpenNum #${activeWalletRegistration.inscription_num}. Unbind it before registering another number.`,
      active_registration: {
        inscription_num: activeWalletRegistration.inscription_num,
        profile_url: `https://opennum.org/n/${activeWalletRegistration.inscription_num}`
      }
    });
  }

  const insertPayload = {
    inscription_num,
    inscription_txid,
    inscription_id: inscription_id || `${inscription_txid}i0`,
    wallet_address: wallet,
    signature,
    display_name: sanitizeText(display_name, 48),
    for_sale: !!for_sale,
    ask_note: sanitizeText(ask_note, 240),
    satflow_url: sanitizeUrl(satflow_url),
    indexer_ruleset: 'ord-v0.18-mainnet',
    status: 'active'
  };
  // links is optional — only include if provided (requires DB migration)
  if (links && typeof links === 'object') insertPayload.links = sanitizeLinks(links);

  let { error: insertError } = await supabase
    .from('registrations')
    .insert(insertPayload);

  if (insertError && isMissingMarketColumn(insertError)) {
    stripMarketFields(insertPayload);
    ({ error: insertError } = await supabase
      .from('registrations')
      .insert(insertPayload));
  }

  if (insertError && /inscription_id/i.test(insertError.message || '')) {
    delete insertPayload.inscription_id;
    ({ error: insertError } = await supabase
      .from('registrations')
      .insert(insertPayload));
  }

  if (insertError) {
    console.error('DB insert error:', insertError);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  const periodId = await ensureHolderPeriodAndProfileVersion({
    inscription_num,
    wallet,
    profile: {
      display_name: insertPayload.display_name,
      bio: insertPayload.bio,
      links: insertPayload.links || {},
      for_sale: insertPayload.for_sale,
      ask_note: insertPayload.ask_note,
      satflow_url: insertPayload.satflow_url
    },
    start_reason: 'register'
  });

  await emitEvent({
    event_type: 'number_claimed',
    subject_num: inscription_num,
    holder_period_id: periodId,
    payload: {
      wallet
    }
  });

  // Warm the collection cache so the number joins its circle immediately.
  try { await resolveCollections(insertPayload.inscription_id || `${inscription_txid}i0`, inscription_num); } catch (_) {}

  return res.status(200).json({
    success: true,
    inscription_num,
    wallet,
    profile_url: `https://opennum.org/n/${inscription_num}`
  });
};
