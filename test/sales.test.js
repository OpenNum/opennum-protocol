const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOrdNetSalesPage,
  relativeAgeMinutes,
  saleTier
} = require('../lib/_sales');

const TXID = '3e7e1fc18232f791df828307f18220a5bcfc71d4951111857a2dbb87085eaacd';
const INSCRIPTION_ID = 'd864c874df255830938ea759300b87dd8efe696227eb3a74676dcbdcec7a6616i0';

function row(number, age = '2m', amount = '0.028') {
  return `<li class="grid grid-cols-[4.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]">
    <a href="https://mempool.space/tx/${TXID}" title="View transaction on mempool.space">${age}</a>
    <a href="/inscription/${number}"><img src="https://render.ord.net/v8/snapshots/${INSCRIPTION_ID}/512.webp" alt="NodeMonke #1253"></a>
    <a href="/inscription/${number}">NodeMonke #1253</a>
    <a href="/collection/nodemonkes">NodeMonkes</a>
    <span class="text-os-error tabular-nums text-os-error">${amount}</span>
    <span>$2,187</span>
  </li>`;
}

test('uses mutually exclusive number tiers', () => {
  assert.equal(saleTier(99).key, 'sub100');
  assert.equal(saleTier(100).key, 'sub1k');
  assert.equal(saleTier(9999).key, 'sub10k');
  assert.equal(saleTier(10000), null);
});

test('parses relative ages', () => {
  assert.equal(relativeAgeMinutes('12m'), 12);
  assert.equal(relativeAgeMinutes('3h'), 180);
  assert.equal(relativeAgeMinutes('1d'), 1440);
  assert.equal(relativeAgeMinutes('now'), null);
});

test('parses an ORD.NET desktop sale row and pagination', () => {
  const html = `<div class="grid grid-cols-[4.5rem_minmax(0,1.5fr)"><ul>${row(9164)}</ul></div>
    <a href="/sales?cursor=abc&amp;dir=next">Next</a>`;
  const parsed = parseOrdNetSalesPage(html);
  assert.equal(parsed.sales.length, 1);
  assert.equal(parsed.sales[0].inscription_num, 9164);
  assert.equal(parsed.sales[0].tier, 'sub10k');
  assert.equal(parsed.sales[0].price, '0.028');
  assert.equal(parsed.sales[0].price_unit, 'BTC');
  assert.equal(parsed.sales[0].price_usd, 2187);
  assert.equal(parsed.sales[0].inscription_id, INSCRIPTION_ID);
  assert.equal(parsed.oldest_age_minutes, 2);
  assert.equal(parsed.next_url, 'https://ord.net/sales?cursor=abc&dir=next');
});

test('drops rows outside the last 24 hours and above Sub 10K', () => {
  const html = `<div class="grid grid-cols-[4.5rem_minmax(0,1.5fr)"><ul>
    ${row(42, '1d')}${row(10000, '3m')}
  </ul></div>`;
  const parsed = parseOrdNetSalesPage(html);
  assert.deepEqual(parsed.sales, []);
  assert.equal(parsed.oldest_age_minutes, 1440);
});
