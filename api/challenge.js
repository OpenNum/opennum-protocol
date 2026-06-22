const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { setCors, checkRateLimit, sendRateLimit } = require('../lib/_security');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const NONCE_TTL_MS = 10 * 60 * 1000;
const ACTIONS = new Set([
  'register',
  'session',
  'update',
  'unbind',
  'guestbook',
  'message',
  'message_withdraw',
  'message_hide',
  'follow',
  'unfollow',
  'watch',
  'unwatch',
  'watchlist_add',
  'watchlist_remove',
  'watchlist_list',
  'block',
  'unblock',
  'report',
  'claim',
  'offer',
  'offer_list',
  'offer_status',
  'inbox'
]);

function cleanWallet(value) {
  return String(value || '').trim();
}

function cleanAction(value) {
  return String(value || '').trim().toLowerCase();
}

function tableMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*auth_nonces/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rate = checkRateLimit(req, 'challenge', 60, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const wallet = cleanWallet(req.body?.wallet);
  const action = cleanAction(req.body?.action);

  if (!wallet || !action) {
    return res.status(400).json({ error: 'Missing required fields: wallet, action' });
  }
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Unsupported challenge action' });
  }
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  const { error } = await supabase
    .from('auth_nonces')
    .insert({
      nonce,
      wallet,
      action,
      expires_at: expiresAt
    });

  if (tableMissing(error)) {
    return res.status(503).json({ error: 'Auth nonce table is not installed yet. Run the Supabase migration in docs/database.md.' });
  }
  if (error) {
    console.error('Challenge nonce insert error:', error);
    return res.status(500).json({ error: 'Could not create challenge. Please try again.' });
  }

  return res.status(200).json({
    nonce,
    wallet,
    action,
    expires_at: expiresAt,
    ttl_seconds: Math.floor(NONCE_TTL_MS / 1000),
    message_template: `opennum:${action}:<actor_num>:<target>:<ts>:${nonce}`
  });
};
