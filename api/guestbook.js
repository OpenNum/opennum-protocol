const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 280;

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  const { inscription_num, parent_id, author_wallet, message, signature, timestamp } = req.body || {};
  const num = normalizeNumber(inscription_num);
  const cleanMessage = String(message || '').trim();

  if (num === null || !author_wallet || !cleanMessage || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, author_wallet, message, signature, timestamp' });
  }
  if (cleanMessage.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  const signedMessage = `opennum:guestbook:${num}:${author_wallet}:${cleanMessage}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(author_wallet, signedMessage, signature);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  } catch (e) {
    return res.status(400).json({ error: 'Signature verification failed: ' + e.message });
  }

  const { data: target, error: targetError } = await supabase
    .from('registrations')
    .select('inscription_num')
    .eq('inscription_num', num)
    .eq('status', 'active')
    .maybeSingle();

  if (targetError) {
    console.error('Guestbook target lookup error:', targetError);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!target) return res.status(404).json({ error: 'This OpenNum identity is not registered yet' });

  let authorNumber = null;
  const { data: author } = await supabase
    .from('registrations')
    .select('inscription_num')
    .eq('wallet_address', author_wallet)
    .eq('status', 'active')
    .order('registered_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (author) authorNumber = author.inscription_num;

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
