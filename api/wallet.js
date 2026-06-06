const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');

  const wallet = String(req.query.wallet || '').trim();
  if (!wallet) return res.status(400).json({ error: 'Missing ?wallet= parameter' });

  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('wallet_address', wallet)
    .eq('status', 'active')
    .order('inscription_num', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Wallet lookup error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!data) return res.status(200).json({ wallet, has_active_id: false });

  return res.status(200).json({
    wallet,
    has_active_id: true,
    registration: {
      inscription_num: data.inscription_num,
      inscription_id: data.inscription_id || (data.inscription_txid ? `${data.inscription_txid}i0` : null),
      inscription_txid: data.inscription_txid,
      wallet: data.wallet_address,
      status: data.status,
      display_name: data.display_name,
      registered_at: data.registered_at
    }
  });
};
