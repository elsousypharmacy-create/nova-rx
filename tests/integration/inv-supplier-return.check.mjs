// INV: return of received stock to a supplier (stock leaves by lot, expected credit from receipt cost, journal balanced).
// Synthetic data, in-memory SQLite, no network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStockCore, CoreError } from '../../worker/inventory/stock-core.js';

const NOW = new Date('2026-11-12T10:00:00Z');
const day = k => new Date(NOW.getTime() + k * 864e5).toISOString().slice(0, 10);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.ok(e instanceof CoreError, `typed error expected, got ${e?.constructor?.name}: ${e?.message}`); assert.equal(e.code, code); return e; } assert.fail('expected ' + code); };
const B1 = { tenantId: 'T', branchId: 'b1' }, B2 = { tenantId: 'T', branchId: 'b2' }, OTHER = { tenantId: 'U', branchId: 'b1' };
const fresh = () => { const db = new DatabaseSync(':memory:'); const core = createStockCore(db, { now: () => NOW }); core.install(); return { db, core }; };
const receive = (core, scope = B1, o = {}) => core.receiveGoods(scope, { key: o.key ?? `rcv-${scope.tenantId}-${scope.branchId}-${o.lot ?? 'L1'}`, lines: [{ productId: 'P1', lot: o.lot ?? 'L1', expiry: o.expiry ?? day(-30), qtyBase: o.qty ?? 100, costCents: o.cost ?? 10000 }] });
const ret = (over = {}) => ({ key: 'sr-1', supplierRef: 'S1', reason: 'expired stock', actor: 'ali', approvedBy: 'mona', lines: [{ productId: 'P1', lot: 'L1', qtyBase: 20 }], ...over });
const journal = db => db.prepare('SELECT je.ref_type AS ref, jl.account AS account, jl.debit_cents AS d, jl.credit_cents AS c FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id ORDER BY je.id, jl.id').all().map(r => ({ ...r }));
console.log('INV supplier-return checks');

await t('lotsOf lists received, returned, on hand, expiry and total receipt cost per lot (null cost when never costed)', async () => {
  const { core } = fresh(); await receive(core); await receive(core, B1, { lot: 'L2', expiry: day(90), qty: 10, cost: 0 });
  const lots = core.lotsOf(B1, 'P1');
  assert.deepEqual(lots.map(l => [l.lot, l.receivedBase, l.returnedBase, l.onHandBase, l.lineCostCents]), [['L1', 100, 0, 100, 10000], ['L2', 10, 0, 10, null]]);
  assert.deepEqual(core.lotsOf(B2, 'P1'), [], 'another branch holds nothing'); assert.deepEqual(core.lotsOf(OTHER, 'P1'), []);
});
await t('a return removes the lot stock, records who asked and who approved, credits the pro-rated receipt cost, and the journal balances', async () => {
  const { db, core } = fresh(); await receive(core);
  const r = await core.returnToSupplier(B1, ret());
  assert.equal(r.creditCents, 2000); assert.equal(r.returnedBase, 20); assert.equal(core.stockOf(B1, 'P1').onHand, 80);
  assert.deepEqual(journal(db).filter(j => j.ref === 'supplier_return'), [{ ref: 'supplier_return', account: 'payables', d: 2000, c: 0 }, { ref: 'supplier_return', account: 'inventory', d: 0, c: 2000 }]);
  const m = db.prepare("SELECT qty_delta d, kind k FROM stock_movement WHERE kind='supplier_return'").all().map(r => ({ ...r })); assert.deepEqual(m, [{ d: -20, k: 'supplier_return' }]);
  assert.deepEqual(core.reconcile(B1), []);
  assert.equal(core.lotsOf(B1, 'P1')[0].returnedBase, 20);
});
await t('credit across partial returns never exceeds the lot cost (1/3 + 1/3 + 1/3 of 1000 credits exactly 1000)', async () => {
  const { core } = fresh(); await receive(core, B1, { qty: 3, cost: 1000 });
  const c = [];
  for (const [i, q] of [1, 1, 1].entries()) c.push((await core.returnToSupplier(B1, ret({ key: `p${i}`, lines: [{ productId: 'P1', lot: 'L1', qtyBase: q }] }))).creditCents);
  assert.equal(c.reduce((a, b) => a + b, 0), 1000); assert.deepEqual(c, [333, 334, 333]);
  await rejects(core.returnToSupplier(B1, ret({ key: 'p3', lines: [{ productId: 'P1', lot: 'L1', qtyBase: 1 }] })), 'return-exceeds-received');
});
await t('a lot that was never costed returns stock with credit null and writes no journal entry', async () => {
  const { db, core } = fresh(); await receive(core, B1, { cost: 0 });
  const r = await core.returnToSupplier(B1, ret()); assert.equal(r.creditCents, null);
  assert.equal(journal(db).filter(j => j.ref === 'supplier_return').length, 0); assert.equal(core.stockOf(B1, 'P1').onHand, 80);
});
await t('cannot return more than the lot holds; sold-down stock counts', async () => {
  const { core } = fresh(); await receive(core, B1, { expiry: day(60) });
  await core.sell(B1, { key: 's1', number: 'N1', lines: [{ productId: 'P1', qtyBase: 90, lineTotalCents: 900 }], payments: [{ method: 'cash', amountCents: 900 }] });
  const e = await rejects(core.returnToSupplier(B1, ret()), 'insufficient-stock'); assert.equal(core.stockOf(B1, 'P1').onHand, 10);
  await core.returnToSupplier(B1, ret({ key: 'ok', lines: [{ productId: 'P1', lot: 'L1', qtyBase: 10 }] })); assert.equal(core.stockOf(B1, 'P1').onHand, 0);
});
await t('scope: another branch or tenant cannot return this branch lot (unknown lot, nothing changes)', async () => {
  const { core } = fresh(); await receive(core);
  await rejects(core.returnToSupplier(B2, ret()), 'lot-unknown'); await rejects(core.returnToSupplier(OTHER, ret()), 'lot-unknown');
  assert.equal(core.stockOf(B1, 'P1').onHand, 100);
});
await t('idempotent: same key and request replays; same key with another request or from another branch conflicts', async () => {
  const { core } = fresh(); await receive(core); await receive(core, B2);
  const a = await core.returnToSupplier(B1, ret()); const b = await core.returnToSupplier(B1, ret());
  assert.equal(b.replay, true); assert.equal(core.stockOf(B1, 'P1').onHand, 80); assert.equal(b.creditCents, a.creditCents);
  await rejects(core.returnToSupplier(B1, ret({ lines: [{ productId: 'P1', lot: 'L1', qtyBase: 21 }] })), 'idempotency-conflict');
  await rejects(core.returnToSupplier(B2, ret()), 'idempotency-conflict'); assert.equal(core.stockOf(B2, 'P1').onHand, 100);
});
await t('reason, two different people, supplier and quantities are required', async () => {
  const { core } = fresh(); await receive(core);
  await rejects(core.returnToSupplier(B1, ret({ reason: 'bad' })), 'reason-required');
  await rejects(core.returnToSupplier(B1, ret({ approvedBy: 'ali' })), 'approver-required');
  await rejects(core.returnToSupplier(B1, ret({ actor: '' })), 'actor-invalid');
  await rejects(core.returnToSupplier(B1, ret({ supplierRef: '' })), 'supplier-invalid');
  for (const q of [0, -1, 1.5, '3', 1e12]) await rejects(core.returnToSupplier(B1, ret({ lines: [{ productId: 'P1', lot: 'L1', qtyBase: q }] })), 'quantity-invalid');
  await rejects(core.returnToSupplier(B1, ret({ lines: [] })), 'return-invalid');
  assert.equal(core.stockOf(B1, 'P1').onHand, 100);
});
await t('atomic: if the second line fails nothing of the first is applied, and the same lot twice is summed', async () => {
  const { core } = fresh(); await receive(core); await receive(core, B1, { lot: 'L2', qty: 5, cost: 500 });
  await rejects(core.returnToSupplier(B1, ret({ lines: [{ productId: 'P1', lot: 'L1', qtyBase: 10 }, { productId: 'P1', lot: 'L2', qtyBase: 6 }] })), 'return-exceeds-received');
  assert.equal(core.stockOf(B1, 'P1').onHand, 105);
  await rejects(core.returnToSupplier(B1, ret({ key: 'sum', lines: [{ productId: 'P1', lot: 'L2', qtyBase: 3 }, { productId: 'P1', lot: 'L2', qtyBase: 3 }] })), 'return-exceeds-received');
  assert.equal((await core.returnToSupplier(B1, ret({ key: 'sum2', lines: [{ productId: 'P1', lot: 'L2', qtyBase: 2 }, { productId: 'P1', lot: 'L2', qtyBase: 3 }] }))).returnedBase, 5);
});
await t('expired stock leaves through a supplier return; sellable stock of other lots is untouched', async () => {
  const { core } = fresh(); await receive(core); await receive(core, B1, { lot: 'L2', expiry: day(90), qty: 7 });
  assert.equal(core.stockOf(B1, 'P1').available, 7);
  await core.returnToSupplier(B1, ret({ lines: [{ productId: 'P1', lot: 'L1', qtyBase: 100 }] }));
  assert.deepEqual(core.stockOf(B1, 'P1'), { productId: 'P1', onHand: 7, available: 7 });
});
await t('the store refuses a self-approved return even when written around the API', async () => {
  const { db, core } = fresh(); await receive(core);
  assert.throws(() => db.prepare("INSERT INTO supplier_return(tenant_id, branch_id, batch_id, qty, reason, supplier_ref, return_key, actor, approved_by) VALUES('T','b1',1,1,'xxxxx','S','k','a','a')").run());
});
await t('reconcile flags a supplier return written around the API (above received, or without its movement)', async () => {
  const { db, core } = fresh(); await receive(core); await core.returnToSupplier(B1, ret()); assert.deepEqual(core.reconcile(B1), []);
  db.prepare("INSERT INTO supplier_return(tenant_id, branch_id, batch_id, qty, reason, supplier_ref, return_key, actor, approved_by) VALUES('T','b1',1,500,'xxxxx','S','k2','a','b')").run();
  const v = core.reconcile(B1); assert.ok(v.some(x => /returned to suppliers 520 > received 100/.test(x)), v.join('|')); assert.ok(v.some(x => /supplier returns 520 != movements 20/.test(x)), v.join('|'));
});
console.log(`PASS inv supplier-return: ${n} cases`);
