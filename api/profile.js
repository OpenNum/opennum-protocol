const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ORDINALS_API = 'https://ordinals.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  // Enrich with Ordinals metadata (best-effort, non-blocking)
  let metadata = null;
  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (ordRes.ok) {
      const raw = await ordRes.json();
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

  return res.status(200).json({
    inscription_num: data.inscription_num,
    inscription_id: inscriptionId,
    inscription_txid: data.inscription_txid,
    wallet: data.wallet_address,
    status: data.status,
    display_name: data.display_name,
    bio: data.bio || null,
    indexer_ruleset: data.indexer_ruleset,
    registered_at: data.registered_at,
    metadata
  });
};
