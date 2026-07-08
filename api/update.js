const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, sanitizeText, sanitizeUrl, sanitizeLinks, checkRateLimit, sendRateLimit } = require('../lib/_security');
const { syncCurrentProfileVersion } = require('../lib/_ownership');
const { currentHolderPeriodId, emitEvent } = require('../lib/_activity');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;
const ORDINALS_API = 'https://ordinals.com';

function stripMarketFields(payload) {
  delete payload.for_sale;
  delete payload.ask_note;
  delete payload.satflow_url;
  delete payload.ask_headline;
  delete payload.ask_price;
}

// Listing columns (ask_headline / ask_price) may not exist yet — strip just
// those and retry before falling back to stripping all market fields.
function stripListingFields(payload) {
  delete payload.ask_headline;
  delete payload.ask_price;
}

async function currentOwnerFor(inscriptionId) {
  try {
    const ordRes = await fetch(`${ORDINALS_API}/inscription/${inscriptionId}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!ordRes.ok) return { owner: null, verified: false };
    const raw = await ordRes.json();
    return { owner: raw.address || null, verified: !!raw.address };
  } catch (_) {
    return { owner: null, verified: false };
  }
}

module.exports = async (req, res) => {
  setCors(req, res, 'PATCH, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const rate = checkRateLimit(req, 'update', 30, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, wallet, signature, timestamp, display_name, bio, links, for_sale, ask_note, ask_headline, ask_price, satflow_url } = req.body || {};

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
    console.error('Signature verification error:', e && e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Confirm this wallet is the current owner of this OpenNum
  const { data: existing, error: selectError } = await supabase
    .from('registrations')
    .select('*')
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
  const inscriptionId = existing.inscription_id || (existing.inscription_txid ? `${existing.inscription_txid}i0` : null);
  const ownership = inscriptionId ? await currentOwnerFor(inscriptionId) : { owner: null, verified: false };
  if (ownership.verified && ownership.owner && ownership.owner !== wallet) {
    return res.status(409).json({
      error: 'This inscription has moved on-chain. The current holder must claim it before editing this OpenNum.'
    });
  }

  // Build update — only update editable fields
  const updatePayload = {
    display_name: sanitizeText(display_name, 48),
    bio: sanitizeText(bio, 200),
    for_sale: !!for_sale,
    ask_note: sanitizeText(ask_note, 240),
    ask_headline: sanitizeText(ask_headline, 80),
    ask_price: sanitizeText(ask_price, 40),
    satflow_url: sanitizeUrl(satflow_url),
    updated_at: new Date().toISOString()
  };
  // links requires DB migration: ALTER TABLE registrations ADD COLUMN links JSONB DEFAULT '{}'
  if (links !== undefined) updatePayload.links = sanitizeLinks(links);

  let { error: updateError } = await supabase
    .from('registrations')
    .update(updatePayload)
    .eq('id', existing.id);

  if (updateError && /(ask_headline|ask_price)/i.test(updateError.message || '')) {
    stripListingFields(updatePayload);
    ({ error: updateError } = await supabase
      .from('registrations')
      .update(updatePayload)
      .eq('id', existing.id));
  }

  if (updateError && /(for_sale|ask_note|satflow_url)/i.test(updateError.message || '')) {
    stripMarketFields(updatePayload);
    ({ error: updateError } = await supabase
      .from('registrations')
      .update(updatePayload)
      .eq('id', existing.id));
  }

  if (updateError) {
    console.error('DB update error:', updateError);
    return res.status(500).json({ error: 'Update failed. Please try again.' });
  }

  await syncCurrentProfileVersion(existing, {
    display_name: updatePayload.display_name,
    bio: updatePayload.bio,
    links: updatePayload.links !== undefined ? updatePayload.links : (existing.links || {}),
    for_sale: updatePayload.for_sale,
    ask_note: updatePayload.ask_note,
    satflow_url: updatePayload.satflow_url
  });

  if (!existing.for_sale && updatePayload.for_sale) {
    const periodId = await currentHolderPeriodId(inscription_num);
    await emitEvent({
      event_type: 'marked_for_sale',
      subject_num: inscription_num,
      holder_period_id: periodId,
      payload: {
        ask_note: updatePayload.ask_note || null,
        satflow_url: updatePayload.satflow_url || null
      },
      dedupe_key: periodId ? `sale:${inscription_num}:${periodId}` : `sale:${inscription_num}`
    });
  }

  return res.status(200).json({ success: true, inscription_num, wallet });
};
