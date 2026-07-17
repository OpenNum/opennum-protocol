const { createClient } = require('@supabase/supabase-js');
const { setCors } = require('../lib/_security');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Number-tier circles are range queries over active registrations — complete
// by construction, no dependency on lazy collection detection.
const TIER_CIRCLES = {
  'sub-100':  { name: 'Sub 100',  max: 100 },
  'sub-1k':   { name: 'Sub 1K',   max: 1000 },
  'sub-10k':  { name: 'Sub 10K',  max: 10000 },
  'sub-100k': { name: 'Sub 100K', max: 100000 }
};

function memberShape(r) {
  return {
    inscription_num: r.inscription_num,
    inscription_id: r.inscription_id || (r.inscription_txid ? `${r.inscription_txid}i0` : null),
    display_name: r.display_name,
    for_sale: !!r.for_sale,
    ask_headline: r.ask_headline || null,
    ask_price: r.ask_price || null
  };
}

async function handleCollection(res, slug) {
  const tier = TIER_CIRCLES[slug];
  if (tier) {
    const { data, error, count } = await supabase
      .from('registrations')
      .select('*', { count: 'exact' })
      .eq('status', 'active')
      .lt('inscription_num', tier.max)
      .order('inscription_num', { ascending: true })
      .limit(200);
    if (error) return res.status(500).json({ error: 'Database error' });
    return res.status(200).json({
      collection: { slug, name: tier.name, kind: 'tier' },
      total: count || 0,
      members: (data || []).map(memberShape)
    });
  }

  const { data: rows, error: colError } = await supabase
    .from('inscription_collections')
    .select('inscription_id, collection_name')
    .eq('collection_slug', slug)
    .limit(500);
  if (colError) return res.status(500).json({ error: 'Database error' });
  if (!rows || !rows.length) {
    return res.status(404).json({ error: 'No registered members in this collection yet', collection: { slug } });
  }
  const ids = [...new Set(rows.map((r) => r.inscription_id))];
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .in('inscription_id', ids)
    .eq('status', 'active')
    .order('inscription_num', { ascending: true })
    .limit(200);
  if (error) return res.status(500).json({ error: 'Database error' });
  return res.status(200).json({
    collection: { slug, name: rows[0].collection_name || slug, kind: 'named' },
    total: (data || []).length,
    members: (data || []).map(memberShape)
  });
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const collectionSlug = String(req.query.collection || '').trim().toLowerCase();
  if (collectionSlug) {
    if (!/^[a-z0-9-]{1,80}$/.test(collectionSlug)) {
      return res.status(400).json({ error: 'Invalid collection slug' });
    }
    return handleCollection(res, collectionSlug);
  }

  const rawLimit = req.query.limit === undefined ? '50' : String(req.query.limit);
  const rawOffset = req.query.offset === undefined ? '0' : String(req.query.offset);
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) {
    return res.status(400).json({ error: 'limit and offset must be non-negative integers' });
  }
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset)) {
    return res.status(400).json({ error: 'limit must be 1-100 and offset must be a non-negative integer' });
  }
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
