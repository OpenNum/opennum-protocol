const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function isMissingActivityTable(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*activity_events/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

async function emitEvent({
  event_type,
  subject_num,
  actor_num = null,
  holder_period_id = null,
  visibility = 'public',
  payload = {},
  dedupe_key = null
}) {
  if (!event_type || subject_num === undefined || subject_num === null) return false;

  try {
    const { error } = await supabase
      .from('activity_events')
      .insert({
        event_type,
        subject_num,
        actor_num,
        holder_period_id,
        visibility,
        payload,
        dedupe_key
      });

    if (!error) return true;
    if (error.code === '23505') return false;
    if (isMissingActivityTable(error)) {
      console.warn('activity_events table is not installed; event skipped');
      return false;
    }

    console.warn('Activity event insert failed:', error.message);
    return false;
  } catch (error) {
    console.warn('Activity event insert threw:', error?.message || error);
    return false;
  }
}

async function currentHolderPeriodId(inscriptionNum) {
  const { data, error } = await supabase
    .from('holder_periods')
    .select('id')
    .eq('inscription_num', inscriptionNum)
    .eq('is_current', true)
    .maybeSingle();

  if (error) return null;
  return data?.id || null;
}

module.exports = {
  currentHolderPeriodId,
  emitEvent,
  isMissingActivityTable
};
