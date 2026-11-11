// INV-01 review fixes (Claude 1's review of abb77e1): branch-scoped idempotency, refunds back to the ORIGINAL payment method,
// typed store errors, transaction discipline, approved adjustments, expiry alerts. Synthetic products, in-memory SQLite, no network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStockCore, CoreError } from '../../worker/inventory/stock-core.js';

const NOW = new Date('2026-11-11T10:00:00Z');
const day = k => new Date(NOW.getTime() + k * 864e5).toISOString().slice(0, 10);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.ok(e instanceof CoreError, `typed error expected, got ${e?.constructor?.name}: ${e?.message}`); assert.equal(e.code, code); return e; } assert.fail('expected ' + code); };
const rejectsSync = (f, code) => { try { f(); } catch (e) { assert.ok(e instanceof CoreError, `typed error expected, got ${e?.constructor?.name}: ${e?.message}`); assert.equal(e.code, code); return e; } assert.fail('expected ' + code); };
const B1 = { tenantId: 'T', branchId: 'b1' }, B2 = { tenantId: 'T', branchId: 'b2' }, OTHER = { tenantId: 'U', branchId: 'b1' };
const fresh = (db = new DatabaseSync(':memory:')) => { const core = createStockCore(db, { now: () => NOW }); core.install(); return { db, core }; };
const stock = (core, scope = B1, over = {}) => core.receiveGoods(scope, { key: `rcv-${scope.tenantId}-${scope.branchId}-${over.lot ?? 'L1'}`, lines: [{ productId: 'P1', lot: 'L1', expiry: day(60), qtyBase: 100, costCents: 1000, ...over }] });
const sale = (key, number, qty, payments, total) => ({ key, number, lines: [{ productId: 'P1', qtyBase: qty, lineTotalCents: total }], payments });
const journal = db => db.prepare('SELECT je.ref_type AS ref, jl.account AS account, jl.debit_cents AS d, jl.credit_cents AS c FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id ORDER BY je.id, jl.id').all().map(r => ({ ...r }));
console.log('INV-01 review-fix checks');

await t('FIX 1: idempotency is scoped by branch: the same key and request from another branch is a conflict, never a silent replay', async () => {
  const { core } = fresh(); await stock(core, B1); await stock(core, B2);
  const req = sale('same-key', 'N-1', 3, [{ method: 'cash', amountCents: 300 }], 300);
  assert.equal((await core.sell(B1, req)).totalCents, 300);
  await rejects(core.sell(B2, req), 'idempotency-conflict');
  assert.equal(core.stockOf(B1, 'P1').onHand, 97); assert.equal(core.stockOf(B2, 'P1').onHand, 100, 'branch 2 was not touched');
  const rcv = { key: 'rcv-shared', lines: [{ productId: 'P1', lot: 'Z', expiry: day(9), qtyBase: 5 }] };
  await core.receiveGoods(B1, rcv); await rejects(core.receiveGoods(B2, rcv), 'idempotency-conflict');
  assert.equal((await core.sell(B1, req)).replay, true, 'the same branch still replays');
  const ret = { key: 'ret-shared', invoiceNumber: 'N-1', items: [{ productId: 'P1', qtyBase: 1 }] };
  assert.equal((await core.returnItems(B1, ret)).refundCents, 100);
  await rejects(core.returnItems(B2, ret), 'idempotency-conflict');
  assert.equal(core.stockOf(B1, 'P1').onHand, 103, 'the return restored stock once, in branch 1 only (100 + 5 received - 3 sold + 1 returned)');
});

await t('FIX 2: a return refunds the ORIGINAL payment methods in the order they were taken, never more than each paid, with matching journal accounts', async () => {
  const { db, core } = fresh(); await stock(core);
  await core.sell(B1, sale('s1', 'N-2', 10, [{ method: 'cash', amountCents: 300 }, { method: 'credit', amountCents: 700 }], 1000));
  const r1 = await core.returnItems(B1, { key: 'r1', invoiceNumber: 'N-2', items: [{ productId: 'P1', qtyBase: 4 }] });
  assert.equal(r1.refundCents, 400);
  assert.deepEqual(r1.refundedTo, [{ method: 'cash', amountCents: 300 }, { method: 'credit', amountCents: 100 }]);
  const r2 = await core.returnItems(B1, { key: 'r2', invoiceNumber: 'N-2', items: [{ productId: 'P1', qtyBase: 6 }] });
  assert.equal(r2.refundCents, 600); assert.deepEqual(r2.refundedTo, [{ method: 'credit', amountCents: 600 }]);
  const refunds = journal(db).filter(x => x.ref === 'return');
  assert.deepEqual(refunds, [{ ref: 'return', account: 'sales', d: 400, c: 0 }, { ref: 'return', account: 'cash', d: 0, c: 300 }, { ref: 'return', account: 'receivable', d: 0, c: 100 },
    { ref: 'return', account: 'sales', d: 600, c: 0 }, { ref: 'return', account: 'receivable', d: 0, c: 600 }]);
  assert.deepEqual(core.reconcile(B1), []);
  const per = db.prepare('SELECT p.method AS m, p.amount_cents AS paid, COALESCE(SUM(rp.amount_cents),0) AS refunded FROM payment p LEFT JOIN refund_payment rp ON rp.payment_id = p.id GROUP BY p.id').all().map(r => ({ ...r }));
  assert.deepEqual(per, [{ m: 'cash', paid: 300, refunded: 300 }, { m: 'credit', paid: 700, refunded: 700 }], 'each payment refunded exactly what it paid');
});

await t('FIX 2b: card refunds go to the card account; a cash-only sale still refunds cash; the schema refuses refunding more than a payment', async () => {
  const { db, core } = fresh(); await stock(core);
  await core.sell(B1, sale('s2', 'N-3', 10, [{ method: 'card', amountCents: 600 }, { method: 'cash', amountCents: 400 }], 1000));
  const r = await core.returnItems(B1, { key: 'r3', invoiceNumber: 'N-3', items: [{ productId: 'P1', qtyBase: 3 }] });
  assert.deepEqual(r.refundedTo, [{ method: 'card', amountCents: 300 }]);
  assert.deepEqual(journal(db).filter(x => x.ref === 'return' && x.c > 0), [{ ref: 'return', account: 'card', d: 0, c: 300 }]);
  await core.sell(B1, sale('s3', 'N-4', 2, [{ method: 'cash', amountCents: 200 }], 200));
  assert.deepEqual((await core.returnItems(B1, { key: 'r4', invoiceNumber: 'N-4', items: [{ productId: 'P1', qtyBase: 1 }] })).refundedTo, [{ method: 'cash', amountCents: 100 }]);
  const pay = db.prepare("SELECT id FROM payment WHERE method='card'").get().id;
  assert.throws(() => db.prepare('INSERT INTO refund_payment(payment_id, return_key, amount_cents) VALUES(?,?,?)').run(pay, 'evil', 400), /refund exceeds payment/);
  assert.deepEqual(core.reconcile(B1), []);
});

await t('FIX 2c: reconcile detects a refund that does not match its return or its payment', async () => {
  const { db, core } = fresh(); await stock(core);
  await core.sell(B1, sale('s1', 'N-5', 10, [{ method: 'cash', amountCents: 1000 }], 1000));
  await core.returnItems(B1, { key: 'r1', invoiceNumber: 'N-5', items: [{ productId: 'P1', qtyBase: 5 }] });
  assert.deepEqual(core.reconcile(B1), []);
  db.prepare('UPDATE refund_payment SET amount_cents = amount_cents - 1').run();
  const v = core.reconcile(B1); assert.ok(v.some(x => /refund/.test(x)), JSON.stringify(v));
  db.prepare('UPDATE refund_payment SET amount_cents = 5000').run();
  assert.ok(core.reconcile(B1).some(x => /refunded 5000 > paid 1000/.test(x)), 'a refund above what the payment was is reported');
});

await t('FIX 3: store constraint errors become typed CoreErrors and failed registrations leave nothing behind', async () => {
  const { db, core } = fresh(); await stock(core); await stock(core, B2);
  await core.sell(B1, sale('s1', 'DUP', 1, [{ method: 'cash', amountCents: 100 }], 100));
  await rejects(core.sell(B1, sale('s2', 'DUP', 1, [{ method: 'cash', amountCents: 100 }], 100)), 'invoice-number-exists');
  await rejects(core.sell(B2, sale('s3', 'DUP', 1, [{ method: 'cash', amountCents: 100 }], 100)), 'invoice-number-exists'); // numbers are unique per tenant (documented)
  assert.equal(core.stockOf(B1, 'P1').onHand, 99, 'the refused sale deducted nothing');
  core.registerPurchaseOrder(B1, { poRef: 'PO1', lines: [{ productId: 'P1', orderedBase: 5 }] });
  rejectsSync(() => core.registerPurchaseOrder(B1, { poRef: 'PO1', lines: [{ productId: 'P1', orderedBase: 5 }] }), 'po-exists');
  rejectsSync(() => core.registerPurchaseOrder(B1, { poRef: 'PO2', lines: [{ productId: 'P1', orderedBase: 5 }, { productId: 'P1', orderedBase: 2 }] }), 'po-line-duplicate');
  assert.equal(core.poStatus(B1, 'PO2'), null, 'nothing of the failed registration remains');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM po_line WHERE po_ref='PO2'").get().c, 0);
});

await t('FIX 4: purchase order references are validated (receipt and registration), and unknown POs are refused', async () => {
  const { core } = fresh();
  for (const bad of ['bad ref!', '', 'a'.repeat(200), 'x;drop', '../x']) {
    await rejects(core.receiveGoods(B1, { key: 'rcv-x1', poRef: bad === '' ? ' ' : bad, lines: [{ productId: 'P1', lot: 'L', expiry: day(9), qtyBase: 1 }] }), 'po-invalid');
    rejectsSync(() => core.registerPurchaseOrder(B1, { poRef: bad, lines: [{ productId: 'P1', orderedBase: 1 }] }), 'po-invalid');
  }
  await rejects(core.receiveGoods(B1, { key: 'rcv-x2', poRef: 'GHOST', lines: [{ productId: 'P1', lot: 'L', expiry: day(9), qtyBase: 1 }] }), 'po-not-found');
});

await t('FIX 5: every write is one BEGIN IMMEDIATE ... COMMIT transaction, and a failure ends in ROLLBACK', async () => {
  const real = new DatabaseSync(':memory:'); const log = [];
  const spy = { exec: sql => { log.push(String(sql).trim().split(/\s+/).slice(0, 2).join(' ')); return real.exec(sql); }, prepare: sql => real.prepare(sql) };
  const core = createStockCore(spy, { now: () => NOW }); core.install(); log.length = 0;
  await core.receiveGoods(B1, { key: 'rcv-spy', lines: [{ productId: 'P1', lot: 'L1', expiry: day(30), qtyBase: 10 }] });
  assert.deepEqual(log, ['BEGIN IMMEDIATE', 'COMMIT']);
  log.length = 0; await core.sell(B1, sale('spy-1', 'SPY-1', 1, [{ method: 'cash', amountCents: 5 }], 5)); assert.deepEqual(log, ['BEGIN IMMEDIATE', 'COMMIT']);
  log.length = 0; await rejects(core.sell(B1, sale('spy-2', 'SPY-2', 99, [{ method: 'cash', amountCents: 5 }], 5)), 'insufficient-stock'); assert.deepEqual(log, ['BEGIN IMMEDIATE', 'ROLLBACK']);
  log.length = 0; core.registerPurchaseOrder(B1, { poRef: 'PO-SPY', lines: [{ productId: 'P1', orderedBase: 1 }] }); assert.deepEqual(log, ['BEGIN IMMEDIATE', 'COMMIT']);
  log.length = 0; await core.returnItems(B1, { key: 'spy-3', invoiceNumber: 'SPY-1', items: [{ productId: 'P1', qtyBase: 1 }] }); assert.deepEqual(log, ['BEGIN IMMEDIATE', 'COMMIT']);
  log.length = 0; await core.adjust(B1, { key: 'spy-4', productId: 'P1', lot: 'L1', delta: -1, reason: 'count difference', approvedBy: 'boss', actor: 'clerk' }); assert.deepEqual(log, ['BEGIN IMMEDIATE', 'COMMIT']);
});

await t('FIX 6: adjustments need a reason and a DIFFERENT approver, never go below zero, need a known lot, and are idempotent', async () => {
  const { db, core } = fresh(); await stock(core);
  const adj = (o = {}) => core.adjust(B1, { key: `adj-${Math.random().toString(36).slice(2, 10)}`, productId: 'P1', lot: 'L1', delta: -2, reason: 'count difference', approvedBy: 'boss', actor: 'clerk', ...o });
  assert.deepEqual(await adj(), { productId: 'P1', lot: 'L1', delta: -2, onHand: 98 });
  assert.equal(core.stockOf(B1, 'P1').onHand, 98);
  await rejects(adj({ reason: '' }), 'reason-required'); await rejects(adj({ reason: 'x' }), 'reason-required');
  await rejects(adj({ approvedBy: undefined }), 'approver-required'); await rejects(adj({ approvedBy: 'clerk' }), 'approver-required'); await rejects(adj({ approvedBy: 'a b' }), 'approver-required');
  await rejects(adj({ actor: undefined }), 'actor-invalid');
  await rejects(adj({ delta: 0 }), 'quantity-invalid'); await rejects(adj({ delta: 1.5 }), 'quantity-invalid'); await rejects(adj({ delta: '2' }), 'quantity-invalid'); await rejects(adj({ delta: 2e9 }), 'quantity-invalid');
  await rejects(adj({ delta: -99 }), 'insufficient-stock'); assert.equal(core.stockOf(B1, 'P1').onHand, 98, 'a refused adjustment changes nothing');
  await rejects(adj({ lot: 'NOPE' }), 'lot-unknown'); await rejects(adj({ productId: 'P9' }), 'lot-unknown');
  assert.equal((await adj({ delta: 5 })).onHand, 103);
  const same = { key: 'adj-fixed-1', productId: 'P1', lot: 'L1', delta: -3, reason: 'breakage found', approvedBy: 'boss', actor: 'clerk' };
  assert.equal((await core.adjust(B1, same)).onHand, 100); assert.equal((await core.adjust(B1, same)).replay, true); assert.equal(core.stockOf(B1, 'P1').onHand, 100);
  await rejects(core.adjust(B1, { ...same, delta: -4 }), 'idempotency-conflict'); await rejects(core.adjust(B2, same), 'idempotency-conflict');
  const row = db.prepare('SELECT reason, approved_by AS approvedBy, actor FROM stock_adjustment ORDER BY id DESC LIMIT 1').get();
  assert.deepEqual({ ...row }, { reason: 'breakage found', approvedBy: 'boss', actor: 'clerk' });
  assert.deepEqual(core.reconcile(B1), []);
  await rejects(core.adjust(OTHER, { ...same, key: 'adj-other-1' }), 'lot-unknown'); // another tenant cannot touch this stock
  const only1 = fresh(); await stock(only1.core, B1);   // lot L1 exists for this tenant, but only branch 1 holds it
  await rejects(only1.core.adjust(B2, { ...same, key: 'adj-b2-1', delta: 5 }), 'lot-unknown'); // an adjustment never creates stock in a branch that has none
  assert.equal(only1.core.stockOf(B2, 'P1').onHand, 0);
});

await t('FIX 6b: expired stock leaves only through an approved write-off, and the write-off keeps the ledger reconciled', async () => {
  const db = new DatabaseSync(':memory:'); let clock = new Date('2026-11-11T10:00:00Z');
  const core = createStockCore(db, { now: () => clock }); core.install();
  await core.receiveGoods(B1, { key: 'rcv-old', lines: [{ productId: 'P1', lot: 'OLD', expiry: day(5), qtyBase: 10 }, { productId: 'P1', lot: 'NEW', expiry: day(300), qtyBase: 4 }] });
  clock = new Date(NOW.getTime() + 10 * 864e5);
  assert.deepEqual(core.stockOf(B1, 'P1'), { productId: 'P1', onHand: 14, available: 4 });
  await core.adjust(B1, { key: 'wo-1', productId: 'P1', lot: 'OLD', delta: -10, reason: 'expired write-off', approvedBy: 'boss', actor: 'clerk' });
  assert.deepEqual(core.stockOf(B1, 'P1'), { productId: 'P1', onHand: 4, available: 4 }); assert.deepEqual(core.reconcile(B1), []);
});

await t('FIX 7: expiry alerts list lots with stock that expire soon, only in the caller\'s tenant and branch', async () => {
  const { core } = fresh();
  await core.receiveGoods(B1, { key: 'rcv-a', lines: [{ productId: 'P1', lot: 'SOON', expiry: day(20), qtyBase: 5 }, { productId: 'P1', lot: 'LATER', expiry: day(200), qtyBase: 5 }, { productId: 'P2', lot: 'S2', expiry: day(0), qtyBase: 1 }] });
  await core.receiveGoods(B2, { key: 'rcv-b', lines: [{ productId: 'P1', lot: 'B2SOON', expiry: day(10), qtyBase: 9 }] });
  await core.receiveGoods(OTHER, { key: 'rcv-c', lines: [{ productId: 'P1', lot: 'USOON', expiry: day(10), qtyBase: 9 }] });
  assert.deepEqual(core.expiring(B1, 30), [{ productId: 'P2', lot: 'S2', expiry: day(0), onHand: 1 }, { productId: 'P1', lot: 'SOON', expiry: day(20), onHand: 5 }]);
  assert.deepEqual(core.expiring(B1, 400).map(x => x.lot), ['S2', 'SOON', 'LATER']);
  assert.deepEqual(core.expiring(B2, 30).map(x => x.lot), ['B2SOON']);
  await core.sell(B1, sale('s-all', 'S-ALL', 5, [{ method: 'cash', amountCents: 5 }], 5)); // FEFO takes SOON first
  assert.deepEqual(core.expiring(B1, 30).map(x => x.lot), ['S2'], 'an emptied lot is not listed');
  assert.deepEqual(core.expiring(B1, -1), []); assert.deepEqual(core.expiring(B1, 1.5), []); assert.deepEqual(core.expiring(B1, 'x'), []);
  rejectsSync(() => core.expiring({ tenantId: 'a:b', branchId: 'x' }, 5), 'scope-invalid');
});

console.log(`PASS INV-01 review-fix checks: ${n} cases`);
