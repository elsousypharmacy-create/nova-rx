// QA-01 risk test matrix: money, stock, permissions, concurrency, sync, returns, unknown/zero.
// Synthetic fixtures only (codes like DRUG-A, accounts like user-1) — no private data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const P = req('../../pricing-core.js'), L = req('../../stock-ledger.js'), O = req('../../offline-outbox.js'), A = req('../../auth-permissions.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
const code = f => { try { f(); } catch (e) { return e.code || e.message; } return null; };
const rows = [];
const t = async (area, name, fn) => { await fn(); rows.push(area); console.log('ok [' + area + '] ' + name); };
const RULE = { code: 'DRUG-A', retail: 1050, cost: 800, maxDiscountBps: 1000, effectiveFrom: '2026-01-01T00:00:00Z' };

// ---- money
await t('money', 'half-up rounding is integer-exact', () => {
  assert.equal(P.toPiastres('0.285'), 29); assert.equal(P.toPiastres('12.5'), 1250);
  assert.equal(P.fromPiastres(1005), '10.05');
  assert.equal(P.priceLine([RULE], 'DRUG-A', 3, { bps: 1000 }, '2026-06-01').net, 2835);
});
await t('money', 'discount over the limit is rejected (percent and fixed amount)', () => {
  assert.equal(code(() => P.priceLine([RULE], 'DRUG-A', 1, { bps: 1001 }, '2026-06-01')), 'discount-over-limit');
  assert.equal(code(() => P.priceLine([RULE], 'DRUG-A', 1, { amount: 106 }, '2026-06-01')), 'discount-over-limit');
  assert.equal(P.priceLine([RULE], 'DRUG-A', 1, { amount: 105 }, '2026-06-01').net, 945);
});
await t('money', 'non-integer / overflow amounts rejected', () => {
  assert.equal(code(() => P.fromPiastres(10.5)), 'bad-integer');
  assert.equal(code(() => P.toPiastres('abc')), 'bad-amount');
  assert.equal(code(() => P.priceLine([RULE], 'DRUG-A', 1.5, null, '2026-06-01')), 'bad-qty');
});
// ---- unknown / zero
await t('unknown-zero', 'unknown code, zero qty, zero price, no rule date', () => {
  assert.equal(code(() => P.priceLine([RULE], 'NOPE', 1, null, '2026-06-01')), 'no-rule');
  assert.equal(code(() => P.priceLine([RULE], 'DRUG-A', 0, null, '2026-06-01')), 'bad-qty');
  assert.equal(code(() => P.priceLine([RULE], 'DRUG-A', 1, null, '2025-12-31')), 'no-rule');
  assert.equal(code(() => P.createRulesStore(mem()).add({ ...RULE, retail: 0 })), 'retail-must-be-positive-integer');
});
await t('unknown-zero', 'ledger: unknown product is 0, zero/blank movement rejected', () => {
  const led = L.createLedger(mem(), 'k');
  assert.equal(led.onHand('UNKNOWN'), 0);
  assert.equal(code(() => led.append({ kind: 'receive', code: 'DRUG-A', qty: 0, ref: 'PO-1' })), 'bad-qty');
  assert.equal(code(() => led.append({ kind: 'receive', code: 'DRUG-A', qty: 1, ref: '' })), 'missing-ref');
  assert.equal(led.movements().length, 0);
});
// ---- stock
await t('stock', 'onHand derives from movements; replay is rejected; mismatch detected', () => {
  const led = L.createLedger(mem(), 'k');
  led.append({ kind: 'receive', code: 'DRUG-A', qty: 10, ref: 'PO-1' });
  led.append({ kind: 'sale', code: 'DRUG-A', qty: 4, ref: 'INV-1' });
  assert.equal(code(() => led.append({ kind: 'sale', code: 'DRUG-A', qty: 4, ref: 'INV-1' })), 'duplicate-movement');
  assert.equal(led.onHand('DRUG-A'), 6);
  assert.equal(L.checkDaily(led, { 'DRUG-A': 6 }).ok, true);
  assert.deepEqual(L.checkDaily(led, { 'DRUG-A': 7 }).mismatches, [{ code: 'DRUG-A', ledger: 6, balance: 7 }]);
});
await t('stock', 'sale cannot carry negative qty (no stock inflation via sale)', () => {
  const led = L.createLedger(mem(), 'k');
  assert.equal(code(() => led.append({ kind: 'sale', code: 'DRUG-A', qty: -5, ref: 'INV-9' })), 'bad-qty');
  assert.equal(led.onHand('DRUG-A'), 0);
});
// ---- returns
await t('returns', 'refunds sum exactly to the net paid; over-return rejected', () => {
  const sold = { qty: 3, net: 1000 };
  let r = P.refundLine(sold, 1); assert.equal(r.amount, 333);
  r = P.refundLine({ ...sold, returnedQty: 1, refunded: 333 }, 1); assert.equal(r.amount, 334, 'second');
  const r3 = P.refundLine({ ...sold, returnedQty: r.returnedQty, refunded: r.refunded }, 1);
  assert.equal(r3.refunded, 1000);
  assert.equal(code(() => P.refundLine({ ...sold, returnedQty: 3, refunded: 1000 }, 1)), 'return-exceeds-sold');
  assert.equal(code(() => P.refundLine(sold, 0)), 'bad-qty');
});
await t('returns', 'return uses price paid, not today\'s rule', () => {
  const line = P.priceLine([RULE], 'DRUG-A', 2, { bps: 1000 }, '2026-06-01');
  const later = [RULE, { ...RULE, retail: 5000, effectiveFrom: '2026-09-01T00:00:00Z' }];
  assert.equal(P.ruleAt(later, 'DRUG-A', '2026-10-01').retail, 5000);
  assert.equal(P.refundLine({ qty: 2, net: line.net }, 2).amount, line.net);
});
await t('returns', 'stock ledger return adds back exactly once', () => {
  const led = L.createLedger(mem(), 'k');
  led.append({ kind: 'receive', code: 'DRUG-A', qty: 5, ref: 'PO-1' });
  led.append({ kind: 'sale', code: 'DRUG-A', qty: 2, ref: 'INV-1' });
  led.append({ kind: 'return', code: 'DRUG-A', qty: 1, ref: 'RET-1' });
  assert.equal(code(() => led.append({ kind: 'return', code: 'DRUG-A', qty: 1, ref: 'RET-1' })), 'duplicate-movement');
  assert.equal(led.onHand('DRUG-A'), 4);
});
// ---- permissions
await t('permissions', 'deny by default; cashier cannot adjust stock/edit prices/export; denial is logged', () => {
  let me = { name: 'user-1', role: 'cashier' };
  const p = A.create({ storage: mem(), current: () => me, hasAccounts: () => true, now: () => 0 });
  assert.equal(p.can('sale.create'), true);
  for (const a of ['stock.adjust', 'prices.edit', 'data.export', 'accounts.manage']) assert.equal(p.require(a), false, a);
  assert.equal(p.denied().length, 4);
  assert.equal(p.can('made.up'), false);
  me = { name: 'user-2', role: 'hacker' }; assert.equal(p.can('sale.create'), false);
  me = null; assert.equal(p.can('sale.create'), false);
});
await t('permissions', 'only owner has every action; matrix is frozen', () => {
  assert.deepEqual([...A.MATRIX.owner], [...A.ACTIONS]);
  for (const r of A.ROLES) if (r !== 'owner' && r !== 'manager') assert.ok(A.MATRIX[r].length < A.ACTIONS.length, r);
  assert.ok(!A.MATRIX.delivery.includes('sale.create'));
  assert.throws(() => { 'use strict'; A.MATRIX.cashier.push('prices.edit'); });
});
// ---- sync + concurrency
const inv = (id, qty, price = 1050) => ({ id, number: id, total: qty * price, lines: [{ code: 'DRUG-A', qty, price }] });
await t('sync', 'lost response then replay does not double-decrement; nothing dropped', async () => {
  let now = 0; const ob = O.createOutbox(mem(), 'o', { now: () => now });
  const ep = O.createMockEndpoint({ 'DRUG-A': { qty: 5, price: 1050 } });
  ob.enqueue(inv('INV-1', 2)); ob.enqueue(inv('INV-1', 2));
  assert.equal(ob.all().length, 1);
  ep.dropResponseNext(1);
  assert.equal((await ob.sync(ep)).retry, 1);
  now += 10 * 60 * 1000;
  assert.equal((await ob.sync(ep)).synced, 1);
  assert.equal(ep.balance('DRUG-A'), 3);
  for (let i = 0; i < 5; i++) { ob.enqueue(inv('INV-N' + i, 1)); }
  ep.failNext(1000);
  for (let i = 0; i < 12; i++) { now += 3600001; await ob.sync(ep); }
  assert.equal(ob.all().length, 6, 'no invoice deleted after repeated failures');
});
await t('sync', 'price change on server goes to review, balance untouched', async () => {
  const ob = O.createOutbox(mem(), 'o'); const ep = O.createMockEndpoint({ 'DRUG-A': { qty: 5, price: 1100 } });
  ob.enqueue(inv('INV-2', 1));
  assert.equal((await ob.sync(ep)).review, 1);
  assert.equal(ep.balance('DRUG-A'), 5);
  assert.equal(code(() => ob.resolve('INV-2', { action: 'keep-local' })), 'missing-reviewer');
});
await t('sync', 'invalid invoices never enter the outbox (zero qty, no key, negative price)', () => {
  const ob = O.createOutbox(mem(), 'o');
  assert.equal(code(() => ob.enqueue(inv('X', 0))), 'bad-qty');
  assert.equal(code(() => ob.enqueue(inv('', 1))), 'missing-key');
  assert.equal(code(() => ob.enqueue(inv('Y', 1, -1))), 'bad-price');
  assert.equal(ob.all().length, 0);
});
await t('concurrency', 'two devices sell the last unit: exactly one wins, stock never negative', async () => {
  const ep = O.createMockEndpoint({ 'DRUG-A': { qty: 1, price: 1050 } });
  const a = O.createOutbox(mem(), 'a'), b = O.createOutbox(mem(), 'b');
  a.enqueue(inv('INV-A', 1)); b.enqueue(inv('INV-B', 1));
  const [ra, rb] = await Promise.all([a.sync(ep), b.sync(ep)]);
  assert.equal(ra.synced + rb.synced, 1); assert.equal(ra.review + rb.review, 1);
  assert.equal(ep.balance('DRUG-A'), 0);
});
await t('concurrency', 'overlapping sync() on one outbox is a no-op (no double send)', async () => {
  const ob = O.createOutbox(mem(), 'o'); const ep = O.createMockEndpoint({ 'DRUG-A': { qty: 5, price: 1050 } });
  ob.enqueue(inv('INV-3', 1));
  const [x, y] = await Promise.all([ob.sync(ep), ob.sync(ep)]);
  assert.equal(x.synced + y.synced, 1); assert.equal(ep.calls(), 1); assert.equal(ep.balance('DRUG-A'), 4);
});
await t('concurrency', 'one sale with two lines of one code cannot exceed stock', async () => {
  const ob = O.createOutbox(mem(), 'o'); const ep = O.createMockEndpoint({ 'DRUG-A': { qty: 3, price: 1050 } });
  ob.enqueue({ id: 'INV-4', number: 'INV-4', total: 0, lines: [{ code: 'DRUG-A', qty: 2, price: 1050 }, { code: 'DRUG-A', qty: 2, price: 1050 }] });
  assert.equal((await ob.sync(ep)).review, 1); assert.equal(ep.balance('DRUG-A'), 3);
});
await t('unknown-zero', 'unknown product on sync is a balance conflict; corrupt storage fails closed', async () => {
  const ob = O.createOutbox(mem(), 'o'); const ep = O.createMockEndpoint({});
  ob.enqueue(inv('INV-5', 1));
  await ob.sync(ep);
  assert.equal(ob.needsReview()[0].conflicts[0].type, 'balance');
  const bad = mem(); bad.setItem('o', '{oops');
  assert.equal(code(() => O.createOutbox(bad, 'o').all()), 'outbox-corrupt');
});

const need = ['money', 'stock', 'permissions', 'concurrency', 'sync', 'returns', 'unknown-zero'];
for (const a of need) assert.ok(rows.includes(a), 'matrix area missing: ' + a);
console.log('QA-01 risk matrix: ' + rows.length + ' checks across ' + need.length + ' areas pass');
