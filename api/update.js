const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { inscription_num, wallet, signature, timestamp, display_name, bio, links } = req.body || {};

  if ((!inscription_num && inscription_num !== 0) || !wallet || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, wallet, signature, timestamp' });
  }
  if (!Number.isInteger(inscription_num)) {
    return res.status(400).json({ error: 'inscription_num must be an integer' });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  // Verify BIP322 signature: opennum:update:<num>:<wallet>:<timestamp>
  const message = `opennum:update:${inscription_num}:${wallet}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(wallet, message, signature);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid signature. Make sure you are signing with the correct wallet.' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Signature verification failed: ' + e.message });
  }

  // Confirm this wallet is the current owner of this OpenNum
  const { data: existing, error: selectError } = await supabase
    .from('registrations')
    .select('id, wallet_address')
    .eq('inscription_num', inscription_num)
    .eq('status', 'active')
    .maybeSingle();

  if (selectError) {
    console.error('DB select error:', selectError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
  if (!existing) {
    return res.status(404).json({ error: `OpenNum #${inscription_num} is not registered.` });
  }
  if (existing.wallet_address !== wallet) {
    return res.status(403).json({ error: 'This wallet does not own this OpenNum.' });
  }

  // Build update — only update editable fields
  const updatePayload = {
    display_name: display_name || null,
    bio: bio || null,
    updated_at: new Date().toISOString()
  };
  // links requires DB migration: ALTER TABLE registrations ADD COLUMN links JSONB DEFAULT '{}'
  if (links !== undefined) updatePayload.links = (links && typeof links === 'object') ? links : {};

  const { error: updateError } = await supabase
    .from('registrations')
    .update(updatePayload)
    .eq('id', existing.id);

  if (updateError) {
    console.error('DB update error:', updateError);
    return res.status(500).json({ error: 'Update failed. Please try again.' });
  }

  return res.status(200).json({ success: true, inscription_num, wallet });
};
