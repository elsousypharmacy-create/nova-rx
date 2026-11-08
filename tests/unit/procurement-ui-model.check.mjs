// Dependency-free checks for worker/procurement/ui-model.js (Task 08:
// supplier lookup UI model on the sale screen).
// Run: node tests/unit/procurement-ui-model.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLookupModel, stockUnitState, createDraftStore } from '../../worker/procurement/ui-model.js';

function offer(over) {
  return {
    supplierId: 'aumet',
    supplierName: 'Aumet',
    supplierProductId: 'x1',
    productName: 'AUGMENTIN 1 GM 14 TABLETS',
    currency: 'EGP',
    unitPrice: 164.8,
    publicPrice: 210,
    discountPct: 21.52,
    netEffectivePrice: null,
    availableQuantity: 40,
    stockStatus: 'in_stock',
    minimumOrderQuantity: null,
    lastUpdated: '2026-11-08T10:00:00Z',
    ...over,
  };
}
function row(offerObj, unitPriceComparable, eligible, reasons = []) {
  return {
    offer: offerObj,
    score: 0.95,
    unitPriceComparable,
    packPrice: offerObj.netEffectivePrice ?? offerObj.unitPrice,
    eligible,
    reasons,
  };
}

// --- buildLookupModel: two suppliers, Aumet with three sellers ---
const result = {
  item: { name: 'أوجمنتين 1 جم' },
  best: null,
  offers: [
    row(offer({ sellerId: 's1', sellerName: 'ElMotakadem', unitPrice: 164.8 }), 11.77, true),
    row(offer({ supplierProductId: 'x2', sellerId: 's2', sellerName: 'PharmaMart', unitPrice: 170, discountPct: 19 }), 12.14, true),
    row(offer({ supplierProductId: 'x3', sellerId: 's3', sellerName: 'CureLine', unitPrice: 180, discountPct: 14 }), 12.86, true),
    // Cheapest per unit but out of stock: must NOT be best.
    row(
      offer({ supplierId: 'pharmaoverseas', supplierName: 'PharmaOverseas', sellerId: null, sellerName: null, unitPrice: 150, availableQuantity: 0, stockStatus: 'out_of_stock' }),
      10.71,
      false,
      ['out_of_stock'],
    ),
  ],
  savingsVsNext: null,
  needsReview: false,
};

const model = buildLookupModel(result, { requestedQty: 5 });
assert.equal(model.title, 'أوجمنتين 1 جم');
assert.equal(model.groups.length, 2);
const byId = Object.fromEntries(model.groups.map((g) => [g.supplierId, g]));
assert.equal(byId.aumet.rows.length, 3);
assert.equal(byId.pharmaoverseas.rows.length, 1);

const allRows = model.groups.flatMap((g) => g.rows);
assert.equal(allRows.filter((r) => r.best).length, 1, 'exactly one best overall');
assert.equal(model.best.supplierId, 'aumet');
assert.equal(model.best.sellerName, 'ElMotakadem');
const poRow = byId.pharmaoverseas.rows[0];
assert.equal(poRow.best, false, 'out-of-stock cheapest row is not best');
assert.deepEqual(poRow.reasons, ['out_of_stock']);
assert.equal(poRow.stockLabel, 'غير متوفر');
assert.deepEqual(byId.aumet.rows.map((r) => r.sellerName), ['ElMotakadem', 'PharmaMart', 'CureLine']);
assert.equal(byId.aumet.rows[0].unitPriceLabel, 'سعر القرص 11.77 ج.م');
assert.equal(byId.aumet.rows[0].discountPct, 21.52);
assert.equal(byId.aumet.rows[0].publicPrice, 210);
assert.ok(byId.aumet.rows.every((r) => r.key));
assert.equal(new Set(allRows.map((r) => r.key)).size, allRows.length, 'row keys unique');
assert.equal(model.suggestionsNote, null, 'no alternatives in a single result');

// Alternatives payload: provider search shape with results list.
const withAlts = buildLookupModel(
  { fetchedAt: '2026-11-08T11:00:00Z', results: [result, { ...result, item: { name: 'MAGNABIOTIC 1 GM' } }], suppliers: [] },
  { requestedQty: 1 },
);
assert.ok(withAlts.suggestionsNote.includes('بدائل اقترحها المورد'));
assert.equal(withAlts.altGroups.length, 1);
assert.equal(withAlts.altGroups[0].groups.length, 2);

// --- stockUnitState ---
assert.deepEqual(stockUnitState(28), { tone: 'low', label: 'الرصيد 28 · منخفض' });
assert.deepEqual(stockUnitState(120), { tone: 'ok', label: 'الرصيد 120' });
assert.deepEqual(stockUnitState(30), { tone: 'ok', label: 'الرصيد 30' });

// --- draft store with a fake storage ---
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const storage = fakeStorage();
const store = createDraftStore(storage);
const r1 = byId.aumet.rows[0];
const r2 = byId.pharmaoverseas.rows[0];
store.add(r1, 2);
store.add(r1, 3);
assert.equal(store.list().length, 1);
assert.equal(store.list()[0].qty, 5, 'adding the same key twice sums the qty');
store.setQty(r1.key, 0);
assert.equal(store.list()[0].qty, 1, 'setQty clamps to minimum 1');
store.setQty(r1.key, 5000);
assert.equal(store.list()[0].qty, 999, 'setQty clamps to maximum 999');
store.add(r2, 4);

const reloaded = createDraftStore(storage);
assert.equal(reloaded.list().length, 2, 'draft persists and reloads from storage');
const grouped = reloaded.bySupplier();
assert.equal(grouped.length, 2);
const gAumet = grouped.find((g) => g.supplierId === 'aumet');
const gPo = grouped.find((g) => g.supplierId === 'pharmaoverseas');
assert.equal(gAumet.items.length, 1);
assert.equal(gAumet.items[0].qty, 999);
assert.equal(gPo.items[0].qty, 4);
assert.equal(gAumet.supplierName, 'Aumet');
reloaded.remove(r2.key);
assert.equal(reloaded.list().length, 1);
assert.equal(createDraftStore(storage).list().length, 1, 'removal persists');
assert.ok(!storage.getItem('novaSupplierDraft').includes('password'), 'draft never stores credentials');

// --- static checks on the DOM layer ---
const domJs = readFileSync(new URL('../../supplier-lookup.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../supplier-lookup.css', import.meta.url), 'utf8');
const modelJs = readFileSync(new URL('../../worker/procurement/ui-model.js', import.meta.url), 'utf8');
assert.ok(!domJs.includes('fetch' + '('), 'supplier-lookup.js must not call the network');
assert.ok(!domJs.includes('XMLHttpRequest'), 'supplier-lookup.js must not call the network');
assert.ok(!domJs.includes('localStorage.setItem'), 'no direct localStorage writes (password safety)');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{2B05}\u{2705}\u{274C}]/u;
for (const [name, src] of [['supplier-lookup.js', domJs], ['supplier-lookup.css', css], ['ui-model.js', modelJs]]) {
  assert.ok(!EMOJI.test(src), `no emoji in ${name}`);
}

console.log('procurement-ui-model checks passed');
