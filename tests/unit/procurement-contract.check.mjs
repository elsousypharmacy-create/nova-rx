// Dependency-free checks for the procurement connector contract, offer schema
// and fixture connector (Task 02). Run: node tests/unit/procurement-contract.check.mjs
import assert from 'node:assert/strict';
import {
  OFFER_FIELDS,
  validateOffer,
  sanitizeName,
} from '../../worker/procurement/offer-schema.js';
import {
  AUTHORIZATION_KINDS,
  ConnectorError,
  AuthRequiredError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
  NotAuthorizedError,
  assertConnector,
  registerConnector,
  getConnector,
  listConnectors,
  clearRegistry,
} from '../../worker/procurement/connector-contract.js';
import { fixtureConnector } from '../../worker/procurement/connectors/fixture.js';

// --- Schema basics -----------------------------------------------------------
assert.equal(OFFER_FIELDS.length, 17, 'OFFER_FIELDS must list the 17 schema fields');
assert.ok(Object.isFrozen(OFFER_FIELDS), 'OFFER_FIELDS must be frozen');
assert.equal(sanitizeName('Augmentin <b>1g</b>   14 Tab'), 'Augmentin 1g 14 Tab');
assert.equal(sanitizeName('<i><b>X</b></i>'), 'X');

// --- Registry ----------------------------------------------------------------
clearRegistry();
registerConnector(fixtureConnector);
assert.equal(getConnector('fixture'), fixtureConnector);
assert.deepEqual(listConnectors(), [fixtureConnector]);
assert.throws(() => registerConnector(fixtureConnector), /already registered/);

const missingToOffer = {
  id: 'broken',
  displayName: 'Broken',
  authorization: 'fixture',
  capabilities: {},
  rateLimit: { requestsPerMinute: 1 },
  search: async () => {},
  getProduct: async () => {},
};
assert.throws(() => assertConnector(missingToOffer), TypeError);
assert.throws(() => assertConnector(missingToOffer), /toOffer/);

const badAuth = {
  ...fixtureConnector,
  id: 'scraper',
  authorization: 'scraping',
};
assert.throws(() => registerConnector(badAuth), TypeError);
assert.throws(() => registerConnector(badAuth), /authorization/);
assert.equal(listConnectors().length, 1, 'failed registrations must not leak into the registry');
assert.deepEqual(AUTHORIZATION_KINDS, [
  'owner-account',
  'official-api',
  'written-permission',
  'export-file',
  'fixture',
]);

// --- Fixture connector: every produced offer validates -----------------------
const fetchedAt = '2026-11-08T12:00:00Z';
const { offers: allRaw, totalPages } = await fixtureConnector.search('', { page: 1, pageSize: 100 });
assert.equal(allRaw.length, 8);
assert.equal(totalPages, 1);
const offers = allRaw.map((raw) => fixtureConnector.toOffer(raw, { fetchedAt }));
for (const offer of offers) {
  const result = validateOffer(offer);
  assert.ok(result.ok, `offer ${offer.supplierProductId} must validate: ${result.errors.join('; ')}`);
  assert.equal(offer.supplierId, 'fixture');
  assert.equal(offer.currency, 'EGP');
  assert.equal(offer.dataSource, 'fixture');
  assert.equal(offer.lastUpdated, fetchedAt);
}

// --- HTML name sanitized -----------------------------------------------------
const htmlRaw = allRaw.find((r) => r.name.includes('<'));
assert.ok(htmlRaw, 'fixture must include a record with HTML in the name');
const htmlOffer = fixtureConnector.toOffer(htmlRaw, { fetchedAt });
assert.ok(!htmlOffer.productName.includes('<') && !htmlOffer.productName.includes('>'));
assert.equal(htmlOffer.productName, sanitizeName(htmlRaw.name));

// --- Unknown discount stays null; net price only when both known -------------
const unknownDiscountRaw = allRaw.find((r) => r.discountPct === null);
assert.ok(unknownDiscountRaw, 'fixture must include a record with unknown discount');
const unknownDiscountOffer = fixtureConnector.toOffer(unknownDiscountRaw, { fetchedAt });
assert.equal(unknownDiscountOffer.discountPct, null);
assert.equal(unknownDiscountOffer.netEffectivePrice, null);

const known = fixtureConnector.toOffer(
  { ...allRaw[0], unitPrice: 45, discountPct: 10 },
  { fetchedAt },
);
assert.equal(known.netEffectivePrice, 40.5, 'netEffectivePrice = 45 * 0.9 rounded to 2 decimals');

const outOfStock = offers.find((o) => o.stockStatus === 'out_of_stock');
assert.ok(outOfStock, 'fixture must include an out-of-stock record');
const noBarcode = offers.find((o) => o.barcode === null);
assert.ok(noBarcode, 'fixture must include a record with no barcode');

const product = await fixtureConnector.getProduct('FX-001');
assert.equal(product.name, 'Panadol Extra 24 Tab');
assert.equal(await fixtureConnector.getProduct('NOPE'), null);

// --- validateOffer rejections -------------------------------------------------
const base = offers[0];
for (const [label, mutate, pattern] of [
  ['currency USD', (o) => { o.currency = 'USD'; }, /currency/],
  ['discountPct 120', (o) => { o.discountPct = 120; }, /discountPct/],
  ["barcode '12ab'", (o) => { o.barcode = '12ab'; }, /barcode/],
  ['raw with credentials', (o) => { o.raw = { headers: { Authorization: 'x' } }; }, /raw/],
]) {
  const copy = JSON.parse(JSON.stringify(base));
  mutate(copy);
  const result = validateOffer(copy);
  assert.equal(result.ok, false, `validateOffer must reject: ${label}`);
  assert.ok(
    result.errors.some((e) => pattern.test(e)),
    `rejection for ${label} must mention the cause, got: ${result.errors.join('; ')}`,
  );
}

// --- Pagination ---------------------------------------------------------------
const page1 = await fixtureConnector.search('', { page: 1, pageSize: 5 });
assert.equal(page1.offers.length, 5);
assert.equal(page1.totalPages, 2);
const page2 = await fixtureConnector.search('', { page: 2, pageSize: 5 });
assert.equal(page2.offers.length, 3);
const pageBeyond = await fixtureConnector.search('', { page: 3, pageSize: 5 });
assert.deepEqual(pageBeyond.offers, []);
assert.equal(pageBeyond.totalPages, 2, 'totalPages stays correct beyond the last page');

const ci = await fixtureConnector.search('PANADOL', { page: 1, pageSize: 5 });
assert.equal(ci.offers.length, 1, 'search must be case-insensitive');
assert.equal(ci.offers[0].supplierProductId, 'FX-001');

// --- Error classes -------------------------------------------------------------
const rl = new RateLimitedError('x', 5000);
assert.equal(rl.retryAfterMs, 5000);
assert.ok(rl instanceof ConnectorError);
assert.equal(rl.code, 'RATE_LIMITED');
for (const Err of [AuthRequiredError, SchemaDriftError, TransientError, NotAuthorizedError]) {
  assert.ok(new Err('m') instanceof ConnectorError);
}
const drift = new SchemaDriftError('drift', { missing: ['price'], unexpected: ['foo'] });
assert.deepEqual(drift.missing, ['price']);
assert.deepEqual(drift.unexpected, ['foo']);

clearRegistry();
console.log('procurement-contract checks passed');
