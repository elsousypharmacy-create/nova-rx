import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createOutbox, createMockEndpoint } = createRequire(import.meta.url)('../../offline-outbox.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let T = 1000; const clock = { now: () => T, baseMs: 1000, capMs: 8000 };
const inv = (id, lines) => ({ id, number: id, total: 0, lines });
const L = (code, qty, price, lot) => Object.assign({ code, qty, price }, lot ? { lot } : {});
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('enqueue is idempotent by key and persists across reload', () => {
  const s = mem(), o = createOutbox(s, 'k', clock);
  o.enqueue(inv('A', [L('x', 1, 5)])); o.enqueue(inv('A', [L('x', 9, 5)]));
  assert.equal(o.all().length, 1); assert.equal(o.all()[0].payload.lines[0].qty, 1);
  assert.equal(createOutbox(s, 'k', clock).pending().length, 1);
});
await t('rejects bad input and corrupt storage without overwriting', () => {
  const s = mem(), o = createOutbox(s, 'k', clock);
  assert.throws(() => o.enqueue(inv('', [L('x', 1, 1)])), { code: 'missing-key' });
  assert.throws(() => o.enqueue(inv('B', [])), { code: 'no-lines' });
  assert.throws(() => o.enqueue(inv('B', [L('x', 0, 1)])), { code: 'bad-qty' });
  assert.throws(() => o.enqueue(inv('B', [L('x', 1, -1)])), { code: 'bad-price' });
  s.setItem('k', '{oops'); assert.throws(() => o.enqueue(inv('C', [L('x', 1, 1)])), { code: 'outbox-corrupt' });
  assert.equal(s.raw.k, '{oops');
});
await t('storage write failure throws and leaves the queue unchanged', () => {
  const s = mem(), o = createOutbox(s, 'k', clock); o.enqueue(inv('A', [L('x', 1, 5)]));
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => o.enqueue(inv('B', [L('x', 1, 5)])), { code: 'outbox-write-failed' });
  assert.equal(o.all().length, 1);
});
await t('success marks synced and decrements once', async () => {
  const o = createOutbox(mem(), 'k', clock), ep = createMockEndpoint({ x: { qty: 3, price: 5 } });
  o.enqueue(inv('A', [L('x', 2, 5)]));
  assert.deepEqual(await o.sync(ep), { skipped: false, synced: 1, review: 0, retry: 0 });
  assert.equal(o.get('A').status, 'synced'); assert.equal(ep.balance('x'), 1);
  await o.sync(ep); assert.equal(ep.calls(), 1);
});
await t('network failure backs off exponentially, capped, and never drops', async () => {
  T = 1000; const o = createOutbox(mem(), 'k', clock), ep = createMockEndpoint({ x: { qty: 9, price: 5 } });
  o.enqueue(inv('A', [L('x', 1, 5)])); ep.failNext(10);
  const waits = [];
  for (let i = 0; i < 6; i++) { await o.sync(ep); const e = o.get('A'); waits.push(e.nextAt - T); assert.equal(e.status, 'pending'); T = e.nextAt; }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(o.get('A').lastError, 'network-down'); assert.equal(o.get('A').attempts, 6);
  const c = ep.calls(); T = o.get('A').nextAt - 1; await o.sync(ep); assert.equal(ep.calls(), c, 'not due yet: no call');
});
await t('lost response then retry does not sell twice', async () => {
  T = 1000; const o = createOutbox(mem(), 'k', clock), ep = createMockEndpoint({ x: { qty: 1, price: 5 } });
  o.enqueue(inv('A', [L('x', 1, 5)])); ep.dropResponseNext(1);
  await o.sync(ep); assert.equal(o.get('A').status, 'pending'); assert.equal(ep.balance('x'), 0);
  T = o.get('A').nextAt; await o.sync(ep);
  assert.equal(o.get('A').status, 'synced'); assert.equal(ep.balance('x'), 0);
});
await t('last unit sold on two devices: second goes to review, invoice kept, balance never negative', async () => {
  const ep = createMockEndpoint({ x: { qty: 1, price: 5 } });
  const d1 = createOutbox(mem(), 'k', clock), d2 = createOutbox(mem(), 'k', clock);
  d1.enqueue(inv('D1-1', [L('x', 1, 5)])); d2.enqueue(inv('D2-1', [L('x', 1, 5)]));
  await d1.sync(ep); const r = await d2.sync(ep);
  assert.equal(d1.get('D1-1').status, 'synced'); assert.equal(r.review, 1);
  const e = d2.get('D2-1'); assert.equal(e.status, 'review'); assert.equal(e.conflicts[0].type, 'balance');
  assert.equal(e.payload.lines[0].qty, 1); assert.equal(ep.balance('x'), 0);
  await d2.sync(ep); assert.equal(ep.calls(), 2, 'review entries are not retried');
});
await t('price and lot conflicts go to review; a multi-line sale is all-or-nothing', async () => {
  const o = createOutbox(mem(), 'k', clock), ep = createMockEndpoint({ x: { qty: 5, price: 6 }, y: { qty: 5, price: 2, lots: { L1: 1 } } });
  o.enqueue(inv('P', [L('x', 1, 5), L('y', 1, 2)]));
  o.enqueue(inv('Q', [L('y', 2, 2, 'L1')]));
  await o.sync(ep);
  assert.deepEqual(o.get('P').conflicts.map(c => c.type), ['price']);
  assert.deepEqual(o.get('Q').conflicts.map(c => c.type), ['lot']);
  assert.equal(ep.balance('x'), 5); assert.equal(ep.balance('y'), 5);
  assert.equal(o.needsReview().length, 2);
});
await t('resolve: resubmit re-queues with same key; keep-local closes but keeps the invoice', async () => {
  const o = createOutbox(mem(), 'k', clock), ep = createMockEndpoint({ x: { qty: 5, price: 6 } });
  o.enqueue(inv('P', [L('x', 1, 5)])); o.enqueue(inv('R', [L('x', 1, 5)])); await o.sync(ep);
  assert.throws(() => o.resolve('P', { action: 'resubmit' }), { code: 'missing-reviewer' });
  assert.throws(() => o.resolve('P', { action: 'delete', by: 'm' }), { code: 'bad-action' });
  assert.throws(() => o.resolve('nope', { action: 'resubmit', by: 'm' }), { code: 'not-found' });
  o.resolve('R', { action: 'keep-local', by: 'manager', note: 'price accepted' });
  assert.equal(o.get('R').status, 'resolved'); assert.equal(o.get('R').payload.lines[0].qty, 1);
  assert.throws(() => o.resolve('R', { action: 'resubmit', by: 'm' }), { code: 'not-in-review' });
  o.resolve('P', { action: 'resubmit', by: 'manager' }); assert.equal(o.get('P').status, 'pending');
  assert.equal(o.all().length, 2, 'nothing deleted');
});
await t('concurrent sync is a no-op; malformed response is retried, not synced', async () => {
  T = 1000; const o = createOutbox(mem(), 'k', clock);
  o.enqueue(inv('A', [L('x', 1, 5)]));
  let calls = 0; const ep = { send: async () => { calls++; return { weird: 1 }; } };
  const [a, b] = await Promise.all([o.sync(ep), o.sync(ep)]);
  assert.equal(calls, 1); assert.ok(a.skipped || b.skipped);
  assert.equal(o.get('A').status, 'pending'); assert.equal(o.get('A').lastError, 'bad-response');
  const bad = { send: async () => ({ conflicts: [{ type: 'nonsense' }] }) }; T = o.get('A').nextAt; await o.sync(bad);
  assert.equal(o.get('A').status, 'pending');
});
console.log(n + ' passed');
