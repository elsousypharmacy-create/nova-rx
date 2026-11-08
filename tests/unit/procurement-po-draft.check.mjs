// Dependency-free checks for worker/procurement/po-draft.js (Task 07:
// purchase order drafts, drafts-only scope).
// Run: node tests/unit/procurement-po-draft.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDrafts, approveDraft, draftToText } from '../../worker/procurement/po-draft.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');

function row(over = {}) {
  const { offerOver = {}, ...rest } = over;
  return {
    offer: {
      supplierId: 'a',
      supplierProductId: 'a1',
      productName: 'PANADOL EXTRA 24 F.C. TAB.',
      stockStatus: 'in_stock',
      ...offerOver,
    },
    score: 1,
    unitPriceComparable: 1,
    packPrice: 10,
    eligible: true,
    reasons: [],
    ...rest,
  };
}

function comparison(rows, needsReview = false) {
  return {
    item: { name: 'x' },
    best: rows.find((r) => r.eligible)?.offer ?? null,
    offers: rows,
    savingsVsNext: null,
    needsReview,
  };
}

// --- 1. 3 shortages across 2 suppliers -> 2 drafts with correct lines/totals
{
  const out = buildDrafts(
    [
      { name: 'panadol', qty: 2 },
      { name: 'cefixime', qty: 1 },
      { name: 'insulin', qty: 3 },
    ],
    [
      comparison([row({ offerOver: { supplierId: 'a', supplierProductId: 'a-pan' }, packPrice: 10 })]),
      comparison([row({ offerOver: { supplierId: 'b', supplierProductId: 'b-cef' }, packPrice: 20 })]),
      comparison([row({ offerOver: { supplierId: 'a', supplierProductId: 'a-ins' }, packPrice: 5 })]),
    ],
    { now: NOW }
  );
  assert.equal(out.createdAt, NOW);
  assert.equal(out.drafts.length, 2, 'one draft per supplier');
  assert.deepEqual(out.unmatched, []);
  const da = out.drafts.find((d) => d.supplierId === 'a');
  const db = out.drafts.find((d) => d.supplierId === 'b');
  assert.equal(da.id, `a-${NOW}`);
  assert.equal(da.status, 'draft');
  assert.deepEqual(
    da.lines.map((l) => [l.name, l.supplierProductId, l.qty, l.packPrice, l.lineTotal]),
    [
      ['panadol', 'a-pan', 2, 10, 20],
      ['insulin', 'a-ins', 3, 5, 15],
    ]
  );
  assert.equal(da.total, 35);
  assert.equal(db.id, `b-${NOW}`);
  assert.equal(db.lines.length, 1);
  assert.equal(db.lines[0].lineTotal, 20);
  assert.equal(db.total, 20);
}

// --- 2. low stock on best supplier, qty 10 -> 5 there + 5 on next supplier
{
  const out = buildDrafts(
    [{ name: 'amox', qty: 10 }],
    [
      comparison([
        row({ offerOver: { supplierId: 'a', supplierProductId: 'a-amox', stockStatus: 'low' }, packPrice: 8 }),
        row({ offerOver: { supplierId: 'b', supplierProductId: 'b-amox' }, packPrice: 9 }),
      ]),
    ],
    { now: NOW }
  );
  const da = out.drafts.find((d) => d.supplierId === 'a');
  const db = out.drafts.find((d) => d.supplierId === 'b');
  assert.equal(da.lines.length, 1);
  assert.equal(da.lines[0].qty, 5, 'half (rounded up) stays with the low-stock best');
  assert.equal(db.lines[0].qty, 5, 'the rest moves to the next supplier');
  assert.equal(out.unmatched.length, 0);
}

// --- 2b. low stock but no other supplier -> full qty stays with best
{
  const out = buildDrafts(
    [{ name: 'amox', qty: 10 }],
    [comparison([row({ offerOver: { stockStatus: 'low' }, packPrice: 8 })])],
    { now: NOW }
  );
  assert.equal(out.drafts.length, 1);
  assert.equal(out.drafts[0].lines[0].qty, 10);
}

// --- 3. no eligible offer -> unmatched with a reason, never dropped
{
  const out = buildDrafts(
    [
      { name: 'none', qty: 1 },
      { name: 'oos', qty: 1 },
      { name: 'stale', qty: 1 },
      { name: 'review', qty: 1 },
    ],
    [
      comparison([]),
      comparison([row({ eligible: false, reasons: ['out_of_stock'], offerOver: { stockStatus: 'out_of_stock' } })]),
      comparison([row({ eligible: false, reasons: ['stale'] })]),
      comparison([row({ eligible: false, reasons: ['MOQ'] })], true),
    ],
    { now: NOW }
  );
  assert.equal(out.drafts.length, 0);
  assert.deepEqual(
    out.unmatched.map((u) => [u.name, u.qty, u.reason]),
    [
      ['none', 1, 'no-match'],
      ['oos', 1, 'all-out-of-stock'],
      ['stale', 1, 'all-stale'],
      ['review', 1, 'needs-review'],
    ]
  );
}

// --- 4. approveDraft guards
{
  const draft = { id: `a-${NOW}`, supplierId: 'a', status: 'draft', lines: [], total: 0 };
  assert.throws(() => approveDraft(draft, { approvedBy: '' }), /approvedBy/);
  assert.throws(() => approveDraft(draft, { approvedBy: '   ' }), /approvedBy/);
  assert.throws(() => approveDraft(draft, {}), /approvedBy/);
  const ok = approveDraft(draft, { approvedBy: 'pharmacist-1', now: NOW });
  assert.equal(ok.status, 'approved');
  assert.equal(ok.approvedBy, 'pharmacist-1');
  assert.equal(ok.approvedAt, NOW);
  assert.equal(draft.status, 'draft', 'returns a copy, original untouched');
  assert.throws(() => approveDraft(ok, { approvedBy: 'pharmacist-1', now: NOW }), /status/);
}

// --- 5. static: no network, no cart/order submission
{
  const src = readFileSync(new URL('../../worker/procurement/po-draft.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('fetch('), 'source must not contain fetch(');
  assert.ok(!src.includes('checkout'), 'source must not reference cart/order submission');
}

// --- 6. draftToText: WhatsApp-ready Arabic with totals in EGP
{
  const { drafts } = buildDrafts(
    [
      { name: 'panadol', qty: 2 },
      { name: 'insulin', qty: 3 },
    ],
    [
      comparison([row({ offerOver: { supplierId: 'a', supplierProductId: 'a-pan' }, packPrice: 10 })]),
      comparison([row({ offerOver: { supplierId: 'a', supplierProductId: 'a-ins' }, packPrice: 5 })]),
    ],
    { now: NOW }
  );
  const text = draftToText(drafts[0], { lang: 'ar' });
  assert.ok(text.includes('المورد: a'));
  assert.ok(text.includes('panadol × 2 = 20.00 ج.م'));
  assert.ok(text.includes('insulin × 3 = 15.00 ج.م'));
  assert.ok(text.includes('الإجمالي: 35.00'));
  assert.ok(text.includes('EGP'));
  assert.throws(() => draftToText(drafts[0], { lang: 'en' }), /unsupported lang/);
}

console.log('procurement-po-draft checks passed');
