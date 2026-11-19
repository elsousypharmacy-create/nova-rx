// Unit check for purchases-history.js (PUR-03):
// Verifies newest-first sorting, Arabic date formatting, total calculation (including receipt-operations.js corrections),
// status classification (تم الاستلام / مسودة / فرق), search by invoice or supplier, data-backed filters, and read-only guarantees.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ops = require('../../receipt-operations.js');
globalThis.NovaReceiptOperations = Ops;
const History = require('../../purchases-history.js');

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  let writeCount = 0;
  return {
    get writeCount() { return writeCount; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { writeCount++; map.set(k, String(v)); },
    removeItem(k) { writeCount++; map.delete(k); }
  };
}

// 1. Arabic date and money formatting
assert.equal(History.formatArabicDate('2026-11-18'), '18 نوفمبر 2026');
assert.equal(History.formatArabicDate('2026-11-08T10:20:00Z'), '8 نوفمبر 2026');
assert.equal(History.formatMoney(3450), '3,450.00 ج.م');
assert.equal(History.formatMoney(890.5), '890.50 ج.م');

// 2. Load & sort newest-first, calculate totals & classify statuses
const sampleReceipts = [
  {
    id: 'R-OLD',
    supplier: 'فارما أوفرسيز',
    invoice: '10288',
    date: '2026-11-08',
    at: '2026-11-08T09:00:00Z',
    pending: false,
    lines: [{ code: 'D1', name: 'دواء 1', qty: 10, cost: 89.05 }]
  },
  {
    id: 'R-DIFF',
    supplier: 'فارما أوفرسيز',
    invoice: '10310',
    date: '2026-11-12',
    at: '2026-11-12T11:00:00Z',
    pending: false,
    lines: [{ code: 'D2', name: 'دواء 2', qty: 12, cost: 610 }],
    corrections: [
      {
        id: 'C1',
        at: '2026-11-12T12:00:00Z',
        by: { id: 'u1', name: 'أحمد' },
        reason: 'فرق عد العبوات',
        changes: [{ index: 0, code: 'D2', before: 12, after: 10, delta: -2 }]
      }
    ]
  },
  {
    id: 'R-DRAFT',
    supplier: 'أوميت',
    invoice: '8891',
    date: '2026-11-17',
    at: '2026-11-17T14:00:00Z',
    pending: true,
    lines: [{ code: 'D3', name: 'دواء 3', qty: 16, cost: 80 }]
  },
  {
    id: 'R-NEW',
    supplier: 'فارما أوفرسيز',
    invoice: '10452',
    date: '2026-11-18',
    at: '2026-11-18T16:00:00Z',
    pending: false,
    lines: [{ code: 'D4', name: 'دواء 4', qty: 10, cost: 345 }]
  }
];

const storage = createMockStorage({
  'nova-rx-receipts-v1': JSON.stringify(sampleReceipts),
  'nova.purchase.orders': JSON.stringify([])
});

const items = History.loadHistoryItems(storage);
assert.equal(storage.writeCount, 0, 'loadHistoryItems must never write to storage');
assert.deepEqual(
  items.map(i => i.invoice),
  ['10452', '8891', '10310', '10288'],
  'items must be sorted newest first'
);

// Verify effective total after correction on 10310 (10 * 610 = 6,100.00)
const diffItem = items.find(i => i.invoice === '10310');
assert.equal(diffItem.total, 6100);
assert.equal(diffItem.totalFormatted, '6,100.00 ج.م');
assert.equal(diffItem.hasDiff, true);
assert.equal(diffItem.statusKind, 'diff');
assert.equal(diffItem.statusLabel, 'فرق: 2 ناقص');

// Verify draft item
const draftItem = items.find(i => i.invoice === '8891');
assert.equal(draftItem.isDraft, true);
assert.equal(draftItem.statusKind, 'draft');
assert.equal(draftItem.statusLabel, 'مسودة');

// Verify normal received item
const okItem = items.find(i => i.invoice === '10452');
assert.equal(okItem.isDraft, false);
assert.equal(okItem.hasDiff, false);
assert.equal(okItem.statusKind, 'ok');
assert.equal(okItem.statusLabel, 'تم الاستلام');

// 3. Search and filter chips logic
assert.equal(History.filterHistoryItems(items, '', 'all').length, 4);
assert.deepEqual(History.filterHistoryItems(items, '', 'draft').map(i => i.invoice), ['8891']);
assert.deepEqual(History.filterHistoryItems(items, '', 'diff').map(i => i.invoice), ['10310']);
assert.deepEqual(History.filterHistoryItems(items, '10452', 'all').map(i => i.invoice), ['10452']);
assert.deepEqual(History.filterHistoryItems(items, 'أوميت', 'all').map(i => i.invoice), ['8891']);
assert.deepEqual(History.filterHistoryItems(items, 'فارما', 'diff').map(i => i.invoice), ['10310']);

// 4. PO quantity mismatch classification via NovaReceiptOperations.review
const poStorage = createMockStorage({
  'nova-rx-receipts-v1': JSON.stringify([
    {
      id: 'R-PO',
      poId: 'PO-1',
      supplier: 'أوميت',
      invoice: '9001',
      date: '2026-11-19',
      pending: false,
      lines: [{ code: 'A1', name: 'صنف أ', qty: 7, cost: 50 }]
    }
  ]),
  'nova.purchase.orders': JSON.stringify([
    {
      id: 'PO-1',
      supplier: 'أوميت',
      state: 'partial',
      lines: [{ code: 'A1', name: 'صنف أ', qty: 10, received: 7, cost: 50 }]
    }
  ])
});
const poItems = History.loadHistoryItems(poStorage);
assert.equal(poItems[0].hasDiff, true);
assert.equal(poItems[0].statusLabel, 'فرق: 3 ناقص');
assert.equal(poStorage.writeCount, 0, 'PO classification must never write to storage');

console.log('PASS purchases-history unit: newest-first sort, Arabic dates, effective totals, statuses, search/filter, read-only');
