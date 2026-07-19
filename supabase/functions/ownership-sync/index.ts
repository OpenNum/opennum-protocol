const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENNUM_API_ORIGIN = 'https://opennum.org';
const BATCH_SIZE = 50;
const CONCURRENCY = 8;

type Registration = {
  inscription_num: number;
  owner_checked_at: string | null;
};

type CheckResult = {
  inscription_num: number;
  ok: boolean;
  status?: string;
  changed?: boolean;
  error?: string;
};

async function loadStalestActiveRegistrations(): Promise<Registration[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service environment is unavailable');
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/registrations`);
  url.searchParams.set('select', 'inscription_num,owner_checked_at');
  url.searchParams.set('status', 'eq.active');
  url.searchParams.set('order', 'owner_checked_at.asc.nullsfirst,inscription_num.asc');
  url.searchParams.set('limit', String(BATCH_SIZE));

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Registration lookup failed with ${response.status}`);
  }
  return await response.json();
}

async function checkRegistration(registration: Registration, runId: string): Promise<CheckResult> {
  const url = new URL('/api/resolve', OPENNUM_API_ORIGIN);
  url.searchParams.set('num', String(registration.inscription_num));
  url.searchParams.set('ownership_sync', runId);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'OpenNum-Ownership-Sync/1.0'
      },
      signal: AbortSignal.timeout(12_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        inscription_num: registration.inscription_num,
        ok: false,
        error: `Resolver returned ${response.status}`
      };
    }
    return {
      inscription_num: registration.inscription_num,
      ok: true,
      status: body.status,
      changed: body.status === 'dormant' || body.claim_required === true
    };
  } catch (error) {
    return {
      inscription_num: registration.inscription_num,
      ok: false,
      error: error instanceof Error ? error.message : 'Resolver request failed'
    };
  }
}

async function runWithConcurrency(registrations: Registration[], runId: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (let index = 0; index < registrations.length; index += CONCURRENCY) {
    const chunk = registrations.slice(index, index + CONCURRENCY);
    results.push(...await Promise.all(chunk.map((registration) => checkRegistration(registration, runId))));
  }
  return results;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const runId = crypto.randomUUID();
    const registrations = await loadStalestActiveRegistrations();
    const results = await runWithConcurrency(registrations, runId);
    const failed = results.filter((result) => !result.ok);
    const changed = results.filter((result) => result.changed);

    console.log('ownership sync completed', {
      run_id: runId,
      checked: results.length,
      changed: changed.length,
      failed: failed.length
    });

    return new Response(JSON.stringify({
      ok: failed.length === 0,
      run_id: runId,
      checked: results.length,
      changed: changed.map((result) => result.inscription_num),
      failures: failed
    }), {
      status: failed.length === results.length && results.length > 0 ? 502 : 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('ownership sync failed', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Ownership sync failed'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
});
