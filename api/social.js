const { createClient } = require('@supabase/supabase-js');
const { setCors, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { verifyAction } = require('../lib/_auth');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function cleanAction(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNumber(raw) {
  const num = parseInt(String(raw || '').replace(/^#/, ''), 10);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function tableMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*(guestbook|holder_periods)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

async function currentHolderPeriodFor(num) {
  const { data, error } = await supabase
    .from('holder_periods')
    .select('id')
    .eq('inscription_num', num)
    .eq('is_current', true)
    .maybeSingle();

  if (tableMissing(error)) return { id: null, error: 'holder_periods table is not installed' };
  if (error) {
    console.error('Social holder period lookup error:', error);
    return { id: null, error: 'Database error' };
  }
  return { id: data?.id || null };
}

async function loadMessage(messageId) {
  const { data, error } = await supabase
    .from('guestbook')
    .select('id, inscription_num, holder_period_id, author_wallet, author_number, status')
    .eq('id', messageId)
    .maybeSingle();

  if (tableMissing(error)) return { error: { status: 503, message: 'Guestbook table is not installed yet.' } };
  if (error) {
    console.error('Social message lookup error:', error);
    return { error: { status: 500, message: 'Database error' } };
  }
  if (!data) return { error: { status: 404, message: 'Message not found' } };
  return { data };
}

async function updateMessageStatus(messageId, status) {
  const { data, error } = await supabase
    .from('guestbook')
    .update({
      status,
      status_changed_at: new Date().toISOString()
    })
    .eq('id', messageId)
    .select('id, inscription_num, holder_period_id, status, status_changed_at')
    .single();

  if (error) {
    console.error('Social message status update error:', error);
    return { error: { status: 500, message: 'Could not update message status' } };
  }
  return { data };
}

async function handleWithdraw(req, res, body) {
  const { wallet, signature, ts, timestamp, nonce, message_id, actor_num } = body;
  const actorNum = normalizeNumber(actor_num);
  if (!wallet || !signature || !(ts || timestamp) || !nonce || !message_id || actorNum === null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const auth = await verifyAction({
    wallet,
    action: 'message_withdraw',
    actor_num: actorNum,
    target: message_id,
    ts: ts || timestamp,
    nonce,
    signature,
    requireActiveId: true,
    requireOwnership: false
  });
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'Authentication failed' });

  const { data: message, error } = await loadMessage(message_id);
  if (error) return res.status(error.status).json({ error: error.message });
  if (message.author_wallet !== wallet) {
    return res.status(403).json({ error: 'Only the message author can withdraw this message' });
  }

  const result = await updateMessageStatus(message_id, 'withdrawn_by_author');
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  return res.status(200).json({ success: true, message: result.data });
}

async function handleHide(req, res, body) {
  const { wallet, signature, ts, timestamp, nonce, message_id, owner_num } = body;
  const ownerNum = normalizeNumber(owner_num);
  if (!wallet || !signature || !(ts || timestamp) || !nonce || !message_id || ownerNum === null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const auth = await verifyAction({
    wallet,
    action: 'message_hide',
    actor_num: ownerNum,
    target: message_id,
    ts: ts || timestamp,
    nonce,
    signature,
    requireActiveId: true,
    requireOwnership: false
  });
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'Authentication failed' });

  const { data: message, error } = await loadMessage(message_id);
  if (error) return res.status(error.status).json({ error: error.message });
  if (Number(message.inscription_num) !== ownerNum) {
    return res.status(403).json({ error: 'Owner number does not match message profile' });
  }

  const { data: registration, error: registrationError } = await supabase
    .from('registrations')
    .select('id, inscription_num, wallet_address, status')
    .eq('inscription_num', ownerNum)
    .eq('status', 'active')
    .maybeSingle();

  if (registrationError) {
    console.error('Social profile owner lookup error:', registrationError);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!registration || registration.wallet_address !== wallet) {
    return res.status(403).json({ error: 'Only the current profile owner can hide this message' });
  }

  const currentPeriod = await currentHolderPeriodFor(ownerNum);
  if (currentPeriod.error) return res.status(503).json({ error: currentPeriod.error });
  if (!currentPeriod.id || Number(message.holder_period_id) !== Number(currentPeriod.id)) {
    return res.status(409).json({ error: 'Archived-period messages cannot be hidden by the current holder' });
  }

  const result = await updateMessageStatus(message_id, 'hidden_by_profile_owner');
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  return res.status(200).json({ success: true, message: result.data });
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rate = checkRateLimit(req, 'social', 30, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const body = req.body || {};
  const action = cleanAction(body.action);

  if (action === 'message_withdraw') return handleWithdraw(req, res, body);
  if (action === 'message_hide') return handleHide(req, res, body);

  return res.status(400).json({ error: 'Unknown social action' });
};
