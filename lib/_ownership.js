const { createClient } = require('@supabase/supabase-js');
const { emitEvent } = require('./_activity');
const { fetchOrdinalsOwner: fetchOwner } = require('./_ordinals');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const OWNER_CACHE_TTL_MS = 10 * 60 * 1000;

function isMissingOwnershipTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*(holder_periods|profile_versions)/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function isMissingOwnerCacheColumn(error) {
  return error && /(current_owner|owner_checked_at)/i.test(error.message || '');
}

function isMissingFollowsTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*follows/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

function snapshotProfile(registration, profile = {}) {
  return {
    display_name: profile.display_name !== undefined ? profile.display_name : (registration.display_name || null),
    bio: profile.bio !== undefined ? profile.bio : (registration.bio || null),
    links: profile.links !== undefined ? profile.links : (registration.links || {}),
    for_sale: profile.for_sale !== undefined ? !!profile.for_sale : !!registration.for_sale,
    ask_note: profile.ask_note !== undefined ? profile.ask_note : (registration.ask_note || null),
    satflow_url: profile.satflow_url !== undefined ? profile.satflow_url : (registration.satflow_url || null)
  };
}

async function fetchOrdinalsOwner(inscriptionId) {
  const ownership = await fetchOwner(inscriptionId);
  if (!ownership.verified) {
    console.warn('ordinals.com ownership lookup failed:', ownership.error || 'owner missing');
  }
  return ownership;
}

async function persistOwnerCache(registrationId, currentOwner, nextStatus) {
  const payload = {
    current_owner: currentOwner || null,
    owner_checked_at: new Date().toISOString()
  };
  if (nextStatus) payload.status = nextStatus;

  const { error } = await supabase
    .from('registrations')
    .update(payload)
    .eq('id', registrationId);

  if (isMissingOwnerCacheColumn(error)) {
    console.warn('current_owner cache columns are not installed; skipping owner cache persistence');
    return false;
  }
  if (error) {
    console.warn('Owner cache persistence failed:', error.message);
    return false;
  }
  return true;
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
    return null;
  }
  if (periodSelectError) {
    console.warn('Holder period lookup failed:', periodSelectError.message);
    return null;
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
      return null;
    }
    if (periodInsertError) {
      console.warn('Holder period insert failed:', periodInsertError.message);
      return null;
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
    return period.id;
  }
  if (versionSelectError) {
    console.warn('Profile version lookup failed:', versionSelectError.message);
    return period.id;
  }
  if (version) return period.id;

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
    return period.id;
  }
  if (versionInsertError) {
    console.warn('Profile version insert failed:', versionInsertError.message);
  }
  return period.id;
}

async function closeCurrentHolderPeriod(registration, endReason = 'transfer') {
  const { data: period, error: periodError } = await supabase
    .from('holder_periods')
    .select('id, is_current')
    .eq('inscription_num', registration.inscription_num)
    .eq('is_current', true)
    .maybeSingle();

  if (isMissingOwnershipTable(periodError)) {
    console.warn('holder_periods table is not installed; skipping period close');
    return null;
  }
  if (periodError) {
    console.warn('Holder period close lookup failed:', periodError.message);
    return null;
  }
  if (!period) return null;

  const { data: currentVersion, error: versionError } = await supabase
    .from('profile_versions')
    .select('id')
    .eq('holder_period_id', period.id)
    .eq('is_current', true)
    .maybeSingle();

  if (isMissingOwnershipTable(versionError)) {
    console.warn('profile_versions table is not installed; skipping profile version freeze');
  } else if (versionError) {
    console.warn('Profile version freeze lookup failed:', versionError.message);
  } else if (currentVersion) {
    const { error: freezeError } = await supabase
      .from('profile_versions')
      .update({ is_current: false })
      .eq('id', currentVersion.id);
    if (freezeError) {
      console.warn('Profile version freeze failed:', freezeError.message);
    }
  } else {
    const snapshot = snapshotProfile(registration);
    const { error: snapshotError } = await supabase
      .from('profile_versions')
      .insert({
        holder_period_id: period.id,
        inscription_num: registration.inscription_num,
        display_name: snapshot.display_name,
        bio: snapshot.bio,
        links: snapshot.links,
        for_sale: snapshot.for_sale,
        ask_note: snapshot.ask_note,
        satflow_url: snapshot.satflow_url,
        is_current: false
      });
    if (snapshotError && !isMissingOwnershipTable(snapshotError)) {
      console.warn('Profile version archival snapshot failed:', snapshotError.message);
    }
  }

  const { error: closeError } = await supabase
    .from('holder_periods')
    .update({
      ended_at: new Date().toISOString(),
      is_current: false,
      end_reason: endReason
    })
    .eq('id', period.id)
    .eq('is_current', true);

  if (closeError) {
    console.warn('Holder period close failed:', closeError.message);
  } else {
    const { error: followError } = await supabase
      .from('follows')
      .update({ status: 'ended_by_transfer' })
      .eq('target_num', registration.inscription_num)
      .eq('target_period_id', period.id)
      .eq('status', 'active');

    if (isMissingFollowsTable(followError)) {
      console.warn('follows table is not installed; skipping transfer follow close');
    } else if (followError) {
      console.warn('Transfer follow close failed:', followError.message);
    }

    await emitEvent({
      event_type: 'ownership_transferred',
      subject_num: registration.inscription_num,
      holder_period_id: period.id,
      payload: {
        end_reason: endReason,
        previous_wallet: registration.wallet_address || null
      },
      dedupe_key: `transfer:${registration.inscription_num}:${period.id}`
    });
  }

  return period.id;
}

async function syncCurrentProfileVersion(registration, profile) {
  const periodId = await ensureHolderPeriodAndProfileVersion({
    inscription_num: registration.inscription_num,
    wallet: registration.wallet_address,
    profile,
    start_reason: 'register'
  });
  if (!periodId) return;

  const { data: currentVersion, error: versionError } = await supabase
    .from('profile_versions')
    .select('id')
    .eq('holder_period_id', periodId)
    .eq('is_current', true)
    .maybeSingle();

  if (isMissingOwnershipTable(versionError)) {
    console.warn('profile_versions table is not installed; skipping profile version sync');
    return;
  }
  if (versionError) {
    console.warn('Profile version sync lookup failed:', versionError.message);
    return;
  }

  if (currentVersion) {
    const { error: freezeError } = await supabase
      .from('profile_versions')
      .update({ is_current: false })
      .eq('id', currentVersion.id);
    if (freezeError) {
      console.warn('Profile version sync freeze failed:', freezeError.message);
      return;
    }
  }

  const snapshot = snapshotProfile(registration, profile);
  const { error: insertError } = await supabase
    .from('profile_versions')
    .insert({
      holder_period_id: periodId,
      inscription_num: registration.inscription_num,
      display_name: snapshot.display_name,
      bio: snapshot.bio,
      links: snapshot.links,
      for_sale: snapshot.for_sale,
      ask_note: snapshot.ask_note,
      satflow_url: snapshot.satflow_url,
      is_current: true
    });

  if (insertError && !isMissingOwnershipTable(insertError)) {
    console.warn('Profile version sync insert failed:', insertError.message);
  }
}

async function resolveOwnershipState(registration, { persist = true } = {}) {
  const inscriptionId = registration.inscription_id || (registration.inscription_txid ? `${registration.inscription_txid}i0` : null);
  if (!inscriptionId) {
    return {
      currentOwner: registration.current_owner || null,
      ownershipVerified: false,
      ownerMismatch: false,
      ownerCheckedAt: registration.owner_checked_at || null,
      cacheHit: false
    };
  }

  const checkedAtMs = registration.owner_checked_at ? new Date(registration.owner_checked_at).getTime() : 0;
  const freshCache = checkedAtMs && (Date.now() - checkedAtMs) <= OWNER_CACHE_TTL_MS;

  if (freshCache) {
    const currentOwner = registration.current_owner || null;
    const ownerMismatch = !!(currentOwner && registration.wallet_address && currentOwner !== registration.wallet_address);
    return {
      currentOwner,
      ownershipVerified: !!currentOwner,
      ownerMismatch,
      ownerCheckedAt: registration.owner_checked_at || null,
      cacheHit: true
    };
  }

  const ownership = await fetchOrdinalsOwner(inscriptionId);
  if (!ownership.verified) {
    return {
      currentOwner: registration.current_owner || null,
      ownershipVerified: !!registration.current_owner,
      ownerMismatch: !!(registration.current_owner && registration.wallet_address && registration.current_owner !== registration.wallet_address),
      ownerCheckedAt: registration.owner_checked_at || null,
      cacheHit: false
    };
  }

  const ownerMismatch = !!(ownership.owner && registration.wallet_address && ownership.owner !== registration.wallet_address);
  if (persist) {
    if (ownerMismatch) {
      await closeCurrentHolderPeriod(registration, 'transfer');
      await persistOwnerCache(registration.id, ownership.owner, 'dormant');
    } else {
      await persistOwnerCache(registration.id, ownership.owner, registration.status === 'dormant' ? 'active' : undefined);
    }
  }

  return {
    currentOwner: ownership.owner,
    ownershipVerified: ownership.verified,
    ownerMismatch,
    ownerCheckedAt: new Date().toISOString(),
    cacheHit: false
  };
}

module.exports = {
  OWNER_CACHE_TTL_MS,
  closeCurrentHolderPeriod,
  ensureHolderPeriodAndProfileVersion,
  fetchOrdinalsOwner,
  isMissingOwnershipTable,
  resolveOwnershipState,
  snapshotProfile,
  syncCurrentProfileVersion
};
