const ORDNET_ORIGIN = 'https://ord.net';
const SALES_WINDOW_MINUTES = 24 * 60;

const TIER_DEFINITIONS = [
  { key: 'sub100', label: 'Sub 100', min: 0, max: 100 },
  { key: 'sub1k', label: 'Sub 1K', min: 100, max: 1000 },
  { key: 'sub10k', label: 'Sub 10K', min: 1000, max: 10000 }
];

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textOnly(value) {
  return decodeHtml(String(value || '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function relativeAgeMinutes(value) {
  const match = String(value || '').trim().match(/^(\d+)([mhd])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2].toLowerCase() === 'm') return amount;
  if (match[2].toLowerCase() === 'h') return amount * 60;
  return amount * 24 * 60;
}

function saleTier(inscriptionNumber) {
  return TIER_DEFINITIONS.find((tier) => inscriptionNumber >= tier.min && inscriptionNumber < tier.max) || null;
}

function firstTextLink(row, href) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = row.matchAll(new RegExp(`<a[^>]+href="${escapedHref}"[^>]*>([\\s\\S]*?)<\\/a>`, 'g'));
  for (const match of matches) {
    const text = textOnly(match[1]);
    if (text) return text;
  }
  return null;
}

function desktopRows(html) {
  const header = html.indexOf('grid-cols-[4.5rem_minmax(0,1.5fr)');
  if (header < 0) return [];
  const listStart = html.indexOf('<ul>', header);
  const listEnd = html.indexOf('</ul>', listStart);
  if (listStart < 0 || listEnd < 0) return [];
  return [...html.slice(listStart, listEnd).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
}

function parseSaleRow(row) {
  const numberMatch = row.match(/href="\/inscription\/(\d+)"/);
  if (!numberMatch) return null;
  const inscriptionNumber = Number(numberMatch[1]);
  const tier = saleTier(inscriptionNumber);
  if (!tier) return null;

  const txMatch = row.match(/href="https:\/\/mempool\.space\/tx\/([0-9a-f]{64})"[^>]*>([\s\S]*?)<\/a>/i);
  const age = txMatch ? textOnly(txMatch[2]).match(/\d+[mhd]/i)?.[0]?.toLowerCase() : null;
  const ageMinutes = relativeAgeMinutes(age);
  if (ageMinutes === null || ageMinutes >= SALES_WINDOW_MINUTES) return null;

  const href = `/inscription/${inscriptionNumber}`;
  const collectionMatch = row.match(/href="\/collection\/([a-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const thumbnailMatch = row.match(/src="(https:\/\/render\.ord\.net\/[^"\s]+)"/i);
  const inscriptionId = thumbnailMatch?.[1].match(/\/snapshots\/([0-9a-f]{64}i\d+)\//i)?.[1] || null;
  const amount = textOnly(row.match(/text-os-error[^"<>]*">([^<]+)</i)?.[1]);
  const usd = textOnly(row.match(/<span>\$([\d,.]+)<\/span>/i)?.[1]);
  if (!amount) return null;

  return {
    inscription_num: inscriptionNumber,
    inscription_id: inscriptionId,
    name: firstTextLink(row, href) || `Inscription #${inscriptionNumber}`,
    collection: collectionMatch ? textOnly(collectionMatch[2]) : null,
    collection_slug: collectionMatch?.[1] || null,
    price: amount,
    price_unit: amount.includes('.') ? 'BTC' : 'sats',
    price_usd: usd ? Number(usd.replace(/,/g, '')) : null,
    age,
    age_minutes: ageMinutes,
    txid: txMatch?.[1] || null,
    thumbnail_url: thumbnailMatch ? decodeHtml(thumbnailMatch[1]) : null,
    source_url: `${ORDNET_ORIGIN}${href}`,
    tier: tier.key
  };
}

function parseOrdNetSalesPage(html) {
  if (typeof html !== 'string') return { sales: [], next_url: null, oldest_age_minutes: null };
  const rows = desktopRows(html);
  const sales = rows.map(parseSaleRow).filter(Boolean);
  const rowAges = rows.flatMap((row) => [...row.matchAll(/title="View transaction on mempool\.space"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => relativeAgeMinutes(textOnly(match[1]).match(/\d+[mhd]/i)?.[0]))
    .filter(Number.isFinite));
  const nextMatch = html.match(/href="(\/sales\?cursor=[^"#]+(?:&amp;|&)dir=next)"/i);
  return {
    sales,
    next_url: nextMatch ? `${ORDNET_ORIGIN}${decodeHtml(nextMatch[1])}` : null,
    oldest_age_minutes: rowAges.length ? Math.max(...rowAges) : null
  };
}

function groupSales(sales) {
  const grouped = Object.fromEntries(TIER_DEFINITIONS.map((tier) => [tier.key, {
    key: tier.key,
    label: tier.label,
    min: tier.min,
    max: tier.max,
    sales: []
  }]));
  for (const sale of sales) {
    if (grouped[sale.tier]) grouped[sale.tier].sales.push(sale);
  }
  for (const tier of Object.values(grouped)) {
    tier.sales.sort((a, b) => a.age_minutes - b.age_minutes || a.inscription_num - b.inscription_num);
    tier.count = tier.sales.length;
  }
  return grouped;
}

async function fetchOrdNetSales({ fetchImpl = globalThis.fetch, maxPages = 14, timeoutMs = 6000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  let url = `${ORDNET_ORIGIN}/sales`;
  let pagesFetched = 0;
  let partial = false;
  const sales = [];
  const seen = new Set();

  while (url && pagesFetched < maxPages) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'OpenNum-Sales-Feed/1.0 (https://opennum.org)'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`ORD.NET returned ${response.status}`);
    } catch (error) {
      if (!pagesFetched) throw error;
      partial = true;
      break;
    }

    const parsed = parseOrdNetSalesPage(await response.text());
    pagesFetched += 1;
    for (const sale of parsed.sales) {
      const dedupeKey = `${sale.txid || 'no-tx'}:${sale.inscription_num}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        sales.push(sale);
      }
    }
    url = parsed.oldest_age_minutes !== null && parsed.oldest_age_minutes >= SALES_WINDOW_MINUTES
      ? null
      : parsed.next_url;
  }

  if (url) partial = true;
  return {
    window: '24h',
    generated_at: new Date().toISOString(),
    source: { name: 'ORD.NET', url: `${ORDNET_ORIGIN}/sales` },
    partial,
    pages_fetched: pagesFetched,
    tiers: groupSales(sales)
  };
}

module.exports = {
  SALES_WINDOW_MINUTES,
  TIER_DEFINITIONS,
  fetchOrdNetSales,
  groupSales,
  parseOrdNetSalesPage,
  relativeAgeMinutes,
  saleTier
};
