// Dependency-free checks for the PharmaOverseas connector (Procurement 03).
// Fake fetch + fake sleep only; no network.
// Run: node tests/unit/procurement-pharmaoverseas.check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthRequiredError,
  NotAuthorizedError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
  assertConnector,
  registerConnector,
  getConnector,
  clearRegistry,
} from '../../worker/procurement/connector-contract.js';
import { validateOffer } from '../../worker/procurement/offer-schema.js';
import { createPharmaOverseasConnector } from '../../worker/procurement/connectors/pharmaoverseas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, '..', 'fixtures', 'pharmaoverseas');
const searchFixture = JSON.parse(await readFile(path.join(fixtureDir, 'search-panadol.json'), 'utf8'));
const productFixture = JSON.parse(await readFile(path.join(fixtureDir, 'product-28851.json'), 'utf8'));

const FAKE_TOKEN = 'fake-token';
const FAKE_TIME = 1_800_000_000_000;

function makeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Returns { fetch, calls } where calls records { url, headers } per request.
function makeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    return handler(String(url), init);
  };
  return { fetch: fetchImpl, calls };
}

function makeConnector(handler, extra = {}) {
  const { fetch, calls } = makeFetch(handler);
  const connector = createPharmaOverseasConnector({
    fetch,
    getAccessToken: async () => FAKE_TOKEN,
    sleep: async () => {},
    now: () => FAKE_TIME,
    ...extra,
  });
  return { connector, calls };
}

const okSearch = () => makeResponse({ body: searchFixture });
const okProduct = () => makeResponse({ body: productFixture });

// --- Contract + registry -------------------------------------------------------
clearRegistry();
const { connector } = makeConnector(okSearch);
assertConnector(connector);
registerConnector(connector);
assert.equal(getConnector('pharmaoverseas'), connector);
assert.equal(connector.id, 'pharmaoverseas');
assert.equal(connector.authorization, 'owner-account');
assert.deepEqual(connector.capabilities, {
  search: true,
  getProduct: true,
  listCatalog: false,
  stock: 'level',
});
assert.equal(connector.rateLimit.requestsPerMinute, 20);

// --- Search request shape ------------------------------------------------------
{
  const { connector: c, calls } = makeConnector(okSearch);
  const result = await c.search('panadol', { page: 1, pageSize: 24 });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.ok(url.pathname.endsWith('/occ/v2/pharma/products/search'), `path: ${url.pathname}`);
  assert.equal(url.searchParams.get('query'), 'panadol');
  assert.equal(url.searchParams.get('currentPage'), '0', 'page 1 must map to currentPage=0');
  assert.equal(url.searchParams.get('pageSize'), '24');
  assert.equal(url.searchParams.get('fields'), 'FULL');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('curr'), 'EGP');
  assert.equal(calls[0].headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(calls[0].headers.Accept, 'application/json');

  assert.equal(result.offers.length, 3);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 24);
  assert.equal(result.totalPages, 1);

  const page2 = makeConnector(okSearch);
  await page2.connector.search('panadol', { page: 2 });
  assert.equal(new URL(page2.calls[0].url).searchParams.get('currentPage'), '1');

  const clamped = makeConnector(okSearch);
  const big = await clamped.connector.search('x', { pageSize: 100 });
  assert.equal(big.pageSize, 48);
  assert.equal(new URL(clamped.calls[0].url).searchParams.get('pageSize'), '48');
  const small = await clamped.connector.search('x', { pageSize: 0 });
  assert.equal(small.pageSize, 1);
  assert.equal(new URL(clamped.calls[1].url).searchParams.get('pageSize'), '1');
}

// --- getProduct + toOffer mapping (Panadol detail fixture) ----------------------
{
  const { connector: c, calls } = makeConnector(okProduct);
  const raw = await c.getProduct('000000000000028851');
  assert.equal(raw.code, '000000000000028851');
  const url = new URL(calls[0].url);
  assert.ok(url.pathname.endsWith('/occ/v2/pharma/products/000000000000028851'));
  assert.equal(url.searchParams.get('fields'), 'FULL');

  const fetchedAt = '2026-11-08T12:00:00Z';
  const offer = c.toOffer(raw, { fetchedAt });
  assert.equal(offer.supplierId, 'pharmaoverseas');
  assert.equal(offer.supplierProductId, '000000000000028851');
  assert.equal(offer.unitPrice, 33.75);
  assert.equal(offer.netEffectivePrice, 33.75);
  assert.equal(offer.publicPrice, 51);
  assert.equal(offer.discountPct, 33.82);
  assert.equal(offer.stockStatus, 'in_stock');
  assert.equal(offer.availableQuantity, null);
  assert.equal(offer.barcode, null);
  assert.equal(offer.packSize, null);
  assert.equal(offer.minimumOrderQuantity, null);
  assert.equal(offer.currency, 'EGP');
  assert.equal(offer.dataSource, 'api');
  assert.equal(offer.syncStatus, 'fresh');
  assert.equal(offer.lastUpdated, fetchedAt);
  assert.ok(!offer.productName.includes('<') && !offer.productName.includes('>'));
  assert.equal(offer.productName, 'Panadol Megraine 3 Tab');
  assert.deepEqual(Object.keys(offer.raw).sort(), [
    'pharmacyDiscount',
    'price',
    'publicPrice',
    'purchasable',
    'stock',
  ]);
  const validation = validateOffer(offer);
  assert.ok(validation.ok, `offer must validate: ${validation.errors.join('; ')}`);

  // 404 -> null
  const missing = makeConnector(() => makeResponse({ status: 404 }));
  assert.equal(await missing.connector.getProduct('nope'), null);
}

// --- toOffer on search results --------------------------------------------------
{
  const { connector: c } = makeConnector(okSearch);
  const { offers: raws } = await c.search('panadol');
  const offers = raws.map((r) => c.toOffer(r, { fetchedAt: '2026-11-08T12:00:00Z' }));
  for (const offer of offers) {
    const validation = validateOffer(offer);
    assert.ok(validation.ok, `offer ${offer.supplierProductId}: ${validation.errors.join('; ')}`);
    assert.ok(!offer.productName.includes('<'), 'highlight tags must be stripped');
  }
  assert.equal(offers[1].stockStatus, 'out_of_stock');
  assert.equal(offers[1].publicPrice, null, 'product without publicPrice keeps null');
  assert.equal(offers[1].discountPct, null);
  assert.equal(offers[2].stockStatus, 'low');

  const unknown = c.toOffer(
    { ...raws[0], stock: { stockLevelStatus: 'soon' } },
    { fetchedAt: '2026-11-08T12:00:00Z' },
  );
  assert.equal(unknown.stockStatus, 'unknown');

  // Negative discount (price above public price) stays null.
  const negative = c.toOffer(
    { ...raws[0], price: { ...raws[0].price, value: 60 }, publicPrice: { value: 54 } },
    { fetchedAt: '2026-11-08T12:00:00Z' },
  );
  assert.equal(negative.discountPct, null);
}

// --- Error mapping ----------------------------------------------------------------
{
  const expectError = async (handler, ErrClass, check) => {
    const { connector: c } = makeConnector(handler);
    await assert.rejects(() => c.search('x'), (err) => {
      assert.ok(err instanceof ErrClass, `expected ${ErrClass.name}, got ${err?.name}`);
      if (check) check(err);
      return true;
    });
  };

  await expectError(() => makeResponse({ status: 401 }), AuthRequiredError);
  await expectError(() => makeResponse({ status: 403 }), NotAuthorizedError);
  await expectError(
    () => makeResponse({ status: 429, headers: { 'retry-after': '7' } }),
    RateLimitedError,
    (err) => assert.equal(err.retryAfterMs, 7000),
  );
  await expectError(
    () => makeResponse({ status: 429 }),
    RateLimitedError,
    (err) => assert.equal(err.retryAfterMs, 60000),
  );
  await expectError(() => makeResponse({ status: 500 }), TransientError);
  await expectError(() => makeResponse({ status: 503 }), TransientError);
  await expectError(() => {
    throw new Error('socket hang up');
  }, TransientError);
  await expectError(
    () => makeResponse({ status: 200, body: '<html><body>Are you human?</body></html>' }),
    NotAuthorizedError,
    (err) => assert.match(err.message, /unexpected HTML/),
  );

  // getProduct maps the same statuses.
  const unauthorized = makeConnector(() => makeResponse({ status: 401 }));
  await assert.rejects(() => unauthorized.connector.getProduct('x'), AuthRequiredError);
}

// --- Schema drift -------------------------------------------------------------------
{
  const { connector: c } = makeConnector(okSearch);
  const noPrice = { ...productFixture, price: undefined };
  assert.throws(
    () => c.toOffer(noPrice, { fetchedAt: '2026-11-08T12:00:00Z' }),
    (err) => {
      assert.ok(err instanceof SchemaDriftError);
      assert.ok(err.missing.includes('price'));
      return true;
    },
  );
  const noCode = { ...productFixture, code: '' };
  assert.throws(
    () => c.toOffer(noCode, { fetchedAt: '2026-11-08T12:00:00Z' }),
    (err) => {
      assert.ok(err instanceof SchemaDriftError);
      assert.ok(err.missing.includes('code'));
      return true;
    },
  );
}

// --- Rate limiting --------------------------------------------------------------------
{
  let sleptMs = 0;
  const { connector: c } = makeConnector(okSearch, {
    sleep: async (ms) => {
      sleptMs += ms;
    },
  });
  for (let i = 0; i < 25; i += 1) {
    await c.search('panadol');
  }
  assert.ok(
    sleptMs >= 15000,
    `25 calls at 20 req/min must wait at least 15 s total, waited ${sleptMs} ms`,
  );
}

// --- Static hygiene ---------------------------------------------------------------------
{
  const source = await readFile(
    path.join(here, '..', '..', 'worker', 'procurement', 'connectors', 'pharmaoverseas.js'),
    'utf8',
  );
  assert.ok(!source.includes('console.'), 'module must not use console.*');
  assert.ok(!source.includes('pass' + 'word'), 'module must not mention credentials in source');
}

clearRegistry();
console.log('procurement-pharmaoverseas checks passed');
