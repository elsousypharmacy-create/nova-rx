// Dependency-free checks for worker/procurement/compare.js (Task 06:
// price comparison engine on comparable units).
// Run: node tests/unit/procurement-compare.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compareForItem, compareMany } from '../../worker/procurement/compare.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const HOUR = 3600 * 1000;

function offer(over) {
  return {
    supplierId: 'a',
    supplierProductId: 'x1',
    productName: 'PANADOL EXTRA 24 F.C. TAB.',
    packSize: null,
    currency: 'EGP',
    unitPrice: 10,
    publicPrice: null,
    discountPct: null,
    netEffectivePrice: null,
    availableQuantity: null,
    stockStatus: 'in_stock',
    minimumOrderQuantity: null,
    lastUpdated: new Date(NOW).toISOString(),
    dataSource: 'fixture',
    syncStatus: 'fresh',
    raw: {},
    ...over,
  };
}

// --- 1. Per-tablet price decides the best, not the pack price ----------------
{
  const a24 = offer({ supplierId: 'a', supplierProductId: 'a1', unitPrice: 48 }); // 24 tab -> 2.000/tab
  const b48 = offer({
    supplierId: 'b',
    supplierProductId: 'b1',
    productName: 'PANADOL EXTRA 48 F.C. TAB.',
    unitPrice: 90, // 48 tab -> 1.875/tab (cheaper per tablet, dearer per pack)
  });
  const result = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [a24, b48], { now: NOW });
  assert.equal(result.offers.length, 2, 'both pack sizes kept (score >= 0.8)');
  assert.equal(result.best.supplierId, 'b', 'per-tablet price decides best, not pack price');
  const rowA = result.offers.find((r) => r.offer.supplierId === 'a');
  const rowB = result.offers.find((r) => r.offer.supplierId === 'b');
  assert.ok(Math.abs(rowA.unitPriceComparable - 2) < 1e-9);
  assert.ok(Math.abs(rowB.unitPriceComparable - 1.875) < 1e-9);
  assert.equal(rowA.packPrice, 48);
  assert.equal(rowB.packPrice, 90);
  assert.equal(result.savingsVsNext, 6, '(2 - 1.875) * 48 tabs, rounded to 2 decimals');
  assert.equal(result.needsReview, true, 'best and next differ in pack size');
  assert.ok(result.offers.every((r) => r.eligible && r.reasons.length === 0));
}

// --- 2. Cheapest offer out_of_stock -> not best ------------------------------
{
  const inStock = offer({ supplierId: 'a', supplierProductId: 'a1', unitPrice: 48 }); // 2/tab
  const cheapest = offer({
    supplierId: 'b',
    supplierProductId: 'b1',
    unitPrice: 24, // 1/tab, cheapest
    stockStatus: 'out_of_stock',
  });
  const result = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [inStock, cheapest], {
    now: NOW,
  });
  assert.equal(result.best.supplierId, 'a', 'in-stock offer is best');
  const rowB = result.offers.find((r) => r.offer.supplierId === 'b');
  assert.equal(rowB.eligible, false);
  assert.ok(rowB.reasons.includes('out_of_stock'));
  assert.equal(result.savingsVsNext, null, 'no second eligible offer');
}

// --- 3. MOQ 10 with requestedQty 3 -> reason MOQ -----------------------------
{
  const moqOffer = offer({ supplierId: 'a', supplierProductId: 'a1', minimumOrderQuantity: 10 });
  const normal = offer({ supplierId: 'b', supplierProductId: 'b1', unitPrice: 72 });
  const result = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [moqOffer, normal], {
    requestedQty: 3,
    now: NOW,
  });
  const rowA = result.offers.find((r) => r.offer.supplierId === 'a');
  assert.equal(rowA.eligible, false);
  assert.ok(rowA.reasons.includes('MOQ'));
  assert.equal(result.best.supplierId, 'b');
}

// --- 4. lastUpdated 7 h old -> reason stale ----------------------------------
{
  const stale = offer({
    supplierId: 'a',
    supplierProductId: 'a1',
    lastUpdated: new Date(NOW - 7 * HOUR).toISOString(),
  });
  const fresh = offer({ supplierId: 'b', supplierProductId: 'b1', unitPrice: 72 });
  const result = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [stale, fresh], {
    now: NOW,
  });
  const rowA = result.offers.find((r) => r.offer.supplierId === 'a');
  assert.equal(rowA.eligible, false);
  assert.ok(rowA.reasons.includes('stale'));
  assert.equal(result.best.supplierId, 'b');
}

// --- 5. Third supplier c changes best; compare.js stays supplier-agnostic ----
{
  const a24 = offer({ supplierId: 'a', supplierProductId: 'a1', unitPrice: 48 });
  const b48 = offer({
    supplierId: 'b',
    supplierProductId: 'b1',
    productName: 'PANADOL EXTRA 48 F.C. TAB.',
    unitPrice: 90,
  });
  const before = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [a24, b48], { now: NOW });
  assert.equal(before.best.supplierId, 'b');
  const c48 = offer({
    supplierId: 'c',
    supplierProductId: 'c1',
    productName: 'PANADOL EXTRA 48 F.C. TAB.',
    unitPrice: 72, // 1.5/tab
  });
  const after = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [a24, b48, c48], {
    now: NOW,
  });
  assert.equal(after.best.supplierId, 'c', 'new supplier changes best without code edits');
  const source = readFileSync(new URL('../../worker/procurement/compare.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('pharmaoverseas'), 'compare.js must not hard-code supplier ids');
}

// --- netEffectivePrice precedence + discount tie-breaker + compareMany --------
{
  const discounted = offer({
    supplierId: 'a',
    supplierProductId: 'a1',
    unitPrice: 60,
    netEffectivePrice: 48,
    discountPct: 20,
  });
  const plain = offer({ supplierId: 'b', supplierProductId: 'b1', unitPrice: 48 });
  const result = compareForItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [discounted, plain], {
    now: NOW,
  });
  assert.equal(result.offers[0].offer.supplierId, 'a', 'discountPct desc breaks the tie');
  assert.equal(result.offers[0].packPrice, 48, 'packPrice uses netEffectivePrice');
  assert.equal(result.needsReview, false, 'same pack size, no flagged matches');

  const items = [{ name: 'PANADOL EXTRA 24 F.C. TAB.' }, { name: 'CONCOR 5MG 30 TABLETS' }];
  const many = compareMany(items, [discounted], { now: NOW });
  assert.equal(many.length, 2, 'one result per item, same order');
  assert.equal(many[0].item, items[0]);
  assert.equal(many[1].item, items[1]);
  assert.equal(many[0].best.supplierId, 'a');
  assert.equal(many[1].best, null, 'unrelated item has no match');
}

// --- 6. Performance: 10,000 offers x 200 items in < 1 s -----------------------
{
  const brands = Array.from(
    { length: 50 },
    (_, i) => `PHARMA${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
  );
  const offers = [];
  for (let i = 0; i < 10000; i += 1) {
    offers.push(
      offer({
        supplierId: `s${i % 7}`,
        supplierProductId: `p${i}`,
        productName: `${brands[i % 50]} 500MG ${((i % 4) + 1) * 10} TAB`,
        unitPrice: 20 + (i % 97),
      }),
    );
  }
  const items = Array.from({ length: 200 }, (_, i) => ({
    name: `${brands[i % 50]} 500MG ${((i % 4) + 1) * 10} TAB`,
  }));
  const t0 = performance.now();
  const results = compareMany(items, offers, { now: NOW });
  const elapsed = performance.now() - t0;
  assert.equal(results.length, 200);
  assert.ok(results.every((r) => r.best !== null), 'every item matched offers');
  console.log(`compareMany: 200 items x 10,000 offers in ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 1000, `expected < 1000 ms, got ${elapsed.toFixed(1)} ms`);
}

console.log('procurement-compare checks passed');
