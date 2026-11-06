import assert from 'node:assert/strict';
import {
  SUPPLIER_OFFER_FIXTURES,
  normalizeOffer,
  normalizeOffers,
  compareOffers,
  paginate
} from '../../worker/supplier-price-service.js';

// Fixture set: exactly ten synthetic offers, no live data.
assert.equal(SUPPLIER_OFFER_FIXTURES.length, 10, 'expected ten fixtures');
assert.ok(Object.isFrozen(SUPPLIER_OFFER_FIXTURES), 'fixtures must be frozen');

// Normalization across all ten fixtures.
const normalized = normalizeOffers(SUPPLIER_OFFER_FIXTURES);
assert.equal(normalized.length, 10);
for (const offer of normalized) {
  assert.ok(offer.supplier && offer.productCode && offer.productName, 'core identity fields normalized');
  assert.equal(typeof offer.discountPct, 'number');
  assert.ok(offer.discountPct >= 0 && offer.discountPct <= 100);
}

// String price is coerced; missing price/stock/timestamp are flagged, not guessed.
const stringPriced = normalized.find(o => o.supplier === 'United Pharma' && o.productCode === 'AMX-250');
assert.equal(stringPriced.priceEgp, 32);
assert.equal(stringPriced.effectivePriceEgp, 32);

const missingPrice = normalized.find(o => o.supplier === 'Delta Medical' && o.productCode === 'IBU-400');
assert.equal(missingPrice.priceEgp, null);
assert.equal(missingPrice.effectivePriceEgp, null);
assert.ok(missingPrice.missing.includes('priceEgp'));

const missingStock = normalized.find(o => o.supplier === 'El Motawakel' && o.productCode === 'AMX-250');
assert.equal(missingStock.stock, null);
assert.ok(missingStock.missing.includes('stock'));

const missingTimestamp = normalized.find(o => o.supplier === 'United Pharma' && o.productCode === 'IBU-400');
assert.equal(missingTimestamp.timestamp, null);
assert.ok(missingTimestamp.missing.includes('timestamp'));

// Discount math: 19.00 EGP at 8% → 17.48; out-of-range discount clamps.
const discounted = normalized.find(o => o.supplier === 'El Motawakel' && o.productCode === 'PCM-500');
assert.equal(discounted.effectivePriceEgp, 17.48);
assert.equal(normalizeOffer({ priceEgp: 10, discountPct: 250 }).discountPct, 100);
assert.equal(normalizeOffer({ priceEgp: 10, discountPct: -5 }).discountPct, 0);
assert.equal(normalizeOffer(null).missing.length, 6, 'null raw offer reports every required field missing');

// Deterministic comparison: price-less offers excluded, sorted asc, cheapest per product flagged.
const rankedA = compareOffers(SUPPLIER_OFFER_FIXTURES);
const rankedB = compareOffers([...SUPPLIER_OFFER_FIXTURES].reverse());
assert.equal(rankedA.length, 9, 'one fixture has no price and is excluded');
assert.deepEqual(
  rankedA.map(o => [o.supplier, o.productCode, o.effectivePriceEgp]),
  rankedB.map(o => [o.supplier, o.productCode, o.effectivePriceEgp]),
  'comparison must be deterministic regardless of input order'
);
for (let i = 1; i < rankedA.length; i++) {
  assert.ok(rankedA[i].effectivePriceEgp >= rankedA[i - 1].effectivePriceEgp, 'sorted by effective price asc');
}
const bestByProduct = new Map();
for (const offer of rankedA.filter(o => o.best)) bestByProduct.set(offer.productCode, offer.effectivePriceEgp);
assert.equal(bestByProduct.get('PCM-500'), 17.48, 'El Motawakel wins PCM-500 after discount');
assert.equal(bestByProduct.get('AMX-250'), 29.61, 'El Motawakel wins AMX-250 after discount');
assert.equal(bestByProduct.get('IBU-400'), 21.83, 'Cairo Drug Store wins IBU-400 after discount');
assert.equal(bestByProduct.get('OMZ-20'), 27);
assert.equal(rankedA.filter(o => o.best).length, 4, 'exactly one best offer per product code');

// Pagination: ten items at page size 3 → 4 pages, clamped bounds, no phantom pages.
const all = normalizeOffers(SUPPLIER_OFFER_FIXTURES);
const page1 = paginate(all, 1, 3);
assert.equal(page1.pages, 4);
assert.equal(page1.total, 10);
assert.equal(page1.items.length, 3);
assert.equal(paginate(all, 4, 3).items.length, 1, 'last page holds the remainder');
assert.equal(paginate(all, 99, 3).page, 4, 'out-of-range page clamps down');
assert.equal(paginate(all, 0, 3).page, 1, 'page below 1 clamps up');
assert.equal(paginate(all, 'abc', 3).page, 1, 'non-numeric page falls back to 1');
assert.equal(paginate([], 5, 3).pages, 1, 'empty list still reports one page');
assert.equal(paginate(all, 2, 0).pageSize, 1, 'page size floored at 1');

console.log('supplier-price-service checks passed');
