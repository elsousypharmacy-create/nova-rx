// S2-02: POS strip/tablet lines enter sync as integer base units; unmapped units go to a visible review list and are retried once.
// Run: node tests/unit/sync-units.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const syncWire = require('../../pos-sync-wire.js');
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

const storage = memStorage();
const outbox = createOutbox(storage, 'nova.outbox');
const ledger = createLedger(storage, 'nova.stock.ledger');

const packMap = {
  p1: { box: 1, strip: 3, tablet: 30 },
  pBox: { box: 1 },
  pX: null
};

const units = {
  perBoxOf: (l) => packMap[l && (l.barcode || l.name)] || null,
  canonical: (u) => {
    if (!u || u === 'box' || u === 'علبة') return 'box';
    if (u === 'strip' || u === 'شريط') return 'strip';
    if (u === 'tablet' || u === 'قرص') return 'tablet';
    return null;
  }
};

const savedSales = new Map();
const addedSales = [];
const byKey = (k) => outbox.all().find((x) => x.key === k);

const wire = syncWire.create({
  outbox,
  ledger,
  storage,
  units,
  hasSale: (id) => savedSales.has(id),
  addSale: (rec) => {
    savedSales.set(rec.id, rec);
    addedSales.push(rec);
    return true;
  }
});

// 1. box sale of 1 p1 at 30 -> outbox line qty 30 unit tablet perBox 30 price 1
const s1 = { id: 's1', number: '1', at: '2026-01-01T00:00:00Z', total: 30, lines: [{ barcode: 'p1', unit: 'box', qty: 1, price: 30 }] };
savedSales.set(s1.id, s1);
const r1 = wire.afterSale(s1);
assert.equal(r1.queued, true);
const ob1 = byKey('s1');
assert.ok(ob1);
assert.deepEqual(ob1.payload.lines, [{ code: 'p1', qty: 30, price: 1, unit: 'tablet', perBox: 30 }]);
assert.equal(ledger.onHand('p1'), -30, 'local ledger counts the same base units');

// 2. strip sale of 2 p1 at 10.5 -> qty 20, server total (sum qty*price - discount) equals 21
const s2 = { id: 's2', number: '2', at: '2026-01-01T00:01:00Z', total: 21, lines: [{ barcode: 'p1', unit: 'strip', qty: 2, price: 10.5 }] };
savedSales.set(s2.id, s2);
const r2 = wire.afterSale(s2);
assert.equal(r2.queued, true);
const ob2 = byKey('s2');
assert.ok(ob2);
assert.equal(ob2.payload.lines[0].qty, 20);
const serverGross2 = ob2.payload.lines.reduce((acc, l) => acc + l.qty * Math.round(l.price * 100), 0);
const serverDisc2 = Math.round((ob2.payload.discount || 0) * 100);
assert.equal((serverGross2 - serverDisc2) / 100, 21);

// 3. tablet sale of 7 -> qty 7
const s3 = { id: 's3', number: '3', at: '2026-01-01T00:02:00Z', total: 7, lines: [{ barcode: 'p1', unit: 'tablet', qty: 7, price: 1 }] };
savedSales.set(s3.id, s3);
const r3 = wire.afterSale(s3);
assert.equal(r3.queued, true);
assert.equal(byKey('s3').payload.lines[0].qty, 7);

// 4. box-only product (perBoxOf returns {box:1}) box sale -> qty 1 unit box perBox 1
const s4 = { id: 's4', number: '4', at: '2026-01-01T00:03:00Z', total: 50, lines: [{ barcode: 'pBox', unit: 'box', qty: 1, price: 50 }] };
savedSales.set(s4.id, s4);
const r4 = wire.afterSale(s4);
assert.equal(r4.queued, true);
assert.deepEqual(byKey('s4').payload.lines, [{ code: 'pBox', qty: 1, price: 50, unit: 'box', perBox: 1 }]);

// 5. strip sale of pX -> not queued, in nova.sync.review with the Arabic message
const sX = { id: 'sX', number: '5', at: '2026-01-01T00:04:00Z', total: 15, lines: [{ barcode: 'pX', unit: 'strip', qty: 1, price: 15 }] };
savedSales.set(sX.id, sX);
const rX = wire.afterSale(sX);
assert.equal(rX.queued, false);
assert.equal(rX.skipped, 'unit-mapping');
assert.equal(byKey('sX'), undefined);
const revList1 = JSON.parse(storage.getItem('nova.sync.review'));
assert.equal(revList1.length, 1);
assert.equal(revList1[0].id, 'sX');
assert.equal(revList1[0].message_ar, 'وحدة البيع غير معرّفة لهذا الصنف — اضبط التعبئة ثم أعد الإرسال');
assert.equal(wire.pending().reviewUnits, 1);
assert.equal(storage.getItem('nova.sync.skipped'), null, 'no new silent-skip entries');

// 6. return of 1 strip of a mapped strip sale -> queued return op line qty 10
const ret2 = { id: 'r2', saleId: 's2', lines: [{ idx: 0, qty: 1 }] };
const rr2 = wire.afterReturn(s2, ret2);
assert.equal(rr2.queued, true);
const obRet2 = byKey('ret:r2');
assert.ok(obRet2);
assert.equal(obRet2.payload.lines[0].qty, 10);

// 7. return of the unmapped pX sale -> not queued, remembered
const retX = { id: 'rX', saleId: 'sX', lines: [{ idx: 0, qty: 1 }] };
const rrX = wire.afterReturn(sX, retX);
assert.equal(rrX.queued, false);
assert.equal(rrX.skipped, 'unit-mapping');
assert.equal(byKey('ret:rX'), undefined);
const revList2 = JSON.parse(storage.getItem('nova.sync.review'));
assert.equal(revList2[0].returns.length, 1);
assert.equal(revList2[0].returns[0].id, 'rX');

// 8. after fixing packaging retryReview queues the sale then its return once, a second retryReview queues nothing
packMap.pX = { box: 1, strip: 2, tablet: 20 };
const retry1 = wire.retryReview((id) => savedSales.get(id));
assert.deepEqual(retry1, { queued: 1, still: 0 });
assert.equal(wire.pending().reviewUnits, 0);
const allAfterRetry = outbox.all();
const idxSaleX = allAfterRetry.findIndex((x) => x.key === 'sX');
const idxRetX = allAfterRetry.findIndex((x) => x.key === 'ret:rX');
assert.ok(idxSaleX >= 0 && idxRetX > idxSaleX);
assert.equal(allAfterRetry[idxSaleX].payload.lines[0].qty, 10);
assert.equal(allAfterRetry[idxRetX].payload.lines[0].qty, 10);

const retry2 = wire.retryReview((id) => savedSales.get(id));
assert.deepEqual(retry2, { queued: 0, still: 0 });
const countBefore = outbox.all().length;
wire.afterSale(sX); // a replayed sale never duplicates (outbox is idempotent by sale id)
assert.equal(outbox.all().length, countBefore);

// 9. applyChanges sale item with unit/perBox creates a record line with unitFactor 30 via an addSale stub
const pullRes = wire.applyChanges([
  {
    entity: 'sale',
    changedAt: '2026-01-01T01:00:00Z',
    data: {
      saleId: 'remote1',
      invoiceId: 'invRemote1',
      discountMinor: 0,
      items: [{ productId: 'p1', qty: 20, unitPriceMinor: 20, unit: 'tablet', perBox: 30 }]
    }
  }
]);
assert.equal(pullRes.applied, 1);
assert.equal(addedSales.length, 1);
assert.equal(addedSales[0].lines[0].unit, 'tablet');
assert.equal(addedSales[0].lines[0].unitFactor, 30);
assert.equal(addedSales[0].lines[0].qty, 20);
assert.equal(addedSales[0].lines[0].price, 0.2);

console.log('sync-units OK');
