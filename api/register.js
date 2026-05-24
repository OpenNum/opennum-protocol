const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ORDINALS_API = 'https://ordinals.com';
const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { inscription_num, inscription_txid, wallet, signature, timestamp, display_name } = req.body || {};

  if (!inscription_num && inscription_num !== 0 || !inscription_txid || !wallet || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, inscription_txid, wallet, signature, timestamp' });
  }
  if (!Number.isInteger(inscription_num)) {
    return res.status(400).json({ error: 'inscription_num must be an integer' });
  }
  if (!/^[0-9a-f]{64}$/i.test(inscription_txid)) {
    return res.status(400).json({ error: 'inscription_txid must be a 64-character hex string' });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  // Verify inscription ownership via ordinals.com (JSON API)
  // If indexer is unreachable, fall through — signature is the primary proof.
  let ownershipVerified = false;
  try {
    const inscriptionId = `${inscription_txid}i0`;
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenNum-Indexer/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (ordRes.ok) {
      const data = await ordRes.json();
      if (data.address && data.address !== wallet) {
        return res.status(403).json({
          error: `Wallet does not own this inscription. Current owner: ${data.address.slice(0, 12)}...`
        });
      }
      if (data.number !== undefined && data.number !== inscription_num) {
        return res.status(400).json({
          error: `Inscription number mismatch. Txid belongs to #${data.number}, not #${inscription_num}.`
        });
      }
      ownershipVerified = true;
    } else {
      // Indexer returned error — log and continue; signature is sufficient for MVP
      console.warn(`ordinals.com returned ${ordRes.status} for ${inscription_txid}i0 — skipping ownership check`);
    }
  } catch (e) {
    // Indexer timeout or network error — log and continue
    console.warn('ordinals.com unreachable:', e.message);
  }

  // Verify secp256k1 signature (BIP322: Legacy, SegWit, Taproot)
  const message = `opennum:register:${inscription_num}:${wallet}:${timestamp}`;
  try {
    const valid = Verifier.verifySignature(wallet, message, signature);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid signature. Make sure you are signing with the correct wallet.' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Signature verification failed: ' + e.message });
  }

  // Check for existing active registration on this number
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
  if (existing) {
    if (existing.wallet_address === wallet) {
      return res.status(409).json({ error: 'This inscription is already registered to your wallet.' });
    }
    return res.status(409).json({ error: 'This inscription number is already registered by another wallet.' });
  }

  const { error: insertError } = await supabase
    .from('registrations')
    .insert({
      inscription_num,
      inscription_txid,
      wallet_address: wallet,
      signature,
      display_name: display_name || null,
      indexer_ruleset: 'ord-v0.18-mainnet',
      status: 'active'
    });

  if (insertError) {
    console.error('DB insert error:', insertError);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  return res.status(200).json({
    success: true,
    inscription_num,
    wallet,
    profile_url: `https://opennum.org/n/${inscription_num}`
  });
};
