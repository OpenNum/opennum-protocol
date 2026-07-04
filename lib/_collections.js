const { createClient } = require('@supabase/supabase-js');

// Collection membership detection with DB caching.
// Source: Ordinals Wallet turbo API (free, no key). Results are cached in
// inscription_collections so each inscription hits the external API once,
// then served from our own table (anon-readable, service-role writable).

const TURBO_API = 'https://turbo.ordinalswallet.com';
const NONE_SLUG = '__none__'; // sentinel: checked, no collection found
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // re-ask turbo weekly for sentinel rows

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function tableMissing(error) {
  return error && (
    error.code === '42P01' ||
    /relation .*inscription_collections/i.test(error.message || '') ||
    /Could not find the table/i.test(error.message || '')
  );
}

// Most specific number-tier collection (marketplaces list these as real collections,
// but their per-inscription assignment is unreliable — e.g. a sub-10k number tagged
// "Sub 100k". We always derive the tier from the number itself.)
function tierCollection(num) {
  if (!Number.isInteger(num) || num < 0) return null;
  if (num < 100) return { slug: 'sub-100', name: 'Sub 100' };
  if (num < 1000) return { slug: 'sub-1k', name: 'Sub 1k' };
  if (num < 10000) return { slug: 'sub-10k', name: 'Sub 10K' };
  if (num < 100000) return { slug: 'sub-100k', name: 'Sub 100k' };
  return null;
}

function isTierSlug(slug) {
  return /^sub-\d+(k)?$/i.test(String(slug || ''));
}

async function fetchTurboCollection(inscriptionId) {
  const res = await fetch(`${TURBO_API}/inscription/${inscriptionId}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'OpenNum-Resolver/1.0 (opennum.org)' },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error(`turbo ${res.status}`);
  const data = await res.json();
  const c = data && data.collection;
  if (!c || !c.slug) return null;
  return { slug: String(c.slug).slice(0, 80), name: String(c.name || c.slug).slice(0, 120) };
}

async function upsertRow(inscriptionId, slug, name) {
  const { error } = await supabase
    .from('inscription_collections')
    .upsert(
      { inscription_id: inscriptionId, collection_slug: slug, collection_name: name, source: 'turbo', verified_at: new Date().toISOString() },
      { onConflict: 'inscription_id,collection_slug,source' }
    );
  if (error && !tableMissing(error)) console.warn('collection upsert failed:', error.message);
}

// Returns [{ collection_slug, collection_name, source, verified_at }] — never throws.
async function resolveCollections(inscriptionId, num) {
  if (!inscriptionId) return [];
  let rows = [];
  try {
    const { data, error } = await supabase
      .from('inscription_collections')
      .select('collection_slug, collection_name, source, verified_at')
      .eq('inscription_id', inscriptionId)
      .order('collection_name', { ascending: true });
    if (error) {
      if (!tableMissing(error)) console.warn('collection lookup failed:', error.message);
      return [];
    }
    rows = data || [];
  } catch (_) {
    return [];
  }

  const real = rows.filter((r) => r.collection_slug !== NONE_SLUG);
  if (real.length) return real;

  const sentinel = rows.find((r) => r.collection_slug === NONE_SLUG);
  const sentinelFresh = sentinel && (Date.now() - new Date(sentinel.verified_at).getTime()) < RECHECK_MS;
  if (sentinelFresh) return [];

  // Not cached (or sentinel expired): ask turbo once, cache the answer.
  const tier = tierCollection(num);
  try {
    let found = await fetchTurboCollection(inscriptionId);
    // Tier meta-collections from turbo are unreliable — replace with the tier
    // computed from the number. Same fallback when there is no collection at all:
    // low numbers still belong to their tier circle.
    if ((!found || isTierSlug(found.slug)) && tier) found = tier;
    if (found) {
      await upsertRow(inscriptionId, found.slug, found.name);
      return [{ collection_slug: found.slug, collection_name: found.name, source: 'turbo', verified_at: new Date().toISOString() }];
    }
    await upsertRow(inscriptionId, NONE_SLUG, '');
  } catch (_) { /* API down: no sentinel write, retry on a later view */ }
  return [];
}

// Other active OpenNum registrations in the same collection(s), excluding self.
async function collectionMembers(slugs, selfInscriptionId, limit = 12) {
  if (!slugs || !slugs.length) return [];
  try {
    const { data: rows, error } = await supabase
      .from('inscription_collections')
      .select('inscription_id, collection_slug, collection_name')
      .in('collection_slug', slugs)
      .neq('inscription_id', selfInscriptionId)
      .limit(200);
    if (error || !rows || !rows.length) return [];

    const ids = [...new Set(rows.map((r) => r.inscription_id))];
    const { data: regs, error: regError } = await supabase
      .from('registrations')
      .select('inscription_num, inscription_id, display_name, status')
      .in('inscription_id', ids)
      .eq('status', 'active')
      .limit(limit);
    if (regError || !regs) return [];

    const slugById = new Map(rows.map((r) => [r.inscription_id, r.collection_slug]));
    return regs.map((r) => ({
      num: r.inscription_num,
      display_name: r.display_name || null,
      inscription_id: r.inscription_id,
      collection_slug: slugById.get(r.inscription_id) || slugs[0]
    }));
  } catch (_) {
    return [];
  }
}

module.exports = { resolveCollections, collectionMembers };
