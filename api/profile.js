const { createClient } = require('@supabase/supabase-js');
const { setCors } = require('./_security');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ORDINALS_API = 'https://ordinals.com';

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
    return res.status(404).json({ status: 'unregistered', inscription_num: num });
  }

  const inscriptionId = data.inscription_id || `${data.inscription_txid}i0`;

  // Enrich with Ordinals metadata and current owner (best-effort).
  let metadata = null;
  let currentOwner = null;
  let ownershipVerified = false;
  try {
    const raw = await fetchInscription(inscriptionId);
    if (raw) {
      currentOwner = raw.address || null;
      ownershipVerified = !!raw.address;
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

  const ownerMismatch = ownershipVerified && currentOwner && data.wallet_address && currentOwner !== data.wallet_address;
  const effectiveStatus = ownerMismatch ? 'dormant' : data.status;
  let collections = [];
  try {
    const result = await supabase
      .from('inscription_collections')
      .select('collection_slug, collection_name, source, verified_at')
      .eq('inscription_id', inscriptionId)
      .order('collection_name', { ascending: true });
    if (!result.error) collections = result.data || [];
    else if (!/relation .*inscription_collections/i.test(result.error.message || '')) {
      console.error('Collection lookup error:', result.error);
    }
  } catch (_) {
    collections = [];
  }

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
    indexer_ruleset: data.indexer_ruleset,
    registered_at: data.registered_at,
    metadata
  });
};
