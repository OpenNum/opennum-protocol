const { createClient } = require('@supabase/supabase-js');
const { setCors } = require('../lib/_security');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const sort = req.query.sort === 'number' ? 'inscription_num' : 'registered_at';
  const order = req.query.order === 'asc';
  const market = req.query.market === '1' || req.query.market === 'true';
  const walletFilter = req.query.wallet || null;

  let query = supabase
    .from('registrations')
    .select('*', { count: 'exact' })
    .eq('status', 'active');

  if (market) query = query.eq('for_sale', true);
  if (walletFilter) query = query.eq('wallet_address', walletFilter);

  const { data, error, count } = await query
    .order(sort, { ascending: order })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('DB error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({
    total: count || 0,
    offset,
    limit,
    registrations: (data || []).map(r => ({
      inscription_num: r.inscription_num,
      inscription_id: r.inscription_id || (r.inscription_txid ? `${r.inscription_txid}i0` : null),
      inscription_txid: r.inscription_txid,
      wallet: r.wallet_address,
      status: r.status,
      display_name: r.display_name,
      bio: r.bio || null,
      links: r.links || {},
      for_sale: !!r.for_sale,
      ask_note: r.ask_note || null,
      ask_headline: r.ask_headline || null,
      ask_price: r.ask_price || null,
      satflow_url: r.satflow_url || null,
      registered_at: r.registered_at
    }))
  });
};
