const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, sanitizeText, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { verifyAction, verifySession } = require('../lib/_auth');
const { emitEvent } = require('../lib/_activity');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 280;
const ORDINALS_API = 'https://ordinals.com';

function normalizeNumber(raw) {
  const num = parseInt(String(raw || '').replace(/^#/, ''), 10);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function tableMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*(guestbook|holder_periods|blocks)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function missingGuestbookColumn(error) {
  return error && /(holder_period_id|status|status_changed_at)/i.test(error.message || '');
}

async function currentHolderPeriodFor(num) {
  const { data, error } = await supabase
    .from('holder_periods')
    .select('id')
    .eq('inscription_num', num)
    .eq('is_current', true)
    .maybeSingle();

  if (tableMissing(error)) {
    console.warn('holder_periods table is not installed; guestbook period binding skipped');
    return null;
  }
  if (error) {
    console.warn('Current holder period lookup failed:', error.message);
    return null;
  }
  return data?.id || null;
}

async function isBlockedByProfile(profileNum, authorNum) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_num', profileNum)
    .eq('blocked_num', authorNum)
    .limit(1);

  if (tableMissing(error)) {
    console.warn('blocks table is not installed; guestbook block check skipped');
    return false;
  }
  if (error) {
    console.warn('Guestbook block check failed:', error.message);
    return false;
  }
  return !!(data && data.length);
}

async function currentOwnerFor(inscriptionId) {
  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!ordRes.ok) return { owner: null, verified: false };
    const raw = await ordRes.json();
    return { owner: raw.address || null, verified: !!raw.address };
  } catch (_) {
    return { owner: null, verified: false };
  }
}

async function isRegistrationDormant(registration) {
  const inscriptionId = registration.inscription_id || (registration.inscription_txid ? `${registration.inscription_txid}i0` : null);
  if (!inscriptionId) return false;
  const ownership = await currentOwnerFor(inscriptionId);
  return !!(ownership.verified && ownership.owner && ownership.owner !== registration.wallet_address);
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    const num = normalizeNumber(req.query.num || req.query.number);
    if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });

    const currentHolderPeriodId = await currentHolderPeriodFor(num);

    let { data, error } = await supabase
      .from('guestbook')
      .select('id, inscription_num, parent_id, holder_period_id, status, status_changed_at, message, author_wallet, author_number, created_at')
      .eq('inscription_num', num)
      .order('created_at', { ascending: false })
      .limit(50);

    if (missingGuestbookColumn(error)) {
      ({ data, error } = await supabase
        .from('guestbook')
        .select('id, inscription_num, parent_id, message, author_wallet, author_number, created_at')
        .eq('inscription_num', num)
        .order('created_at', { ascending: false })
        .limit(50));
    }

    if (tableMissing(error)) {
      return res.status(200).json({ inscription_num: num, current_holder_period_id: currentHolderPeriodId, messages: [], current: [], archived: [], setup_required: true });
    }
    if (error) {
      console.error('Guestbook DB error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    const messages = data || [];
    const authorNumbers = [...new Set(
      messages
        .map((message) => Number(message.author_number))
        .filter(Number.isInteger)
    )];
    let authorInscriptions = new Map();

    if (authorNumbers.length) {
      const { data: authors, error: authorError } = await supabase
        .from('registrations')
        .select('inscription_num, inscription_id, inscription_txid')
        .in('inscription_num', authorNumbers)
        .eq('status', 'active');
      if (!authorError) {
        authorInscriptions = new Map((authors || []).map((author) => [
          Number(author.inscription_num),
          author.inscription_id || (author.inscription_txid ? `${author.inscription_txid}i0` : null)
        ]));
      }
    }

    const enrichedMessages = messages.map((message) => ({
      ...message,
      holder_period_id: message.holder_period_id || null,
      status: message.status || 'active',
      status_changed_at: message.status_changed_at || null,
      is_current_period: currentHolderPeriodId ? Number(message.holder_period_id) === Number(currentHolderPeriodId) : true,
      author_inscription_id: authorInscriptions.get(Number(message.author_number)) || null
    }));

    return res.status(200).json({
      inscription_num: num,
      current_holder_period_id: currentHolderPeriodId,
      messages: enrichedMessages,
      current: enrichedMessages.filter((message) => message.is_current_period),
      archived: enrichedMessages.filter((message) => !message.is_current_period)
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rate = checkRateLimit(req, 'guestbook', 30, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, parent_id, author_wallet, message, signature, timestamp, nonce, actor_num, author_number, session_token } = req.body || {};
  const num = normalizeNumber(inscription_num);
  const rawMessage = String(message || '').trim();
  const cleanMessage = sanitizeText(rawMessage, MAX_MESSAGE_LENGTH);

  if (num === null || !author_wallet || !rawMessage || !cleanMessage) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, author_wallet, message' });
  }
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  let signedMessage = `opennum:guestbook:${num}:${author_wallet}:${rawMessage}:${timestamp}`;
  let authorNumber = null;
  let author = null;
  let sessionVerified = false;

  const sessionActorNum = normalizeNumber(actor_num ?? author_number);
  if (session_token && sessionActorNum !== null) {
    const session = await verifySession({
      wallet: author_wallet,
      actor_num: sessionActorNum,
      token: session_token
    });
    if (session.ok) {
      sessionVerified = true;
      authorNumber = sessionActorNum;
      signedMessage = `opennum:guestbook:${num}:${author_wallet}:session:${sessionActorNum}`;
    }
    // Invalid/expired/missing session store deliberately falls through to signature auth.
  }

  if (!sessionVerified && (!signature || !timestamp)) {
    return res.status(400).json({ error: 'Missing required fields: signature, timestamp' });
  }

  if (!sessionVerified && Math.abs(Date.now() - Number(timestamp) * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  if (!sessionVerified && nonce) {
    const actorNum = normalizeNumber(actor_num ?? author_number);
    if (actorNum === null) {
      return res.status(400).json({ error: 'Missing or invalid actor_num for nonce guestbook auth' });
    }

    const auth = await verifyAction({
      wallet: author_wallet,
      action: 'guestbook',
      actor_num: actorNum,
      target: num,
      ts: timestamp,
      nonce,
      signature,
      requireActiveId: true,
      requireOwnership: false
    });
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'Authentication failed' });

    author = auth.actor_registration;
    authorNumber = Number(author.inscription_num);
    signedMessage = auth.signed_message;
  } else if (!sessionVerified) {
    try {
      const valid = Verifier.verifySignature(author_wallet, signedMessage, signature);
      if (!valid) return res.status(400).json({ error: 'Invalid signature' });
    } catch (e) {
      console.error('Signature verification error:', e && e.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  const { data: target, error: targetError } = await supabase
    .from('registrations')
    .select('*')
    .eq('inscription_num', num)
    .eq('status', 'active')
    .maybeSingle();

  if (targetError) {
    console.error('Guestbook target lookup error:', targetError);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!target) return res.status(404).json({ error: 'This OpenNum identity is not registered yet' });
  if (await isRegistrationDormant(target)) {
    return res.status(409).json({ error: 'This OpenNum is dormant after an on-chain transfer and must be claimed before messages can be posted.' });
  }

  if (!author) {
    const { data: authorData } = await supabase
      .from('registrations')
      .select('*')
      .eq('wallet_address', author_wallet)
      .eq('status', 'active')
      .order('registered_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    author = authorData;
    if (author && (!sessionVerified || Number(author.inscription_num) === Number(authorNumber))) {
      authorNumber = author.inscription_num;
    } else if (sessionVerified) {
      author = null;
      authorNumber = null;
    }
  }
  if (!authorNumber) {
    return res.status(403).json({ error: 'You need an active OpenNum ID before you can leave public messages.' });
  }
  if (await isRegistrationDormant(author)) {
    return res.status(403).json({ error: 'Your OpenNum ID is dormant after an on-chain transfer. Claim an active ID before posting.' });
  }
  if (await isBlockedByProfile(num, Number(authorNumber))) {
    return res.status(403).json({ error: 'You have been blocked by this profile.' });
  }

  const targetHolderPeriodId = await currentHolderPeriodFor(num);

  if (parent_id) {
    const { data: parentMsg, error: parentError } = await supabase
      .from('guestbook')
      .select('id, inscription_num')
      .eq('id', parent_id)
      .maybeSingle();
    if (tableMissing(parentError)) {
      return res.status(503).json({ error: 'Guestbook table is not installed yet. Run the Supabase migration in docs/database.md.' });
    }
    if (parentError) {
      console.error('Guestbook parent lookup error:', parentError);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!parentMsg || parentMsg.inscription_num !== num) {
      return res.status(400).json({ error: 'Invalid reply target.' });
    }
  }

  const insertPayload = {
    inscription_num: num,
    parent_id: parent_id || null,
    holder_period_id: targetHolderPeriodId,
    status: 'active',
    message: cleanMessage,
    author_wallet,
    author_number: authorNumber,
    signature,
    signed_message: signedMessage
  };

  let { data, error } = await supabase
    .from('guestbook')
    .insert(insertPayload)
    .select('id, inscription_num, parent_id, holder_period_id, status, status_changed_at, message, author_wallet, author_number, created_at')
    .single();

  if (missingGuestbookColumn(error)) {
    delete insertPayload.holder_period_id;
    delete insertPayload.status;
    ({ data, error } = await supabase
      .from('guestbook')
      .insert(insertPayload)
      .select('id, inscription_num, parent_id, message, author_wallet, author_number, created_at')
      .single());
  }

  if (tableMissing(error)) {
    return res.status(503).json({ error: 'Guestbook table is not installed yet. Run the Supabase migration in docs/database.md.' });
  }
  if (error) {
    console.error('Guestbook insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  await emitEvent({
    event_type: 'public_message_received',
    subject_num: num,
    actor_num: Number(authorNumber),
    holder_period_id: data.holder_period_id || targetHolderPeriodId || null,
    payload: {
      message_id: data.id,
      parent_id: data.parent_id || null
    }
  });

  return res.status(200).json({
    success: true,
    message: {
      ...data,
      holder_period_id: data.holder_period_id || null,
      status: data.status || 'active',
      status_changed_at: data.status_changed_at || null
    }
  });
};
