const { createClient } = require('@supabase/supabase-js');
const { Verifier } = require('bip322-js');
const { setCors, sanitizeText, sanitizeUrl, sanitizeLinks, checkRateLimit, sendRateLimit } = require('./_security');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const ORDINALS_API = 'https://ordinals.com';
const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000;

function stripMarketFields(payload) {
  delete payload.for_sale;
  delete payload.ask_note;
  delete payload.satflow_url;
}

function isMissingMarketColumn(error) {
  return /(for_sale|ask_note|satflow_url)/i.test(error?.message || '');
}

function isMissingOwnershipTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*(holder_periods|profile_versions)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

async function activeRegistrationForWallet(wallet) {
  const { data, error } = await supabase
    .from('registrations')
    .select('id, inscription_num, wallet_address, status')
    .eq('wallet_address', wallet)
    .eq('status', 'active')
    .order('inscription_num', { ascending: true })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

async function ensureHolderPeriodAndProfileVersion({ inscription_num, wallet, profile, start_reason = 'register' }) {
  let { data: period, error: periodSelectError } = await supabase
    .from('holder_periods')
    .select('id')
    .eq('inscription_num', inscription_num)
    .eq('is_current', true)
    .maybeSingle();

  if (isMissingOwnershipTable(periodSelectError)) {
    console.warn('holder_periods table is not installed; skipping holder period creation');
    return;
  }
  if (periodSelectError) {
    console.warn('Holder period lookup failed:', periodSelectError.message);
    return;
  }

  if (!period) {
    const { data: insertedPeriod, error: periodInsertError } = await supabase
      .from('holder_periods')
      .insert({
        inscription_num,
        wallet_address: wallet,
        start_reason,
        is_current: true
      })
      .select('id')
      .single();

    if (isMissingOwnershipTable(periodInsertError)) {
      console.warn('holder_periods table is not installed; skipping holder period creation');
      return;
    }
    if (periodInsertError) {
      console.warn('Holder period insert failed:', periodInsertError.message);
      return;
    }
    period = insertedPeriod;
  }

  const { data: version, error: versionSelectError } = await supabase
    .from('profile_versions')
    .select('id')
    .eq('holder_period_id', period.id)
    .eq('is_current', true)
    .maybeSingle();

  if (isMissingOwnershipTable(versionSelectError)) {
    console.warn('profile_versions table is not installed; skipping profile version creation');
    return;
  }
  if (versionSelectError) {
    console.warn('Profile version lookup failed:', versionSelectError.message);
    return;
  }
  if (version) return;

  const { error: versionInsertError } = await supabase
    .from('profile_versions')
    .insert({
      holder_period_id: period.id,
      inscription_num,
      display_name: profile.display_name || null,
      bio: profile.bio || null,
      links: profile.links || {},
      for_sale: !!profile.for_sale,
      ask_note: profile.ask_note || null,
      satflow_url: profile.satflow_url || null,
      is_current: true
    });

  if (isMissingOwnershipTable(versionInsertError)) {
    console.warn('profile_versions table is not installed; skipping profile version creation');
    return;
  }
  if (versionInsertError) {
    console.warn('Profile version insert failed:', versionInsertError.message);
  }
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rate = checkRateLimit(req, 'register', 10, 60 * 60 * 1000);
  if (rate.limited) return sendRateLimit(res, rate.retryAfter);

  const { inscription_num, inscription_txid, inscription_id, wallet, signature, timestamp, display_name, links, for_sale, ask_note, satflow_url } = req.body || {};

  if (!inscription_num && inscription_num !== 0 || !inscription_txid || !wallet || !signature || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: inscription_num, inscription_txid, wallet, signature, timestamp' });
  }
  if (!Number.isInteger(inscription_num)) {
    return res.status(400).json({ error: 'inscription_num must be an integer' });
  }
  if (!/^[0-9a-f]{64}$/i.test(inscription_txid)) {
    return res.status(400).json({ error: 'inscription_txid must be a 64-character hex string' });
  }
  if (inscription_id && !/^[0-9a-f]{64}i\d+$/i.test(inscription_id)) {
    return res.status(400).json({ error: 'inscription_id must use the format <64-character-txid>i<index>' });
  }
  if (inscription_id && !inscription_id.toLowerCase().startsWith(inscription_txid.toLowerCase() + 'i')) {
    return res.status(400).json({ error: 'inscription_id does not match inscription_txid' });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp * 1000) > MAX_TIMESTAMP_DRIFT_MS) {
    return res.status(400).json({ error: 'Timestamp expired. Please re-sign and try again.' });
  }

  // Verify inscription ownership via ordinals.com (JSON API)
  // If indexer is unreachable, fall through — signature is the primary proof.
  let ownershipVerified = false;
  try {
    const inscriptionId = inscription_id || `${inscription_txid}i0`;
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
      console.warn(`ordinals.com returned ${ordRes.status} for ${inscriptionId} — skipping ownership check`);
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

  const { data: activeWalletRegistration, error: walletSelectError } = await activeRegistrationForWallet(wallet);
  if (walletSelectError) {
    console.error('DB wallet select error:', walletSelectError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }

  // Check for existing registration on this number. Inactive rows can be reactivated by the current on-chain owner.
  const { data: existing, error: selectError } = await supabase
    .from('registrations')
    .select('id, wallet_address, status')
    .eq('inscription_num', inscription_num)
    .order('registered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error('DB select error:', selectError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
  if (existing) {
    if (existing.status === 'active' && existing.wallet_address === wallet) {
      return res.status(409).json({ error: 'This inscription is already registered to your wallet.' });
    }
    if (activeWalletRegistration && activeWalletRegistration.inscription_num !== inscription_num) {
      return res.status(409).json({
        error: `This wallet already has active OpenNum #${activeWalletRegistration.inscription_num}. Unbind it before registering another number.`,
        active_registration: {
          inscription_num: activeWalletRegistration.inscription_num,
          profile_url: `https://opennum.org/n/${activeWalletRegistration.inscription_num}`
        }
      });
    }
    // Inscription is registered to a different wallet, or was previously unbound/dormant.
    // If ordinals.com confirmed the current on-chain owner is the requester,
    // the inscription can be transferred/reactivated.
    if (!ownershipVerified) {
      return res.status(409).json({
        error: 'This inscription number has an existing OpenNum record. On-chain ownership could not be verified — please try again.'
      });
    }
    // Verified transfer/reactivation: update existing row in place (preserves inscription_num uniqueness)
    const updatePayload = {
      inscription_txid,
      inscription_id: inscription_id || `${inscription_txid}i0`,
      wallet_address: wallet,
      signature,
      display_name: sanitizeText(display_name, 48),
      for_sale: !!for_sale,
      ask_note: sanitizeText(ask_note, 240),
      satflow_url: sanitizeUrl(satflow_url),
      indexer_ruleset: 'ord-v0.18-mainnet',
      status: 'active',
      updated_at: new Date().toISOString()
    };
    // links is optional — only include if provided (requires DB migration: ALTER TABLE registrations ADD COLUMN links JSONB DEFAULT '{}')
    if (links && typeof links === 'object') updatePayload.links = sanitizeLinks(links);

    let { error: updateError } = await supabase
      .from('registrations')
      .update(updatePayload)
      .eq('id', existing.id);

    if (updateError && isMissingMarketColumn(updateError)) {
      stripMarketFields(updatePayload);
      ({ error: updateError } = await supabase
        .from('registrations')
        .update(updatePayload)
        .eq('id', existing.id));
    }

    if (updateError && /inscription_id/i.test(updateError.message || '')) {
      delete updatePayload.inscription_id;
      ({ error: updateError } = await supabase
        .from('registrations')
        .update(updatePayload)
        .eq('id', existing.id));
    }

    if (updateError) {
      console.error('DB update error:', updateError);
      return res.status(500).json({ error: 'Transfer failed. Please try again.' });
    }

    return res.status(200).json({
      success: true,
      transferred: existing.status === 'active',
      reactivated: existing.status !== 'active',
      inscription_num,
      wallet,
      profile_url: `https://opennum.org/n/${inscription_num}`
    });
  }

  if (activeWalletRegistration) {
    return res.status(409).json({
      error: `This wallet already has active OpenNum #${activeWalletRegistration.inscription_num}. Unbind it before registering another number.`,
      active_registration: {
        inscription_num: activeWalletRegistration.inscription_num,
        profile_url: `https://opennum.org/n/${activeWalletRegistration.inscription_num}`
      }
    });
  }

  const insertPayload = {
    inscription_num,
    inscription_txid,
    inscription_id: inscription_id || `${inscription_txid}i0`,
    wallet_address: wallet,
    signature,
    display_name: sanitizeText(display_name, 48),
    for_sale: !!for_sale,
    ask_note: sanitizeText(ask_note, 240),
    satflow_url: sanitizeUrl(satflow_url),
    indexer_ruleset: 'ord-v0.18-mainnet',
    status: 'active'
  };
  // links is optional — only include if provided (requires DB migration)
  if (links && typeof links === 'object') insertPayload.links = sanitizeLinks(links);

  let { error: insertError } = await supabase
    .from('registrations')
    .insert(insertPayload);

  if (insertError && isMissingMarketColumn(insertError)) {
    stripMarketFields(insertPayload);
    ({ error: insertError } = await supabase
      .from('registrations')
      .insert(insertPayload));
  }

  if (insertError && /inscription_id/i.test(insertError.message || '')) {
    delete insertPayload.inscription_id;
    ({ error: insertError } = await supabase
      .from('registrations')
      .insert(insertPayload));
  }

  if (insertError) {
    console.error('DB insert error:', insertError);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  await ensureHolderPeriodAndProfileVersion({
    inscription_num,
    wallet,
    profile: {
      display_name: insertPayload.display_name,
      bio: insertPayload.bio,
      links: insertPayload.links || {},
      for_sale: insertPayload.for_sale,
      ask_note: insertPayload.ask_note,
      satflow_url: insertPayload.satflow_url
    },
    start_reason: 'register'
  });

  return res.status(200).json({
    success: true,
    inscription_num,
    wallet,
    profile_url: `https://opennum.org/n/${inscription_num}`
  });
};
