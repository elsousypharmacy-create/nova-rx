// N30: local prep list + read-back cart add (mock supplier; no network).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createPrepList, pushToCart, LABEL } = createRequire(import.meta.url)('../../purchases-prep.js');
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const mock = (o = {}) => { const cart = new Map(), calls = []; return { cart, calls,
  cartQty: async id => { if (o.readFail) throw new Error('x'); return cart.has(id) ? cart.get(id) : null; },
  add: async (id, q) => { calls.push(id); if (o.failFirst && calls.length === 1) throw new Error('net'); if (o.lose) return; cart.set(id, (cart.get(id) || 0) + q + (o.skew || 0)); } }; };
const yes = () => true;
// per-supplier grouping + label + validation
let l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); l.add('B', { id: 'p2', qty: 1 }); l.add('A', { id: 'p1', qty: 3 });
assert.match(LABEL, /LOCAL/); assert.deepEqual(l.suppliers(), ['A', 'B']); assert.equal(l.lines('A')[0].qty, 5);
for (const bad of [{ id: 'x', qty: 0 }, { id: 'x', qty: 1.5 }, { qty: 1 }]) assert.throws(() => l.add('A', bad), /bad-line/);
// confirmed only after matching read-back; declined adds nothing
let m = mock(), r = await pushToCart(l, 'A', m, () => false); assert.equal(r[0].status, 'declined'); assert.equal(m.calls.length, 0);
r = await pushToCart(l, 'A', m, yes); assert.deepEqual([r[0].status, r[0].readBack], ['confirmed', { id: 'p1', qty: 5 }]);
assert.deepEqual(await pushToCart(l, 'A', m, yes), []); assert.equal(m.calls.length, 1, 'confirmed line is not re-added');
// existing cart quantity is additive target
l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); m = mock(); m.cart.set('p1', 4);
assert.equal((await pushToCart(l, 'A', m, (x, e) => e === 6))[0].status, 'confirmed');
// read-back mismatch never claims success; retry re-reads and does NOT re-add
l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); m = mock({ skew: 1 });
assert.equal((await pushToCart(l, 'A', m, yes))[0].status, 'unconfirmed');
assert.equal((await pushToCart(l, 'A', m, yes))[0].status, 'unconfirmed'); assert.equal(m.calls.length, 1, 'no double add');
// lost write (no error, nothing in cart) is unconfirmed, not success
l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); m = mock({ lose: true });
assert.equal((await pushToCart(l, 'A', m, yes))[0].status, 'unconfirmed');
// partial failure: first add throws before effect -> failed, safe retry adds once, second line unaffected
l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); l.add('A', { id: 'p2', qty: 1 }); m = mock({ failFirst: true });
r = await pushToCart(l, 'A', m, yes); assert.deepEqual(r.map(x => x.status), ['failed', 'confirmed']);
r = await pushToCart(l, 'A', m, yes); assert.deepEqual(r.map(x => [x.id, x.status]), [['p1', 'confirmed']]); assert.equal(m.cart.get('p1'), 2);
// unreadable cart after write -> unconfirmed
l = createPrepList(store()); l.add('A', { id: 'p1', qty: 2 }); m = mock({ readFail: true });
assert.notEqual((await pushToCart(l, 'A', m, yes))[0].status, 'confirmed');
console.log('purchases-prep: all checks passed');
