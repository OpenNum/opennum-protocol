const { setCors, parseInscriptionNumber } = require('../lib/_security');
const { ORDINALS_ORIGIN, fetchOrdinalsInscription } = require('../lib/_ordinals');

function normalizeNumber(raw) {
  return parseInscriptionNumber(raw);
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const num = normalizeNumber(req.query.num || req.query.number);
  if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });

  try {
    const raw = await fetchOrdinalsInscription(num);
    return res.status(200).json({
      inscription_num: raw.number ?? num,
      inscription_id: raw.id,
      address: raw.address,
      content_type: raw.content_type,
      content_url: raw.id ? `${ORDINALS_ORIGIN}/content/${raw.id}` : null,
      sat: raw.sat,
      timestamp: raw.timestamp,
      height: raw.height
    });
  } catch (e) {
    const status = /returned 404/.test(e?.message || '') ? 404 : 502;
    return res.status(status).json({ error: e?.message || 'Ordinals lookup failed' });
  }
};
