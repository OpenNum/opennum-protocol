const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { fetchOrdinalsOwner } = require('../lib/_ordinals');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rate = checkRateLimit(req, 'unbind', 10, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, wallet, signature, timestamp } = req.body || {};

  if ((!inscription_num && inscription_num !== 0) || !wallet || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, wallet, signature, timestamp' });
  }
  if (!Number.isSafeInteger(inscription_num) || inscription_num < 0) {
    return res.status(400).json({ error: 'inscription_num must be a non-negative integer' });
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  const message = `opennum:unbind:${inscription_num}:${wallet}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(wallet, message, signature);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  } catch (e) {
    console.error('Signature verification error:', e && e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { data: existing, error: selectError } = await supabase
    .from('registrations')
    .select('id, inscription_num, inscription_id, inscription_txid, wallet_address, status')
    .eq('inscription_num', inscription_num)
    .eq('status', 'active')
    .maybeSingle();

  if (selectError) {
    console.error('Unbind lookup error:', selectError);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!existing) return res.status(404).json({ error: `OpenNum #${inscription_num} is not active.` });
  if (existing.wallet_address !== wallet) {
    return res.status(403).json({ error: 'Connected wallet does not own this active OpenNum ID.' });
  }

  const inscriptionId = existing.inscription_id || (existing.inscription_txid ? `${existing.inscription_txid}i0` : null);
  const ownership = await fetchOrdinalsOwner(inscriptionId);
  if (!ownership.verified || !ownership.owner) {
    return res.status(503).json({ error: 'On-chain ownership could not be verified. Please try again.' });
  }
  if (ownership.owner !== wallet) {
    return res.status(409).json({ error: 'This inscription has moved on-chain. Only the current holder can unbind it.' });
  }

  const { error: updateError } = await supabase
    .from('registrations')
    .update({
      status: 'unbound',
      updated_at: new Date().toISOString()
    })
    .eq('id', existing.id);

  if (updateError) {
    console.error('Unbind update error:', updateError);
    return res.status(500).json({ error: 'Unbind failed. Please try again.' });
  }

  return res.status(200).json({ success: true, inscription_num, wallet, status: 'unbound' });
};
