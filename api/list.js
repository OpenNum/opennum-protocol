const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const sort = req.query.sort === 'number' ? 'inscription_num' : 'registered_at';
  const order = req.query.order === 'asc';

  const { data, error, count } = await supabase
    .from('registrations')
    .select('inscription_num, wallet_address, status, display_name, registered_at', { count: 'exact' })
    .eq('status', 'active')
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
      wallet: r.wallet_address,
      status: r.status,
      display_name: r.display_name,
      registered_at: r.registered_at
    }))
  });
};
