const { createClient } = require('@supabase/supabase-js');
const { setCors, sanitizeText, sanitizeUrl, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { verifyAction } = require('../lib/_auth');
const { emitEvent, isMissingActivityTable } = require('../lib/_activity');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const MAX_WATCHLIST_NOTE_LENGTH = 160;
const MAX_REPORT_REASON_LENGTH = 500;
const MAX_OFFER_PRICE_LENGTH = 80;
const MAX_OFFER_NOTE_LENGTH = 280;
const REPORT_TARGET_TYPES = new Set(['profile', 'message', 'number']);
const OFFER_STATUS_VALUES = new Set(['archived', 'rejected']);
const INBOX_OWN_EVENTS = ['public_message_received', 'followed', 'offer_received'];
const INBOX_WATCH_EVENTS = ['ownership_transferred', 'marked_for_sale'];

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
    /relation .*(guestbook|holder_periods|follows|number_watches|watchlist_items|blocks|reports|private_offers)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function missingRelationshipTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*(follows|number_watches|watchlist_items|blocks|reports|private_offers)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function normalizeTargetId(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function actionTargetFor(body, fallbackField = 'target_num') {
  return normalizeNumber(body[fallbackField] ?? body.target_num ?? body.target);
}

function normalizeOfferId(raw) {
  const id = parseInt(String(raw || '').trim(), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeLimit(raw, fallback = 50) {
  const limit = parseInt(String(raw || ''), 10);
  if (!Number.isInteger(limit) || limit <= 0) return fallback;
  return Math.min(limit, 50);
}

function normalizeOffset(raw) {
  const offset = parseInt(String(raw || ''), 10);
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

async function verifySocialAction({ body, action, actorNum, target }) {
  const { wallet, signature, ts, timestamp, nonce } = body;
  if (!wallet || !signature || !(ts || timestamp) || !nonce || actorNum === null) {
    return { error: { status: 400, message: 'Missing required fields' } };
  }

  const auth = await verifyAction({
    wallet,
    action,
    actor_num: actorNum,
    target,
    ts: ts || timestamp,
    nonce,
    signature,
    requireActiveId: true,
    requireOwnership: false
  });
  if (!auth.ok) {
    return { error: { status: auth.status || 401, message: auth.error || 'Authentication failed' } };
  }
  return { auth, wallet: auth.actor_registration?.wallet_address || String(wallet || '').trim() };
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

async function activeRegistrationForNumber(num) {
  const { data, error } = await supabase
    .from('registrations')
    .select('id, inscription_num, wallet_address, status')
    .eq('inscription_num', num)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    console.error('Social target registration lookup error:', error);
    return { error: { status: 500, message: 'Database error' } };
  }
  if (!data) return { error: { status: 404, message: 'Target OpenNum is not active' } };
  return { data };
}

async function currentOwnerContext(num, wallet) {
  const registration = await activeRegistrationForNumber(num);
  if (registration.error) return registration;
  if (registration.data.wallet_address !== wallet) {
    return { error: { status: 403, message: 'Only the current holder can perform this action' } };
  }

  const currentPeriod = await currentHolderPeriodFor(num);
  if (currentPeriod.error) return { error: { status: 503, message: currentPeriod.error } };
  if (!currentPeriod.id) return { error: { status: 409, message: 'Current holder period is not ready yet' } };

  return {
    registration: registration.data,
    period_id: currentPeriod.id
  };
}

async function isBlocked({ blockerNum, blockedNum }) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_num', blockerNum)
    .eq('blocked_num', blockedNum)
    .limit(1);

  if (missingRelationshipTable(error)) return false;
  if (error) {
    console.warn('Social block lookup failed:', error.message);
    return false;
  }
  return !!(data && data.length);
}

async function handleFeed(req, res) {
  const num = normalizeNumber(req.query.num || req.query.number);
  if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });

  const limit = normalizeLimit(req.query.limit, 50);
  const offset = normalizeOffset(req.query.offset);
  const from = offset;
  const to = offset + limit - 1;

  const { data, error } = await supabase
    .from('activity_events')
    .select('id, event_type, subject_num, actor_num, holder_period_id, visibility, payload, created_at')
    .eq('subject_num', num)
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (isMissingActivityTable(error)) {
    return res.status(200).json({ success: true, num, events: [], setup_required: true });
  }
  if (error) {
    console.error('Social feed lookup error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({
    success: true,
    num,
    limit,
    offset,
    events: data || []
  });
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

async function insertActiveRow(table, payload, select = '*') {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select(select)
    .single();

  if (missingRelationshipTable(error)) {
    return { error: { status: 503, message: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' } };
  }
  if (error && error.code === '23505') {
    const { data: existing, error: existingError } = await supabase
      .from(table)
      .select(select)
      .match(Object.fromEntries(
        Object.entries(payload).filter(([key]) => !['status', 'created_at', 'target_period_id'].includes(key))
      ))
      .eq('status', 'active')
      .maybeSingle();
    if (existingError) {
      console.error(`Social ${table} duplicate lookup error:`, existingError);
      return { error: { status: 500, message: 'Database error' } };
    }
    return { data: existing, duplicate: true };
  }
  if (error) {
    console.error(`Social ${table} insert error:`, error);
    return { error: { status: 500, message: 'Database error' } };
  }
  return { data, duplicate: false };
}

async function handleFollow(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });
  if (actorNum === targetNum) return res.status(400).json({ error: 'You cannot follow your own OpenNum' });

  const verified = await verifySocialAction({ body, action: 'follow', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const target = await activeRegistrationForNumber(targetNum);
  if (target.error) return res.status(target.error.status).json({ error: target.error.message });

  if (await isBlocked({ blockerNum: targetNum, blockedNum: actorNum })) {
    return res.status(403).json({ error: 'You have been blocked by this profile.' });
  }

  const currentPeriod = await currentHolderPeriodFor(targetNum);
  if (currentPeriod.error) return res.status(503).json({ error: currentPeriod.error });
  if (!currentPeriod.id) return res.status(409).json({ error: 'Target holder period is not ready yet' });

  const result = await insertActiveRow('follows', {
    follower_num: actorNum,
    follower_wallet: verified.wallet,
    target_num: targetNum,
    target_period_id: currentPeriod.id,
    status: 'active'
  }, 'id, follower_num, target_num, target_period_id, status, created_at');
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });

  if (!result.duplicate) {
    await emitEvent({
      event_type: 'followed',
      subject_num: targetNum,
      actor_num: actorNum,
      holder_period_id: currentPeriod.id,
      payload: {
        follow_id: result.data?.id || null
      }
    });
  }

  return res.status(200).json({ success: true, duplicate: !!result.duplicate, follow: result.data });
}

async function handleUnfollow(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });

  const verified = await verifySocialAction({ body, action: 'unfollow', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('follows')
    .update({ status: 'unfollowed' })
    .eq('follower_num', actorNum)
    .eq('target_num', targetNum)
    .eq('status', 'active')
    .select('id, follower_num, target_num, status');

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social unfollow error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, changed: !!(data && data.length), updated: data?.length || 0, unfollow: data?.[0] || null });
}

async function handleWatch(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });

  const verified = await verifySocialAction({ body, action: 'watch', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const result = await insertActiveRow('number_watches', {
    watcher_num: actorNum,
    watcher_wallet: verified.wallet,
    target_num: targetNum,
    status: 'active'
  }, 'id, watcher_num, target_num, status, created_at');
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  return res.status(200).json({ success: true, watch: result.data });
}

async function handleUnwatch(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });

  const verified = await verifySocialAction({ body, action: 'unwatch', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('number_watches')
    .update({ status: 'unwatched' })
    .eq('watcher_num', actorNum)
    .eq('target_num', targetNum)
    .eq('status', 'active')
    .select('id, watcher_num, target_num, status');

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social unwatch error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, updated: data?.length || 0 });
}

async function handleWatchlistAdd(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });

  const verified = await verifySocialAction({ body, action: 'watchlist_add', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const note = body.note === undefined || body.note === null
    ? null
    : sanitizeText(String(body.note), MAX_WATCHLIST_NOTE_LENGTH);
  const { data, error } = await supabase
    .from('watchlist_items')
    .upsert({
      owner_wallet: verified.wallet,
      owner_num: actorNum,
      target_num: targetNum,
      note
    }, { onConflict: 'owner_wallet,target_num' })
    .select('id, owner_num, target_num, note, created_at')
    .single();

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social watchlist add error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, item: data });
}

async function handleWatchlistRemove(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });

  const verified = await verifySocialAction({ body, action: 'watchlist_remove', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('owner_wallet', verified.wallet)
    .eq('target_num', targetNum)
    .select('id');

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social watchlist remove error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, removed: data?.length || 0 });
}

async function handleWatchlistList(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  if (actorNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num' });

  const verified = await verifySocialAction({ body, action: 'watchlist_list', actorNum, target: '' });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('watchlist_items')
    .select('id, owner_num, target_num, note, created_at')
    .eq('owner_wallet', verified.wallet)
    .order('created_at', { ascending: false })
    .limit(100);

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social watchlist list error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, items: data || [] });
}

async function handleBlock(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const blockedNum = actionTargetFor(body, 'blocked_num');
  if (actorNum === null || blockedNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or blocked_num' });
  if (actorNum === blockedNum) return res.status(400).json({ error: 'You cannot block your own OpenNum' });

  const verified = await verifySocialAction({ body, action: 'block', actorNum, target: blockedNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('blocks')
    .upsert({
      blocker_num: actorNum,
      blocker_wallet: verified.wallet,
      blocked_num: blockedNum
    }, { onConflict: 'blocker_num,blocked_num' })
    .select('id, blocker_num, blocked_num, created_at')
    .single();

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social block error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, block: data });
}

async function handleUnblock(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const blockedNum = actionTargetFor(body, 'blocked_num');
  if (actorNum === null || blockedNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or blocked_num' });

  const verified = await verifySocialAction({ body, action: 'unblock', actorNum, target: blockedNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data, error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_num', actorNum)
    .eq('blocked_num', blockedNum)
    .select('id');

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social unblock error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, removed: data?.length || 0 });
}

async function handleReport(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetType = cleanAction(body.target_type);
  const targetId = normalizeTargetId(body.target_id ?? body.target);
  if (actorNum === null || !targetType || !targetId) return res.status(400).json({ error: 'Missing or invalid report fields' });
  if (!REPORT_TARGET_TYPES.has(targetType)) return res.status(400).json({ error: 'Unsupported report target_type' });

  const verified = await verifySocialAction({ body, action: 'report', actorNum, target: targetId });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const reason = body.reason === undefined || body.reason === null
    ? null
    : sanitizeText(String(body.reason), MAX_REPORT_REASON_LENGTH);
  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_num: actorNum,
      reporter_wallet: verified.wallet,
      target_type: targetType,
      target_id: targetId,
      reason
    })
    .select('id, reporter_num, target_type, target_id, created_at')
    .single();

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Relationship tables are not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social report error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  return res.status(200).json({ success: true, report: data });
}

async function handleOffer(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const targetNum = actionTargetFor(body);
  if (actorNum === null || targetNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num or target_num' });
  if (actorNum === targetNum) return res.status(400).json({ error: 'You cannot send an offer to your own OpenNum' });

  const verified = await verifySocialAction({ body, action: 'offer', actorNum, target: targetNum });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const target = await activeRegistrationForNumber(targetNum);
  if (target.error) return res.status(target.error.status).json({ error: target.error.message });

  if (await isBlocked({ blockerNum: targetNum, blockedNum: actorNum })) {
    return res.status(403).json({ error: 'You have been blocked by this profile.' });
  }

  const currentPeriod = await currentHolderPeriodFor(targetNum);
  if (currentPeriod.error) return res.status(503).json({ error: currentPeriod.error });
  if (!currentPeriod.id) return res.status(409).json({ error: 'Target holder period is not ready yet' });

  const priceText = body.price_text === undefined || body.price_text === null
    ? null
    : sanitizeText(String(body.price_text), MAX_OFFER_PRICE_LENGTH);
  const note = body.note === undefined || body.note === null
    ? null
    : sanitizeText(String(body.note), MAX_OFFER_NOTE_LENGTH);
  const satflowUrl = sanitizeUrl(body.satflow_url);

  const { data, error } = await supabase
    .from('private_offers')
    .insert({
      buyer_num: actorNum,
      buyer_wallet: verified.wallet,
      target_num: targetNum,
      target_period_id: currentPeriod.id,
      price_text: priceText,
      note,
      satflow_url: satflowUrl,
      status: 'open',
      signature: body.signature
    })
    .select('id, buyer_num, target_num, target_period_id, price_text, note, satflow_url, status, created_at')
    .single();

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Private offers table is not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social offer insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  await emitEvent({
    event_type: 'offer_received',
    subject_num: targetNum,
    actor_num: actorNum,
    holder_period_id: currentPeriod.id,
    visibility: 'inbox_only',
    payload: {
      offer_id: data.id,
      status: data.status
    }
  });

  return res.status(200).json({ success: true, offer: data });
}

async function handleOfferList(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  if (actorNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num' });

  const verified = await verifySocialAction({ body, action: 'offer_list', actorNum, target: '' });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const owner = await currentOwnerContext(actorNum, verified.wallet);
  if (owner.error) return res.status(owner.error.status).json({ error: owner.error.message });

  const { data, error } = await supabase
    .from('private_offers')
    .select('id, buyer_num, target_num, target_period_id, price_text, note, satflow_url, status, created_at')
    .eq('target_num', actorNum)
    .eq('target_period_id', owner.period_id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Private offers table is not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social offer list error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({
    success: true,
    target_num: actorNum,
    target_period_id: owner.period_id,
    offers: data || []
  });
}

async function handleOfferStatus(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  const offerId = normalizeOfferId(body.offer_id ?? body.target);
  const nextStatus = cleanAction(body.status);
  if (actorNum === null || offerId === null || !nextStatus) return res.status(400).json({ error: 'Missing or invalid offer status fields' });
  if (!OFFER_STATUS_VALUES.has(nextStatus)) return res.status(400).json({ error: 'Unsupported offer status' });

  const verified = await verifySocialAction({ body, action: 'offer_status', actorNum, target: offerId });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const { data: offer, error: offerError } = await supabase
    .from('private_offers')
    .select('id, buyer_num, target_num, target_period_id, status')
    .eq('id', offerId)
    .maybeSingle();

  if (missingRelationshipTable(offerError)) return res.status(503).json({ error: 'Private offers table is not installed yet. Run the Supabase migration in docs/database.md.' });
  if (offerError) {
    console.error('Social offer lookup error:', offerError);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (Number(offer.target_num) !== actorNum) return res.status(403).json({ error: 'Only the target holder can update this offer' });

  const owner = await currentOwnerContext(Number(offer.target_num), verified.wallet);
  if (owner.error) return res.status(owner.error.status).json({ error: owner.error.message });
  if (Number(offer.target_period_id) !== Number(owner.period_id)) {
    return res.status(409).json({ error: 'Archived-period offers cannot be changed by the current holder' });
  }

  const { data, error } = await supabase
    .from('private_offers')
    .update({ status: nextStatus })
    .eq('id', offerId)
    .eq('target_period_id', owner.period_id)
    .select('id, buyer_num, target_num, target_period_id, status, created_at')
    .single();

  if (missingRelationshipTable(error)) return res.status(503).json({ error: 'Private offers table is not installed yet. Run the Supabase migration in docs/database.md.' });
  if (error) {
    console.error('Social offer status update error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ success: true, offer: data });
}

async function handleInbox(req, res, body) {
  const actorNum = normalizeNumber(body.actor_num);
  if (actorNum === null) return res.status(400).json({ error: 'Missing or invalid actor_num' });

  const verified = await verifySocialAction({ body, action: 'inbox', actorNum, target: '' });
  if (verified.error) return res.status(verified.error.status).json({ error: verified.error.message });

  const owner = await currentOwnerContext(actorNum, verified.wallet);
  if (owner.error) return res.status(owner.error.status).json({ error: owner.error.message });

  const { data: ownEvents, error: ownError } = await supabase
    .from('activity_events')
    .select('id, event_type, subject_num, actor_num, holder_period_id, visibility, payload, created_at')
    .eq('subject_num', actorNum)
    .in('event_type', INBOX_OWN_EVENTS)
    .order('created_at', { ascending: false })
    .limit(50);

  if (isMissingActivityTable(ownError)) {
    return res.status(200).json({ success: true, inbox: [], setup_required: true });
  }
  if (ownError) {
    console.error('Social inbox own events error:', ownError);
    return res.status(500).json({ error: 'Database error' });
  }

  let watchEvents = [];
  const { data: watches, error: watchError } = await supabase
    .from('number_watches')
    .select('target_num')
    .eq('watcher_num', actorNum)
    .eq('status', 'active')
    .limit(100);

  if (missingRelationshipTable(watchError)) {
    watchEvents = [];
  } else if (watchError) {
    console.warn('Social inbox watch lookup failed:', watchError.message);
  } else {
    const watchedNums = [...new Set((watches || []).map((row) => Number(row.target_num)).filter(Number.isInteger))];
    if (watchedNums.length) {
      const { data, error } = await supabase
        .from('activity_events')
        .select('id, event_type, subject_num, actor_num, holder_period_id, visibility, payload, created_at')
        .in('subject_num', watchedNums)
        .in('event_type', INBOX_WATCH_EVENTS)
        .order('created_at', { ascending: false })
        .limit(50);

      if (isMissingActivityTable(error)) {
        watchEvents = [];
      } else if (error) {
        console.warn('Social inbox watched events failed:', error.message);
      } else {
        watchEvents = data || [];
      }
    }
  }

  const inbox = [...(ownEvents || []), ...watchEvents]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 100);

  return res.status(200).json({
    success: true,
    actor_num: actorNum,
    holder_period_id: owner.period_id,
    inbox
  });
}

async function handleFollowsList(req, res) {
  const num = normalizeNumber(req.query.num || req.query.number);
  if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });
  const type = cleanAction(req.query.type) === 'followers' ? 'followers' : 'following';
  const filterCol = type === 'followers' ? 'target_num' : 'follower_num';
  const otherCol = type === 'followers' ? 'follower_num' : 'target_num';

  const { data, error } = await supabase
    .from('follows')
    .select(`${otherCol}`)
    .eq(filterCol, num)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200);

  if (missingRelationshipTable(error)) return res.status(200).json({ success: true, num, type, items: [] });
  if (error) {
    console.error('Social follows list error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  const nums = [...new Set((data || []).map((r) => Number(r[otherCol])).filter(Number.isInteger))];
  let names = new Map();
  if (nums.length) {
    const { data: regs } = await supabase
      .from('registrations')
      .select('inscription_num, display_name')
      .in('inscription_num', nums)
      .eq('status', 'active');
    names = new Map((regs || []).map((r) => [Number(r.inscription_num), r.display_name]));
  }
  const items = nums.map((n) => ({ num: n, display_name: names.get(n) || null }));
  return res.status(200).json({ success: true, num, type, items });
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    const view = cleanAction(req.query.view);
    if (view === 'feed') return handleFeed(req, res);
    if (view === 'follows') return handleFollowsList(req, res);
    return res.status(400).json({ error: 'Unknown social view' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rate = checkRateLimit(req, 'social', 30, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const body = req.body || {};
  const action = cleanAction(body.action);

  if (action === 'message_withdraw') return handleWithdraw(req, res, body);
  if (action === 'message_hide') return handleHide(req, res, body);
  if (action === 'follow') return handleFollow(req, res, body);
  if (action === 'unfollow') return handleUnfollow(req, res, body);
  if (action === 'watch') return handleWatch(req, res, body);
  if (action === 'unwatch') return handleUnwatch(req, res, body);
  if (action === 'watchlist_add') return handleWatchlistAdd(req, res, body);
  if (action === 'watchlist_remove') return handleWatchlistRemove(req, res, body);
  if (action === 'watchlist_list') return handleWatchlistList(req, res, body);
  if (action === 'block') return handleBlock(req, res, body);
  if (action === 'unblock') return handleUnblock(req, res, body);
  if (action === 'report') return handleReport(req, res, body);
  if (action === 'offer') return handleOffer(req, res, body);
  if (action === 'offer_list') return handleOfferList(req, res, body);
  if (action === 'offer_status') return handleOfferStatus(req, res, body);
  if (action === 'inbox') return handleInbox(req, res, body);

  return res.status(400).json({ error: 'Unknown social action' });
};
