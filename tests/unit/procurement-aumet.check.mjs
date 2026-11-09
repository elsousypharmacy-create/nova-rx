// Dependency-free checks for the Aumet marketplace connector (Procurement 03b).
// Fake request + fake sleep only; no network.
// Run: node tests/unit/procurement-aumet.check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthRequiredError,
  ConnectorError,
  NotAuthorizedError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
  assertConnector,
  registerConnector,
  getConnector,
  listConnectors,
  clearRegistry,
} from '../../worker/procurement/connector-contract.js';
import { validateOffer, OFFER_FIELDS } from '../../worker/procurement/offer-schema.js';
import { compareForItem } from '../../worker/procurement/compare.js';
import { createPharmaOverseasConnector } from '../../worker/procurement/connectors/pharmaoverseas.js';
import {
  createAumetConnector,
  buildSearchParams,
} from '../../worker/procurement/connectors/aumet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  await readFile(path.join(here, '..', 'fixtures', 'aumet', 'products-panadol.json'), 'utf8'),
);

const FAKE_TIME = 1_800_000_000_000;
const FETCHED_AT = '2026-11-08T12:00:00Z';

function makeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// Returns { request, calls } where calls records { url, params } per request.
function makeRequest(handler) {
  const calls = [];
  const request = async (url, params) => {
    calls.push({ url: String(url), params });
    return handler(String(url), params);
  };
  return { request, calls };
}

function makeConnector(handler, extra = {}) {
  const { request, calls } = makeRequest(handler);
  const connector = createAumetConnector({
    request,
    sleep: async () => {},
    now: () => FAKE_TIME,
    ...extra,
  });
  return { connector, calls };
}

const okSearch = () => makeResponse({ body: fixture });

// --- Contract + registry (next to pharmaoverseas) ------------------------------
clearRegistry();
const { connector } = makeConnector(okSearch);
assertConnector(connector);
registerConnector(createPharmaOverseasConnector({ sleep: async () => {} }));
registerConnector(connector);
assert.equal(getConnector('aumet'), connector);
assert.deepEqual(
  listConnectors().map((c) => c.id).sort(),
  ['aumet', 'pharmaoverseas'],
);
assert.equal(connector.authorization, 'owner-account');
assert.deepEqual(connector.capabilities, {
  search: true,
  getProduct: false,
  listCatalog: false,
  stock: 'quantity',
});
assert.equal(connector.rateLimit.requestsPerMinute, 20);

// --- buildSearchParams is isolated and uses the unconfirmed `spell` name --------
assert.deepEqual(buildSearchParams('panadol', 2, 24), {
  page: 2,
  result_per_page: 24,
  sort_by: 'price',
  show_comparison: 1,
  in_stock: 1,
  spell: 'panadol',
});

// --- Search request shape + paging ----------------------------------------------
{
  const { connector: c, calls } = makeConnector(okSearch);
  const result = await c.search('panadol', { page: 1, pageSize: 24 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://marketplace.aumet.com/api/products');
  assert.deepEqual(calls[0].params, buildSearchParams('panadol', 1, 24));
  assert.equal(result.offers.length, 3);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 24);
  assert.equal(result.totalPages, 1, 'ceil(3 / 24)');

  const paged = makeConnector(okSearch);
  const page2 = await paged.connector.search('panadol', { page: 2, pageSize: 2 });
  assert.equal(paged.calls[0].params.page, 2);
  assert.equal(paged.calls[0].params.result_per_page, 2);
  assert.equal(page2.totalPages, 2, 'ceil(3 / 2)');

  const empty = makeConnector(() =>
    makeResponse({ body: { totalResult: 0, num_found: 0, data: [] } }),
  );
  const none = await empty.connector.search('zzz');
  assert.deepEqual(none.offers, []);
  assert.equal(none.totalPages, 0);
}

// --- toOffer: 3 distributors, 3 distinct sellers, all validate -------------------
{
  const { connector: c } = makeConnector(okSearch);
  const offers = fixture.data.map((raw) => c.toOffer(raw, { fetchedAt: FETCHED_AT }));
  assert.equal(OFFER_FIELDS.length, 19, 'schema now lists 19 fields');
  for (const offer of offers) {
    const result = validateOffer(offer);
    assert.ok(result.ok, `offer ${offer.supplierProductId}: ${result.errors.join('; ')}`);
    assert.equal(offer.supplierId, 'aumet');
    assert.equal(offer.currency, 'EGP');
    assert.equal(offer.dataSource, 'api');
    assert.equal(offer.netEffectivePrice, null, 'net price unconfirmed, stays null');
    assert.equal(offer.minimumOrderQuantity, null);
    assert.equal(offer.packSize, null);
    assert.equal(offer.lastUpdated, FETCHED_AT);
  }
  assert.deepEqual(
    offers.map((o) => o.sellerId),
    ['7001', '7002', '7003'],
    'one sellerId per distributor, all distinct',
  );
  assert.deepEqual(
    offers.map((o) => o.sellerName),
    ['Nile Delta Distribution', 'Sahara Medical Supply', 'Red Sea Pharma Trade'],
  );
  assert.deepEqual(
    offers.map((o) => o.supplierProductId),
    ['91001', '91002', '91003'],
  );

  // Stock mapping: 0 -> out_of_stock, 19 -> low, 655 -> in_stock.
  assert.equal(offers[0].stockStatus, 'in_stock');
  assert.equal(offers[0].availableQuantity, 655);
  assert.equal(offers[1].stockStatus, 'out_of_stock');
  assert.equal(offers[1].availableQuantity, 0);
  assert.equal(offers[2].stockStatus, 'low');
  assert.equal(offers[2].availableQuantity, 19);

  // Prices: discountPct only from best_price vs unit_price.
  assert.equal(offers[0].discountPct, 10, '1 - 45/50');
  assert.equal(offers[1].discountPct, null, 'no best_price -> null');
  assert.equal(offers[2].discountPct, 5, '1 - 49.4/52');
  assert.equal(offers[2].publicPrice, 65, 'numeric string coerced');

  // Barcode: missing -> null.
  assert.equal(offers[0].barcode, '6223009876543');
  assert.equal(offers[1].barcode, null);
  assert.equal(offers[2].barcode, '6223001112223');

  // HTML stripped from a plain-string label.
  assert.equal(offers[2].productName, 'Panadol Extra 24 Tab');
  assert.ok(!offers[2].productName.includes('<'));

  // raw keeps only the whitelisted price/stock fields.
  assert.deepEqual(Object.keys(offers[0].raw).sort(), [
    'average_distributor_rate',
    'best_price',
    'bonuses',
    'delivery_fee',
    'discounts',
    'paymentMethod',
    'retail_selling_price',
    'stock',
    'unit_price',
    'vat',
  ]);
  assert.equal(offers[0].raw.best_price, 45);

  // Missing entity_id -> sellerId null (still valid).
  const noSeller = c.toOffer(
    { ...fixture.data[0], entity_id: null, entity: null },
    { fetchedAt: FETCHED_AT },
  );
  assert.equal(noSeller.sellerId, null);
  assert.equal(noSeller.sellerName, null);
  assert.ok(validateOffer(noSeller).ok);

  // Invalid barcode -> null.
  const badBarcode = c.toOffer(
    { ...fixture.data[0], product: { ...fixture.data[0].product, bar_code: '12ab' } },
    { fetchedAt: FETCHED_AT },
  );
  assert.equal(badBarcode.barcode, null);

  // sellerId with HTML is rejected by the schema.
  const dirty = { ...offers[0], sellerId: '<b>7001</b>' };
  assert.equal(validateOffer(dirty).ok, false);
}

// --- compare: 3 sellers for one product stay 3 offers and rank -------------------
{
  const { connector: c } = makeConnector(okSearch);
  const offers = fixture.data.map((raw) => c.toOffer(raw, { fetchedAt: FETCHED_AT }));
  const result = compareForItem({ name: 'Panadol Extra 24 Tab' }, offers, {
    now: Date.parse(FETCHED_AT),
  });
  assert.equal(result.offers.length, 3, 'same supplierId, different sellerId: never merged');
  assert.equal(result.best.sellerId, '7001', 'cheapest eligible seller wins');
  assert.equal(result.best.sellerName, 'Nile Delta Distribution', 'rows keep sellerName');
  const out = result.offers.find((r) => r.offer.sellerId === '7002');
  assert.equal(out.eligible, false);
  assert.ok(out.reasons.includes('out_of_stock'));

  // Tie-break: same price, same supplier -> sellerId decides, both kept.
  const tieA = { ...offers[0], sellerId: '9002', sellerName: 'Seller B' };
  const tieB = { ...offers[0], sellerId: '9001', sellerName: 'Seller A' };
  const tied = compareForItem({ name: 'Panadol Extra 24 Tab' }, [tieA, tieB], {
    now: Date.parse(FETCHED_AT),
  });
  assert.equal(tied.offers.length, 2);
  assert.equal(tied.offers[0].offer.sellerId, '9001', 'sellerId asc breaks the tie');
  assert.equal(tied.offers[1].offer.sellerId, '9002');
}

// --- Error mapping ------------------------------------------------------------------
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
    () => makeResponse({ body: '<html><body>Please log in</body></html>' }),
    NotAuthorizedError,
    (err) => assert.match(err.message, /HTML/),
  );
  await expectError(
    () => makeResponse({ body: 'not json at all' }),
    TransientError,
  );
}

// --- Schema drift ----------------------------------------------------------------------
{
  const { connector: c } = makeConnector(okSearch);
  const noPrice = { ...fixture.data[0], unit_price: undefined };
  assert.throws(
    () => c.toOffer(noPrice, { fetchedAt: FETCHED_AT }),
    (err) => {
      assert.ok(err instanceof SchemaDriftError);
      assert.ok(err.missing.includes('unit_price'));
      return true;
    },
  );
  const noProduct = { ...fixture.data[0], product: undefined };
  assert.throws(
    () => c.toOffer(noProduct, { fetchedAt: FETCHED_AT }),
    (err) => {
      assert.ok(err instanceof SchemaDriftError);
      assert.ok(err.missing.includes('product'));
      return true;
    },
  );
}

// --- getProduct unsupported --------------------------------------------------------------
{
  const { connector: c } = makeConnector(okSearch);
  await assert.rejects(() => c.getProduct('91001'), (err) => {
    assert.ok(err instanceof ConnectorError);
    assert.equal(err.code, 'NOT_SUPPORTED');
    return true;
  });
}

// --- Rate limiting -------------------------------------------------------------------------
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

// --- Static hygiene ---------------------------------------------------------------------------
{
  const source = await readFile(
    path.join(here, '..', '..', 'worker', 'procurement', 'connectors', 'aumet.js'),
    'utf8',
  );
  assert.ok(!source.includes('console.'), 'module must not use console.*');
  assert.ok(!source.includes('pass' + 'word'), 'module must not mention credentials in source');
}

clearRegistry();
console.log('procurement-aumet checks passed');
