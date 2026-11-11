// INTEGRATION: CAT -> POS -> INV -> BUY on isolated in-memory fixtures (no live inventory, no supplier call, no network).
// Real modules: worker/catalog/unified-catalog.js (CAT-01), worker/catalog/unit-conversion.js (CAT-02),
// worker/inventory/stock-core.js (INV-01), worker/procurement/po-draft.js (existing BUY). Store = node:sqlite in memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';
import { createStockCore, CoreError } from '../../worker/inventory/stock-core.js';
import { buildSaleLines, planReplenishment, poLinesFromDraft } from '../../worker/inventory/glue.js';
import { buildDrafts, approveDraft } from '../../worker/procurement/po-draft.js';

const FIXED_NOW = new Date('2026-11-11T10:00:00Z');
const day = n => new Date(FIXED_NOW.getTime() + n * 864e5).toISOString().slice(0, 10);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.ok(e instanceof CoreError, String(e)); assert.equal(e.code, code, e.code + ' ' + JSON.stringify(e.detail)); return e; } assert.fail('expected ' + code); };

// ---- fixtures -------------------------------------------------------------------------------------------------
const exportRows = JSON.parse(readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8'));
const rows = Array.isArray(exportRows) ? exportRows : exportRows.items;
const pick = (re, n2 = 1) => rows.filter(r => re.test(r.namear) && Number.isInteger(Math.round(r.price * 100)) && Math.abs(r.price * 100 - Math.round(r.price * 100)) < 1e-6).slice(0, n2);
const [A, B] = [...pick(/بنادول|بانادول/, 1), ...pick(/جافيسكون/, 1)].concat(rows.slice(0, 2)).slice(0, 2);
assert.ok(A && B && A.code !== B.code, 'two real products from the committed export');
const PACKAGING = new Map([[String(A.code), { unitsPerStrip: 10, stripsPerBox: 3 }], [String(B.code), { unitsPerStrip: 12, stripsPerBox: 2 }]]); // fixture: the real export has no pack structure
const packagingOf = id => PACKAGING.get(String(id)) ?? null;
const catalog = createUnifiedCatalog(rows);
assert.equal(catalog.rejected.length, 0, 'the whole real export loads into CAT-01');

const T1 = { tenantId: 'pharmacy_1', branchId: 'main' }, T1B = { tenantId: 'pharmacy_1', branchId: 'second' }, T2 = { tenantId: 'pharmacy_2', branchId: 'main' };
const fresh = () => { const db = new DatabaseSync(':memory:'); const core = createStockCore(db, { now: () => FIXED_NOW }); core.install(); return { db, core }; };
const stockUp = async (core, scope = T1, key = 'rcpt-seed') => core.receiveGoods(scope, { key, lines: [
  { productId: A.code, lot: 'A-LATE', expiry: day(400), qtyBase: 600, costCents: 60000 }, { productId: A.code, lot: 'A-EARLY', expiry: day(60), qtyBase: 90, costCents: 9000 },
  { productId: B.code, lot: 'B-1', expiry: day(300), qtyBase: 240, costCents: 24000 }] });
const sellReq = (key = 'sale-1', number = 'INV-1') => {
  const r = buildSaleLines(catalog, packagingOf, [{ code: A.code, lines: [{ qty: 1, unit: 'box' }, { qty: 2, unit: 'strip' }, { qty: 5, unit: 'tablet' }] }]);
  assert.ok(r.ok, JSON.stringify(r));
  return { key, number, lines: r.lines, payments: [{ method: 'cash', amountCents: r.totalCents }] };
};

console.log('Running CAT->POS->INV->BUY integration cycle...');

await t('CAT: pack / strip / tablet conversion and exact pricing feed the sale', async () => {
  const r = buildSaleLines(catalog, packagingOf, [{ code: A.code, lines: [{ qty: 1, unit: 'box' }, { qty: 2, unit: 'strip' }, { qty: 5, unit: 'tablet' }] }]);
  assert.ok(r.ok);
  assert.deepEqual(r.lines.map(l => l.qtyBase), [30, 20, 5]);                                  // 1 box = 30, 2 strips = 20, 5 tablets
  assert.equal(r.totalCents, Math.round(A.price * 100 * 55 / 30), 'price of 55 tablets of a 30-tablet box, one rounding');
  assert.equal(r.lines.reduce((s, l) => s + l.lineTotalCents, 0), r.totalCents, 'split lines add up exactly');
  assert.equal(buildSaleLines(catalog, packagingOf, [{ code: A.code, lines: [{ qty: 0.5, unit: 'tablet' }] }]).error, 'fractional-base-units'); // half a tablet cannot be sold
  for (const [item, err] of [[{ code: 'NOPE', lines: [{ qty: 1, unit: 'box' }] }, 'product-not-found'], [{ code: A.code, lines: [{ qty: 1, unit: 'bottle' }] }, 'unit-unknown'], [{ code: A.code, lines: [{ qty: -1, unit: 'box' }] }, 'quantity-invalid']]) assert.equal(buildSaleLines(catalog, packagingOf, [item]).error, err);
  assert.equal(buildSaleLines(catalog, () => null, [{ code: A.code, lines: [{ qty: 1, unit: 'box' }] }]).error, 'packaging-missing');
});

await t('INV: receiving builds batches, an append-only ledger and balances that reconcile', async () => {
  const { db, core } = fresh(); const r = await stockUp(core);
  assert.equal(r.receivedBase, 930); assert.deepEqual(core.stockOf(T1, A.code), { productId: String(A.code), onHand: 690, available: 690 });
  assert.deepEqual(core.reconcile(T1), []);
  assert.throws(() => db.prepare('UPDATE stock_movement SET qty_delta = 1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM stock_movement').run(), /append-only/);
  const again = await stockUp(core); assert.equal(again.replay, true); assert.equal(core.stockOf(T1, A.code).onHand, 690, 'a repeated receipt does not double the stock');
  await rejects(core.receiveGoods(T1, { key: 'rcpt-seed', lines: [{ productId: A.code, lot: 'X', expiry: day(9), qtyBase: 1 }] }), 'idempotency-conflict');
  await rejects(core.receiveGoods(T1, { key: 'r2', lines: [{ productId: A.code, lot: 'A-EARLY', expiry: day(61), qtyBase: 1 }] }), 'lot-expiry-conflict');
  await rejects(core.receiveGoods(T1, { key: 'r3', lines: [{ productId: A.code, lot: 'L', expiry: '2026-02-31', qtyBase: 1 }] }), 'receipt-line-invalid');
});

await t('POS: sale is atomic, deducts FEFO from the right batches, and a replay creates nothing new', async () => {
  const { db, core } = fresh(); await stockUp(core);
  const req = sellReq(); const res = await core.sell(T1, req);
  assert.equal(res.totalCents, req.payments[0].amountCents); assert.equal(core.stockOf(T1, A.code).onHand, 690 - 55);
  const early = db.prepare("SELECT on_hand FROM stock_balance sb JOIN batch b ON b.id=sb.batch_id WHERE b.lot='A-EARLY'").get().on_hand;
  assert.equal(early, 90 - 55, 'the earliest-expiry batch is used first');
  const before = db.prepare('SELECT COUNT(*) c FROM invoice').get().c;
  for (let i = 0; i < 4; i++) { const again = await core.sell(T1, sellReq()); assert.equal(again.invoiceId, res.invoiceId); assert.equal(again.replay, true); }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM invoice').get().c, before); assert.equal(core.stockOf(T1, A.code).onHand, 635, 'repeat request deducts once');
  { const r2 = sellReq(); r2.lines[0] = { ...r2.lines[0], qtyBase: 31 }; await rejects(core.sell(T1, r2), 'idempotency-conflict'); } // same key, different content
  assert.deepEqual(core.reconcile(T1), []);
});

await t('POS: oversell, wrong payment, expired-only stock and crashes leave nothing behind', async () => {
  const { db, core } = fresh(); await stockUp(core);
  const snap = () => JSON.stringify(['invoice', 'invoice_line', 'payment', 'stock_movement', 'journal_entry', 'journal_line', 'idempotency_key'].map(t2 => db.prepare(`SELECT COUNT(*) c FROM ${t2}`).get().c).concat(db.prepare('SELECT SUM(on_hand) s FROM stock_balance').get().s));
  const before = snap();
  await rejects(core.sell(T1, { key: 'x1', number: 'INV-X1', lines: [{ productId: A.code, qtyBase: 700, lineTotalCents: 1000 }], payments: [{ method: 'cash', amountCents: 1000 }] }), 'insufficient-stock');
  await rejects(core.sell(T1, { ...sellReq('x2', 'INV-X2'), payments: [{ method: 'cash', amountCents: 1 }] }), 'payment-mismatch');
  for (const failAt of ['after-stock', 'after-journal']) await rejects(core.sell(T1, sellReq('crash-' + failAt, 'INV-C'), { failAt }), 'injected-failure');
  assert.equal(snap(), before, 'every table is unchanged after refusals and injected crashes');
  const ok = await core.sell(T1, sellReq('crash-after-stock', 'INV-C')); assert.ok(ok.invoiceId, 'the retry with the same key succeeds after a crash');
  const old = createStockCore(db, { now: () => FIXED_NOW }); await old.receiveGoods(T1, { key: 'old', lines: [{ productId: B.code, lot: 'B-OLD', expiry: day(-3), qtyBase: 50 }] });
  assert.deepEqual(old.stockOf(T1, B.code), { productId: String(B.code), onHand: 290, available: 240 }); // expired stock counts on the shelf but is not sellable
  await rejects(core.sell(T1, { key: 'x3', number: 'INV-X3', lines: [{ productId: B.code, qtyBase: 241, lineTotalCents: 100 }], payments: [{ method: 'cash', amountCents: 100 }] }), 'insufficient-stock');
});

await t('POS: partial and full returns restore the same batches and refund exactly', async () => {
  const { db, core } = fresh(); await stockUp(core);
  const res = await core.sell(T1, sellReq());
  const r1 = await core.returnItems(T1, { key: 'ret-1', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 10 }] });
  assert.equal(core.stockOf(T1, A.code).onHand, 690 - 55 + 10);
  assert.deepEqual(core.reconcile(T1), []);
  const again = await core.returnItems(T1, { key: 'ret-1', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 10 }] });
  assert.equal(again.replay, true); assert.equal(core.stockOf(T1, A.code).onHand, 645, 'a repeated return restores once');
  await rejects(core.returnItems(T1, { key: 'ret-2', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 46 }] }), 'return-exceeds-sold');
  const rest = await core.returnItems(T1, { key: 'ret-3', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 45 }] });
  assert.equal(r1.refundCents + rest.refundCents, res.totalCents, 'returning everything refunds exactly what was paid, to the cent');
  assert.equal(core.stockOf(T1, A.code).onHand, 690); assert.deepEqual(core.reconcile(T1), []);
  await rejects(core.returnItems(T1, { key: 'ret-4', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 1 }] }), 'return-exceeds-sold');
  await rejects(core.returnItems(T1, { key: 'ret-5', invoiceNumber: 'NOPE', items: [{ productId: A.code, qtyBase: 1 }] }), 'invoice-not-found');
  assert.throws(() => db.prepare('INSERT INTO return_line(invoice_line_id, qty, refund_cents, return_key) VALUES(1, 999, 0, \'z\')').run(), /return exceeds sold/);
});

await t('BUY: low stock creates shortages -> purchase plan -> existing PO draft builder (mock offers) -> approved draft', async () => {
  const { core } = fresh(); await stockUp(core);
  core.setPolicy(T1, A.code, 600, 900); core.setPolicy(T1, B.code, 100, 360);
  assert.deepEqual(core.shortages(T1), [], 'enough stock: no shortage');
  await core.sell(T1, { key: 'big', number: 'INV-BIG', lines: [{ productId: A.code, qtyBase: 150, lineTotalCents: Math.round(A.price * 100 * 5) }], payments: [{ method: 'cash', amountCents: Math.round(A.price * 100 * 5) }] });
  const sh = core.shortages(T1);
  assert.deepEqual(sh.map(s => [s.productId, s.available, s.needBase]), [[String(A.code), 540, 360]], 'only the product under its minimum, need = max - available');
  const { plan, skipped } = planReplenishment(sh, catalog, packagingOf); assert.deepEqual(skipped, []);
  assert.deepEqual(plan.map(p => p.qty), [12], '360 tablets of a 30-tablet box = 12 boxes');
  const comparisons = plan.map(p => ({ offers: [{ offer: { supplierId: 'supplier-a', supplierProductId: 'sp-1', productName: p.name, stockStatus: 'in_stock' }, score: 1, unitPriceComparable: 1, packPrice: A.price * 0.8, eligible: true, reasons: [] }] }));
  const built = buildDrafts(plan.map(p => ({ name: p.name, qty: p.qty })), comparisons, { now: FIXED_NOW.getTime() });
  assert.equal(built.drafts.length, 1); assert.equal(built.unmatched.length, 0);
  const approved = approveDraft(built.drafts[0], { approvedBy: 'pharmacist-fixture', now: FIXED_NOW.getTime() });
  assert.equal(approved.status, 'approved'); assert.equal(approved.lines[0].qty, 12);
});

await t('BUY: goods receipt against the PO updates stock, tracks partial delivery, refuses over-receipt, and is idempotent', async () => {
  const { core } = fresh(); await stockUp(core);
  core.setPolicy(T1, A.code, 600, 900);
  await core.sell(T1, { key: 'big', number: 'INV-BIG', lines: [{ productId: A.code, qtyBase: 150, lineTotalCents: 50000 }], payments: [{ method: 'cash', amountCents: 50000 }] });
  const sh = core.shortages(T1); assert.equal(sh.length, 1);
  const { plan } = planReplenishment(sh, catalog, packagingOf);
  const built = buildDrafts(plan.map(p => ({ name: p.name, qty: p.qty })), plan.map(p => ({ offers: [{ offer: { supplierId: 's', supplierProductId: 'x', productName: p.name, stockStatus: 'in_stock' }, score: 1, unitPriceComparable: 1, packPrice: 50, eligible: true, reasons: [] }] })), { now: 1 });
  const approved = approveDraft(built.drafts[0], { approvedBy: 'pharmacist-fixture', now: 2 });
  const po = poLinesFromDraft(approved, new Map(plan.map(p => [p.name, p.productId])), packagingOf); assert.ok(po.ok, JSON.stringify(po));
  assert.deepEqual(po.lines, [{ productId: String(A.code), orderedBase: 360 }]);
  assert.equal(poLinesFromDraft(built.drafts[0], new Map(), packagingOf).error, 'draft-not-approved');
  core.registerPurchaseOrder(T1, { poRef: 'PO-1', lines: po.lines });
  assert.equal(core.poStatus(T1, 'PO-1').complete, false);
  const part = await core.receiveGoods(T1, { key: 'gr-1', poRef: 'PO-1', lines: [{ productId: A.code, lot: 'A-NEW', expiry: day(500), qtyBase: 240, costCents: 12000 }] });
  assert.equal(part.receivedBase, 240); assert.equal(core.stockOf(T1, A.code).available, 540 + 240);
  assert.deepEqual(core.poStatus(T1, 'PO-1').lines, [{ productId: String(A.code), orderedBase: 360, receivedBase: 240, outstandingBase: 120 }]);
  assert.equal(core.shortages(T1).length, 0, 'partial delivery already lifts the product above its minimum');
  await rejects(core.receiveGoods(T1, { key: 'gr-bad', poRef: 'PO-1', lines: [{ productId: A.code, lot: 'A-NEW2', expiry: day(500), qtyBase: 121 }] }), 'over-receipt');
  await rejects(core.receiveGoods(T1, { key: 'gr-bad2', poRef: 'PO-1', lines: [{ productId: B.code, lot: 'B-X', expiry: day(500), qtyBase: 1 }] }), 'product-not-on-po');
  await rejects(core.receiveGoods(T1, { key: 'gr-bad3', poRef: 'PO-404', lines: [{ productId: A.code, lot: 'Q', expiry: day(500), qtyBase: 1 }] }), 'po-not-found');
  const replay = await core.receiveGoods(T1, { key: 'gr-1', poRef: 'PO-1', lines: [{ productId: A.code, lot: 'A-NEW', expiry: day(500), qtyBase: 240, costCents: 12000 }] });
  assert.equal(replay.replay, true); assert.equal(core.stockOf(T1, A.code).available, 780, 'a retried delivery note does not add stock twice');
  await core.receiveGoods(T1, { key: 'gr-2', poRef: 'PO-1', lines: [{ productId: A.code, lot: 'A-NEW', expiry: day(500), qtyBase: 120, costCents: 6000 }] });
  assert.equal(core.poStatus(T1, 'PO-1').complete, true); assert.deepEqual(core.reconcile(T1), []);
});

await t('ISOLATION: another tenant or branch sees nothing, cannot sell, return or receive against it, and keys do not collide', async () => {
  const { core } = fresh(); await stockUp(core, T1); await core.sell(T1, sellReq());
  assert.equal(core.stockOf(T2, A.code).onHand, 0); assert.equal(core.stockOf(T1B, A.code).onHand, 0);
  assert.equal(core.getInvoice(T2, 'INV-1'), null); assert.equal(core.getInvoice(T1B, 'INV-1'), null);
  await rejects(core.sell(T2, sellReq('sale-other', 'INV-9')), 'insufficient-stock');
  await rejects(core.sell(T1B, sellReq('sale-other-b', 'INV-9')), 'insufficient-stock');
  await rejects(core.returnItems(T2, { key: 'r-x', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 1 }] }), 'invoice-not-found');
  await rejects(core.returnItems(T1B, { key: 'r-y', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 1 }] }), 'invoice-not-found');
  core.registerPurchaseOrder(T1, { poRef: 'PO-ISO', lines: [{ productId: A.code, orderedBase: 10 }] });
  assert.equal(core.poStatus(T2, 'PO-ISO'), null); await rejects(core.receiveGoods(T2, { key: 'g', poRef: 'PO-ISO', lines: [{ productId: A.code, lot: 'Z', expiry: day(9), qtyBase: 1 }] }), 'po-not-found');
  await stockUp(core, T2, 'rcpt-seed'); // the SAME idempotency key in another tenant is a different request
  assert.equal(core.stockOf(T2, A.code).onHand, 690); assert.equal(core.stockOf(T1, A.code).onHand, 635);
  await core.sell(T2, sellReq('sale-1', 'INV-1')); // same key and invoice number, other tenant: allowed and independent
  assert.equal(core.getInvoice(T2, 'INV-1').lines.length, core.getInvoice(T1, 'INV-1').lines.length);
  core.setPolicy(T2, A.code, 5000, 6000); assert.equal(core.shortages(T1).length, 0); assert.equal(core.shortages(T2).length, 1, 'policies are per tenant');
  for (const bad of [null, {}, { tenantId: 'a:b', branchId: 'x' }, { tenantId: 'a', branchId: '' }, { tenantId: "x' OR 1=1 --", branchId: 'm' }]) assert.throws(() => core.stockOf(bad, A.code), e => e.code === 'scope-invalid');
  assert.deepEqual(core.reconcile(T1), []); assert.deepEqual(core.reconcile(T2), []);
});

await t('FULL CYCLE in one run: define item -> sell -> stock drops -> return -> shortage -> purchase -> receive -> shortage cleared; ledger reconciles', async () => {
  const { core } = fresh();
  const item = catalog.findById(A.code); assert.ok(item && item.price > 0, 'catalog item defined (CAT-01)');
  core.setPolicy(T1, A.code, 100, 300);
  await core.receiveGoods(T1, { key: 'open', lines: [{ productId: A.code, lot: 'L1', expiry: day(200), qtyBase: 150, costCents: 5000 }] });
  const s1 = buildSaleLines(catalog, packagingOf, [{ code: A.code, lines: [{ qty: 3, unit: 'box' }, { qty: 1, unit: 'strip' }] }]); // 100 tablets
  const sale = await core.sell(T1, { key: 'c-sale', number: 'C-1', lines: s1.lines, payments: [{ method: 'card', amountCents: s1.totalCents }] });
  assert.equal(core.stockOf(T1, A.code).available, 50); assert.equal(core.shortages(T1).length, 1, 'stock 50 < minimum 100');
  const ret = await core.returnItems(T1, { key: 'c-ret', invoiceNumber: 'C-1', items: [{ productId: A.code, qtyBase: 30 }] });
  assert.equal(core.stockOf(T1, A.code).available, 80); assert.ok(ret.refundCents > 0 && ret.refundCents < sale.totalCents);
  const sh = core.shortages(T1); assert.equal(sh[0].needBase, 220);
  const { plan } = planReplenishment(sh, catalog, packagingOf); assert.equal(plan[0].qty, 8, '220 tablets -> 8 boxes of 30 (rounded up)');
  const built = buildDrafts([{ name: plan[0].name, qty: plan[0].qty }], [{ offers: [{ offer: { supplierId: 's1', supplierProductId: 'p', productName: plan[0].name, stockStatus: 'in_stock' }, score: 1, unitPriceComparable: 1, packPrice: 40, eligible: true, reasons: [] }] }], { now: 1 });
  const approved = approveDraft(built.drafts[0], { approvedBy: 'pharmacist-fixture', now: 2 });
  const po = poLinesFromDraft(approved, new Map([[plan[0].name, plan[0].productId]]), packagingOf); core.registerPurchaseOrder(T1, { poRef: 'PO-C', lines: po.lines });
  assert.equal(po.lines[0].orderedBase, 240);
  await core.receiveGoods(T1, { key: 'c-gr', poRef: 'PO-C', lines: [{ productId: A.code, lot: 'L2', expiry: day(365), qtyBase: 240, costCents: 32000 }] });
  assert.equal(core.stockOf(T1, A.code).available, 320); assert.equal(core.shortages(T1).length, 0, 'shortage cleared by the receipt');
  assert.equal(core.poStatus(T1, 'PO-C').complete, true);
  assert.deepEqual(core.reconcile(T1), [], 'invoices, payments, journal, movements, returns and PO all reconcile');
});

await t('the reconciliation really detects corruption (tampered payment, balance, journal, return, receipt)', async () => {
  for (const [sql, re] of [
    ['UPDATE payment SET amount_cents = amount_cents + 1', /payments/], ['UPDATE stock_balance SET on_hand = on_hand + 1', /movements/],
    ['UPDATE journal_line SET debit_cents = debit_cents + 1 WHERE id = (SELECT MIN(id) FROM journal_line)', /debit/],
    ['UPDATE return_line SET refund_cents = refund_cents + 1', /refunded|refund/], ['UPDATE receipt_line SET qty = qty + 1000', /received/]]) {
    const { db, core } = fresh(); await stockUp(core); core.registerPurchaseOrder(T1, { poRef: 'P', lines: [{ productId: A.code, orderedBase: 10 }] });
    await core.receiveGoods(T1, { key: 'g', poRef: 'P', lines: [{ productId: A.code, lot: 'N', expiry: day(99), qtyBase: 10 }] });
    await core.sell(T1, sellReq()); await core.returnItems(T1, { key: 'r', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 5 }] });
    db.exec(sql); assert.ok(core.reconcile(T1).some(x => re.test(x)), sql + ' -> ' + core.reconcile(T1).join(';'));
  }
});

await t('closing the survivors: expired-only stock is a shortage; refund journal is balanced; same key across kinds and same PO ref across tenants stay independent; a full return refund is checked', async () => {
  { const { core } = fresh(); core.setPolicy(T1, B.code, 10, 50);
    await core.receiveGoods(T1, { key: 'e1', lines: [{ productId: B.code, lot: 'B-OLD', expiry: day(-1), qtyBase: 500 }] });
    assert.equal(core.stockOf(T1, B.code).onHand, 500); assert.deepEqual(core.shortages(T1).map(x => [x.productId, x.available, x.needBase]), [[String(B.code), 0, 50]], 'stock on the shelf that has expired does not hide a shortage'); }
  { const { db, core } = fresh(); await stockUp(core); await core.sell(T1, sellReq());
    const r = await core.returnItems(T1, { key: 'jr', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 20 }] });
    const j = db.prepare("SELECT jl.account a, jl.debit_cents d, jl.credit_cents c FROM journal_line jl JOIN journal_entry je ON je.id=jl.entry_id WHERE je.ref_type='return'").all();
    assert.deepEqual(j.map(x => [x.a, x.d, x.c]).sort(), [['cash', 0, r.refundCents], ['sales', r.refundCents, 0]].sort()); }
  { const { core } = fresh(); await stockUp(core);
    const a1 = await core.receiveGoods(T1, { key: 'SAME', lines: [{ productId: B.code, lot: 'K1', expiry: day(50), qtyBase: 10 }] });
    const a2 = await core.sell(T1, { ...sellReq('SAME', 'INV-K'), });
    assert.ok(a1.receiptKey === 'SAME' && a2.invoiceId, 'the same client key used for a receipt and a sale is two different requests'); assert.equal(a2.replay, undefined);
    const r3 = await core.returnItems(T1, { key: 'SAME', invoiceNumber: 'INV-K', items: [{ productId: A.code, qtyBase: 1 }] }); assert.equal(r3.replay, undefined); }
  { const { core } = fresh();
    core.registerPurchaseOrder(T1, { poRef: 'PO-SHARED', lines: [{ productId: A.code, orderedBase: 100 }] });
    core.registerPurchaseOrder(T2, { poRef: 'PO-SHARED', lines: [{ productId: A.code, orderedBase: 7 }] });
    assert.equal(core.poStatus(T1, 'PO-SHARED').lines[0].orderedBase, 100); assert.equal(core.poStatus(T2, 'PO-SHARED').lines[0].orderedBase, 7);
    await core.receiveGoods(T2, { key: 'g', poRef: 'PO-SHARED', lines: [{ productId: A.code, lot: 'Z', expiry: day(30), qtyBase: 7 }] });
    assert.equal(core.poStatus(T1, 'PO-SHARED').lines[0].receivedBase, 0, 'tenant 2 receiving does not count for tenant 1'); assert.equal(core.poStatus(T2, 'PO-SHARED').complete, true); }
  { const { db, core } = fresh(); await stockUp(core); await core.sell(T1, sellReq());
    await core.returnItems(T1, { key: 'full', invoiceNumber: 'INV-1', items: [{ productId: A.code, qtyBase: 55 }] }); assert.deepEqual(core.reconcile(T1), []);
    db.exec('UPDATE return_line SET refund_cents = refund_cents - 1 WHERE id = (SELECT MIN(id) FROM return_line)'); assert.ok(core.reconcile(T1).some(x => /fully returned/.test(x))); }
});

console.log(`PASS core cycle integration (CAT->POS->INV->BUY): ${n} cases on isolated fixtures; real catalog export (${rows.length} rows), no live data, no supplier call`);
