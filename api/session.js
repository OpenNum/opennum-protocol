const { setCors, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { verifyAction, issueSession } = require('../lib/_auth');

function normalizeNumber(raw) {
  const num = parseInt(String(raw || '').replace(/^#/, ''), 10);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rate = checkRateLimit(req, 'session', 60, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { wallet, actor_num, signature, ts, timestamp, nonce } = req.body || {};
  const actorNum = normalizeNumber(actor_num);
  if (!wallet || actorNum === null || !signature || !(ts || timestamp) || !nonce) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const auth = await verifyAction({
    wallet,
    action: 'session',
    actor_num: actorNum,
    target: '',
    ts: ts || timestamp,
    nonce,
    signature,
    requireActiveId: true,
    requireOwnership: false
  });
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'Authentication failed' });

  const session = await issueSession({ wallet, actor_num: actorNum });
  if (!session.ok) return res.status(session.status || 500).json({ error: session.error || 'Could not create session' });

  return res.status(200).json({
    success: true,
    token: session.token,
    expires_at: session.expires_at,
    actor_num: actorNum
  });
};
