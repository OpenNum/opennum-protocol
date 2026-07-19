const ORDINALS_ORIGIN = 'https://ordinals.com';
const INSCRIPTION_ID_RE = /^[0-9a-f]{64}i\d+$/i;

function normalizeInscriptionRef(value) {
  const ref = String(value ?? '').trim().replace(/^#/, '');
  if (/^\d+$/.test(ref) || INSCRIPTION_ID_RE.test(ref)) return ref;
  throw new TypeError('Invalid inscription reference');
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonInscription(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' && INSCRIPTION_ID_RE.test(raw.id) ? raw.id : null;
  return {
    id,
    number: finiteNumber(raw.number),
    address: typeof raw.address === 'string' && raw.address ? raw.address : null,
    content_type: raw.content_type || raw.effective_content_type || null,
    sat: finiteNumber(raw.sat),
    timestamp: raw.timestamp || null,
    height: finiteNumber(raw.height),
    source: 'json'
  };
}

function parseHtmlInscription(html) {
  if (typeof html !== 'string') return null;
  const id = html.match(/<iframe[^>]+src=['"]?\/preview\/([0-9a-f]+i\d+)/i)?.[1]
    || html.match(/<dt>id<\/dt>\s*<dd[^>]*>([0-9a-f]+i\d+)<\/dd>/i)?.[1]
    || null;
  const number = finiteNumber(html.match(/<h1>\s*Inscription\s+#?(-?\d+)\s*<\/h1>/i)?.[1]);
  const address = html.match(/href=['"]?\/address\/([^\s>"']+)/i)?.[1] || null;
  if (!id && number === null && !address) return null;

  return {
    id,
    number,
    address,
    content_type: html.match(/<dt>content type<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/i)?.[1]?.trim() || null,
    sat: finiteNumber(html.match(/href=['"]?\/sat\/(\d+)/i)?.[1]),
    timestamp: html.match(/<dt>timestamp<\/dt>\s*<dd[^>]*>\s*<time[^>]*>([^<]+)<\/time>/i)?.[1]?.trim() || null,
    height: finiteNumber(html.match(/<dt>height<\/dt>\s*<dd[^>]*>\s*<a[^>]*>(\d+)<\/a>/i)?.[1]),
    source: 'html'
  };
}

function parseInscriptionResponse(text) {
  return parseJsonInscription(text) || parseHtmlInscription(text);
}

async function fetchOrdinalsInscription(ref, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  userAgent = 'OpenNum-Resolver/1.0 (opennum.org)'
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const normalizedRef = normalizeInscriptionRef(ref);
  const response = await fetchImpl(`${ORDINALS_ORIGIN}/inscription/${normalizedRef}`, {
    headers: {
      Accept: 'text/html, application/json;q=0.9',
      'User-Agent': userAgent
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`ordinals.com returned ${response.status}`);

  const parsed = parseInscriptionResponse(await response.text());
  if (!parsed) throw new Error('ordinals.com returned unsupported inscription data');
  return parsed;
}

async function fetchOrdinalsOwner(ref, options) {
  try {
    const inscription = await fetchOrdinalsInscription(ref, options);
    return {
      owner: inscription.address || null,
      verified: !!inscription.address,
      inscription
    };
  } catch (error) {
    return {
      owner: null,
      verified: false,
      inscription: null,
      error: error?.message || 'Ordinals lookup failed'
    };
  }
}

module.exports = {
  ORDINALS_ORIGIN,
  fetchOrdinalsInscription,
  fetchOrdinalsOwner,
  normalizeInscriptionRef,
  parseHtmlInscription,
  parseInscriptionResponse,
  parseJsonInscription
};
