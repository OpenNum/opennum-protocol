const ORDINALS_API = 'https://ordinals.com';
const { setCors, parseInscriptionNumber } = require('../lib/_security');

function normalizeNumber(raw) {
  return parseInscriptionNumber(raw);
}

function parseHtmlInscription(html, num) {
  const id = html.match(/<iframe[^>]+src=\/preview\/([0-9a-f]+i\d+)/i)?.[1]
    || html.match(/<dt>id<\/dt>\s*<dd[^>]*>([0-9a-f]+i\d+)<\/dd>/i)?.[1];
  if (!id) return null;

  return {
    inscription_num: num,
    inscription_id: id,
    address: html.match(/href=\/address\/([^ >]+)/i)?.[1] || null,
    content_type: html.match(/<dt>content type<\/dt>\s*<dd>([^<]+)<\/dd>/i)?.[1] || null,
    content_url: `${ORDINALS_API}/content/${id}`,
    sat: Number(html.match(/href=\/sat\/(\d+)/i)?.[1]) || null,
    timestamp: html.match(/<dt>timestamp<\/dt>\s*<dd><time>([^<]+)<\/time>/i)?.[1] || null,
    height: Number(html.match(/<dt>height<\/dt>\s*<dd><a[^>]*>(\d+)<\/a>/i)?.[1]) || null
  };
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const num = normalizeNumber(req.query.num || req.query.number);
  if (num === null) return res.status(400).json({ error: 'Missing or invalid ?num= parameter' });

  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${num}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (ordRes.ok) {
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
    }

    const htmlRes = await fetch(`${ORDINALS_API}/inscription/${num}`, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!htmlRes.ok) {
      return res.status(htmlRes.status === 404 ? 404 : 502).json({ error: 'Inscription not found' });
    }
    const parsed = parseHtmlInscription(await htmlRes.text(), num);
    if (!parsed) return res.status(502).json({ error: 'Inscription metadata unavailable' });
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Ordinals lookup failed' });
  }
};
