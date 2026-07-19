const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchOrdinalsInscription,
  fetchOrdinalsOwner,
  parseHtmlInscription,
  parseJsonInscription
} = require('../lib/_ordinals');

const ID = '1b91e5a71c07e3978b51113b3920f7e028baa32536d6ac8fd42ba59728028c14i0';
const OWNER = 'bc1p7wx9jds3wtned6equu9p6sp6wpzuj8jrhfw3fm2cttndtxjq0cvszaur4w';

const HTML = `<!doctype html><html><body>
<h1>Inscription 9164</h1>
<iframe src=/preview/${ID}></iframe>
<dl>
<dt>address</dt><dd><a href=/address/${OWNER}>${OWNER}</a></dd>
<dt>sat</dt><dd><a href=/sat/1562240140251909>1562240140251909</a></dd>
<dt>content type</dt><dd>image/png</dd>
<dt>timestamp</dt><dd><time>2023-02-07 02:27:29 UTC</time></dd>
<dt>height</dt><dd><a href=/block/775375>775375</a></dd>
</dl></body></html>`;

test('parses the current ordinals.com HTML ownership response', () => {
  const parsed = parseHtmlInscription(HTML);
  assert.equal(parsed.id, ID);
  assert.equal(parsed.number, 9164);
  assert.equal(parsed.address, OWNER);
  assert.equal(parsed.content_type, 'image/png');
  assert.equal(parsed.height, 775375);
  assert.equal(parsed.source, 'html');
});

test('continues to accept the legacy JSON response shape', () => {
  const parsed = parseJsonInscription(JSON.stringify({
    id: ID,
    number: 9164,
    address: OWNER,
    content_type: 'image/png'
  }));
  assert.equal(parsed.id, ID);
  assert.equal(parsed.number, 9164);
  assert.equal(parsed.address, OWNER);
  assert.equal(parsed.source, 'json');
});

test('requests HTML first and resolves an owner from one response', async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    assert.match(options.headers.Accept, /^text\/html/);
    return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  };

  const inscription = await fetchOrdinalsInscription(ID, { fetchImpl });
  const ownership = await fetchOrdinalsOwner(ID, { fetchImpl });
  assert.equal(inscription.address, OWNER);
  assert.equal(ownership.owner, OWNER);
  assert.equal(ownership.verified, true);
  assert.equal(calls, 2);
});

test('fails closed when ordinals.com returns unsupported data', async () => {
  const fetchImpl = async () => new Response('JSON API disabled', { status: 200 });
  const ownership = await fetchOrdinalsOwner(ID, { fetchImpl });
  assert.equal(ownership.verified, false);
  assert.equal(ownership.owner, null);
  assert.match(ownership.error, /unsupported inscription data/);
});
