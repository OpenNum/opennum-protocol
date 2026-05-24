const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const HIRO_API = 'https://api.hiro.so/ordinals/v1';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const raw = req.query.num;
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

  // Enrich with Hiro inscription metadata (best-effort, non-blocking)
  let metadata = null;
  try {
    const inscriptionId = `${data.inscription_txid}i0`;
    const hiroRes = await fetch(`${HIRO_API}/inscriptions/${inscriptionId}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (hiroRes.ok) {
      const raw = await hiroRes.json();
      metadata = {
        content_type: raw.content_type,
        content_url: `${HIRO_API}/inscriptions/${inscriptionId}/content`,
        sat_ordinal: raw.sat_ordinal,
        genesis_block_height: raw.genesis_block_height,
        genesis_timestamp: raw.genesis_timestamp,
        sat_rarity: raw.sat_rarity
      };
    }
  } catch (_) { /* metadata is optional */ }

  return res.status(200).json({
    inscription_num: data.inscription_num,
    inscription_txid: data.inscription_txid,
    wallet: data.wallet_address,
    status: data.status,
    display_name: data.display_name,
    indexer_ruleset: data.indexer_ruleset,
    registered_at: data.registered_at,
    metadata
  });
};
