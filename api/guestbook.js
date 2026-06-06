const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, sanitizeText, checkRateLimit, sendRateLimit } = require('./_security');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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
    /relation .*guestbook/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
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

    const { data, error } = await supabase
      .from('guestbook')
      .select('id, inscription_num, parent_id, message, author_wallet, author_number, created_at')
      .eq('inscription_num', num)
      .order('created_at', { ascending: false })
      .limit(50);

    if (tableMissing(error)) {
      return res.status(200).json({ inscription_num: num, messages: [], setup_required: true });
    }
    if (error) {
      console.error('Guestbook DB error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ inscription_num: num, messages: data || [] });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rate = checkRateLimit(req, 'guestbook', 30, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, parent_id, author_wallet, message, signature, timestamp } = req.body || {};
  const num = normalizeNumber(inscription_num);
  const rawMessage = String(message || '').trim();
  const cleanMessage = sanitizeText(rawMessage, MAX_MESSAGE_LENGTH);

  if (num === null || !author_wallet || !rawMessage || !cleanMessage || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, author_wallet, message, signature, timestamp' });
  }
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  const signedMessage = `opennum:guestbook:${num}:${author_wallet}:${rawMessage}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(author_wallet, signedMessage, signature);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  } catch (e) {
    return res.status(400).json({ error: 'Signature verification failed: ' + e.message });
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

  let authorNumber = null;
  const { data: author } = await supabase
    .from('registrations')
    .select('*')
    .eq('wallet_address', author_wallet)
    .eq('status', 'active')
    .order('registered_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (author) authorNumber = author.inscription_num;
  if (!authorNumber) {
    return res.status(403).json({ error: 'You need an active OpenNum ID before you can leave public messages.' });
  }
  if (await isRegistrationDormant(author)) {
    return res.status(403).json({ error: 'Your OpenNum ID is dormant after an on-chain transfer. Claim an active ID before posting.' });
  }

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

  const { data, error } = await supabase
    .from('guestbook')
    .insert({
      inscription_num: num,
      parent_id: parent_id || null,
      message: cleanMessage,
      author_wallet,
      author_number: authorNumber,
      signature,
      signed_message: signedMessage
    })
    .select('id, inscription_num, parent_id, message, author_wallet, author_number, created_at')
    .single();

  if (tableMissing(error)) {
    return res.status(503).json({ error: 'Guestbook table is not installed yet. Run the Supabase migration in docs/database.md.' });
  }
  if (error) {
    console.error('Guestbook insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ success: true, message: data });
};
