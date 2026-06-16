const stores = new Map();

const PRODUCTION_ORIGINS = new Set([
  'https://opennum.org',
  'https://www.opennum.org'
]);

const DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:8000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8000'
]);

function isProduction() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

function setCors(req, res, methods = 'GET, OPTIONS') {
  const origin = req.headers?.origin;
  const allowed = isProduction() ? PRODUCTION_ORIGINS : new Set([...PRODUCTION_ORIGINS, ...DEV_ORIGINS]);
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', 'https://opennum.org');
  } else if (allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitizeText(val, maxLen = 200) {
  if (!val) return null;
  return String(val)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen) || null;
}

function sanitizeUrl(val) {
  if (!val) return null;
  try {
    const u = new URL(String(val).trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString().slice(0, 500);
  } catch (_) {
    return null;
  }
}

function sanitizeLinks(links) {
  if (!links || typeof links !== 'object') return {};
  const clean = {};
  ['x', 'instagram', 'telegram', 'website'].forEach((key) => {
    const val = sanitizeUrl(links[key]);
    if (val) clean[key] = val;
  });
  return clean;
}

function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || 'unknown')
    .split(',')[0]
    .trim();
}

function checkRateLimit(req, bucket, max, windowMs) {
  const now = Date.now();
  const key = `${clientIp(req)}:${bucket}`;
  const store = stores.get(bucket) || new Map();
  stores.set(bucket, store);

  const entry = store.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  store.set(key, entry);

  if (entry.count > max) {
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((entry.reset - now) / 1000))
    };
  }
  return { limited: false };
}

function sendRateLimit(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Too many requests. Try again later.' });
}

module.exports = {
  setCors,
  sanitizeText,
  sanitizeUrl,
  sanitizeLinks,
  checkRateLimit,
  sendRateLimit
};
