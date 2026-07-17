const { createClient } = require('@supabase/supabase-js');
const { setCors, parseInscriptionNumber } = require('../lib/_security');
const { resolveOwnershipState } = require('../lib/_ownership');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const raw = req.query.num || req.query.number;
  if (!raw) return res.status(400).json({ error: 'Missing ?num= parameter' });

  const num = parseInscriptionNumber(raw);
  if (num === null) return res.status(400).json({ error: 'Invalid inscription number' });

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
  const ownership = await resolveOwnershipState(data, { persist: true });
  const ownerMismatch = ownership.ownerMismatch;

  return res.status(200).json({
    inscription_num: data.inscription_num,
    inscription_id: inscriptionId,
    inscription_txid: data.inscription_txid,
    wallet: ownerMismatch ? null : data.wallet_address,
    registered_wallet: data.wallet_address,
    current_owner: ownership.currentOwner,
    ownership_verified: ownership.ownershipVerified,
    owner_mismatch: ownerMismatch,
    claim_required: ownerMismatch,
    status: ownerMismatch ? 'dormant' : (data.status === 'dormant' ? 'active' : data.status),
    display_name: data.display_name,
    registered_at: data.registered_at,
    owner_checked_at: ownership.ownerCheckedAt
  });
};
