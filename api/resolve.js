const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ORDINALS_API = 'https://ordinals.com';

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

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

  const inscriptionId = data.inscription_id || (data.inscription_txid ? `${data.inscription_txid}i0` : null);
  const ownership = inscriptionId ? await currentOwnerFor(inscriptionId) : { owner: null, verified: false };
  const ownerMismatch = ownership.verified && ownership.owner && data.wallet_address && ownership.owner !== data.wallet_address;

  return res.status(200).json({
    inscription_num: data.inscription_num,
    inscription_id: inscriptionId,
    inscription_txid: data.inscription_txid,
    wallet: ownerMismatch ? null : data.wallet_address,
    registered_wallet: data.wallet_address,
    current_owner: ownership.owner,
    ownership_verified: ownership.verified,
    owner_mismatch: ownerMismatch,
    claim_required: ownerMismatch,
    status: ownerMismatch ? 'dormant' : data.status,
    display_name: data.display_name,
    registered_at: data.registered_at
  });
};
