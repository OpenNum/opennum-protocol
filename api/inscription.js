const ORDINALS_API = 'https://ordinals.com';
const { setCors } = require('./_security');

function normalizeNumber(raw) {
  const num = parseInt(String(raw || '').replace(/^#/, ''), 10);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const num = normalizeNumber(req.query.num || req.query.number);
  if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });

  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${num}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!ordRes.ok) {
      return res.status(ordRes.status === 404 ? 404 : 502).json({ error: 'Inscription not found' });
    }
    const raw = await ordRes.json();
    return res.status(200).json({
      inscription_num: num,
      inscription_id: raw.id,
      address: raw.address,
      content_type: raw.content_type || raw.effective_content_type || null,
      content_url: raw.id ? `${ORDINALS_API}/content/${raw.id}` : null,
      sat: raw.sat,
      timestamp: raw.timestamp,
      height: raw.height
    });
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Ordinals lookup failed' });
  }
};
