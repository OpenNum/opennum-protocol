const { createClient } = require('@supabase/supabase-js');
const { setCors } = require('../lib/_security');
const { resolveOwnershipState } = require('../lib/_ownership');
const { resolveCollections, collectionMembers } = require('../lib/_collections');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ORDINALS_API = 'https://ordinals.com';

function computeNumberTraits(num) {
  const digits = String(num);
  const reversed = digits.split('').reverse().join('');
  return {
    is_sub_100: num < 100,
    is_sub_1k: num < 1000,
    is_sub_10k: num < 10000,
    is_palindrome: digits === reversed,
    is_repdigit: /^(.)\1*$/.test(digits),
    is_year: num >= 1900 && num <= 2100,
    digit_count: digits.length
  };
}

function missingFollowsTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*follows/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

async function countActiveFollows(column, num) {
  const { count, error } = await supabase
    .from('follows')
    .select('id', { count: 'exact', head: true })
    .eq(column, num)
    .eq('status', 'active');

  if (missingFollowsTable(error)) return { count: 0, setup_required: true };
  if (error) {
    console.warn(`Follow count failed for ${column}:`, error.message);
    return { count: 0, setup_required: false };
  }
  return { count: count || 0, setup_required: false };
}

async function loadSocialCounts(num) {
  const [followers, following] = await Promise.all([
    countActiveFollows('target_num', num),
    countActiveFollows('follower_num', num)
  ]);

  return {
    followers: followers.count,
    following: following.count,
    setup_required: !!(followers.setup_required || following.setup_required)
  };
}

async function viewerFollows(viewerNum, targetNum) {
  if (!Number.isInteger(viewerNum)) return false;
  const { data, error } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_num', viewerNum)
    .eq('target_num', targetNum)
    .eq('status', 'active')
    .limit(1);
  if (error) return false;
  return !!(data && data.length);
}

async function viewerWatches(viewerNum, targetNum) {
  if (!Number.isInteger(viewerNum)) return false;
  const { data, error } = await supabase
    .from('number_watches')
    .select('id')
    .eq('watcher_num', viewerNum)
    .eq('target_num', targetNum)
    .eq('status', 'active')
    .limit(1);
  if (error) return false;
  return !!(data && data.length);
}

async function fetchInscription(inscriptionId) {
  const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)'
    },
    signal: AbortSignal.timeout(5000)
  });
  if (!ordRes.ok) return null;
  return ordRes.json();
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const raw = req.query.num || req.query.number;
  if (!raw) return res.status(400).json({ error: 'Missing ?num= parameter' });

  const num = parseInt(raw.replace(/^#/, ''), 10);
  if (isNaN(num)) return res.status(400).json({ error: 'Invalid inscription number' });
  const traits = computeNumberTraits(num);
  const socialCounts = await loadSocialCounts(num);
  const viewerNum = parseInt(String(req.query.viewer || '').replace(/^#/, ''), 10);
  const viewerFollowsTarget = Number.isInteger(viewerNum) ? await viewerFollows(viewerNum, num) : false;
  const viewerWatchesTarget = Number.isInteger(viewerNum) ? await viewerWatches(viewerNum, num) : false;

  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('inscription_num', num)
    .order('registered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('DB error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!data) {
    return res.status(404).json({
      status: 'unregistered',
      inscription_num: num,
      traits,
      followers: socialCounts.followers,
      following: socialCounts.following,
      social_counts: socialCounts
    });
  }

  const inscriptionId = data.inscription_id || `${data.inscription_txid}i0`;

  // Enrich with Ordinals metadata and current owner (best-effort).
  let metadata = null;
  try {
    const raw = await fetchInscription(inscriptionId);
    if (raw) {
      metadata = {
        content_type: raw.content_type,
        content_url: `${ORDINALS_API}/content/${inscriptionId}`,
        sat_ordinal: raw.sat,
        genesis_block_height: raw.height,
        genesis_timestamp: raw.timestamp,
        sat_rarity: null
      };
    }
  } catch (_) { /* metadata is optional */ }

  const ownership = await resolveOwnershipState(data, { persist: true });
  const currentOwner = ownership.currentOwner;
  const ownershipVerified = ownership.ownershipVerified;
  const ownerMismatch = ownership.ownerMismatch;
  const effectiveStatus = ownerMismatch ? 'dormant' : (data.status === 'dormant' && !ownerMismatch ? 'active' : data.status);
  const collections = await resolveCollections(inscriptionId, num);
  const members = collections.length
    ? await collectionMembers(collections.map((c) => c.collection_slug), inscriptionId)
    : [];

  return res.status(200).json({
    inscription_num: data.inscription_num,
    inscription_id: inscriptionId,
    inscription_txid: data.inscription_txid,
    wallet: ownerMismatch ? null : data.wallet_address,
    registered_wallet: data.wallet_address,
    current_owner: currentOwner,
    ownership_verified: ownershipVerified,
    owner_mismatch: ownerMismatch,
    claim_required: ownerMismatch,
    status: effectiveStatus,
    display_name: data.display_name,
    bio: data.bio || null,
    links: data.links || {},
    for_sale: !!data.for_sale,
    ask_note: data.ask_note || null,
    satflow_url: data.satflow_url || null,
    collections,
    collection_members: members,
    traits,
    followers: socialCounts.followers,
    following: socialCounts.following,
    social_counts: socialCounts,
    viewer_follows: viewerFollowsTarget,
    viewer_watches: viewerWatchesTarget,
    indexer_ruleset: data.indexer_ruleset,
    registered_at: data.registered_at,
    owner_checked_at: ownership.ownerCheckedAt,
    metadata
  });
};
