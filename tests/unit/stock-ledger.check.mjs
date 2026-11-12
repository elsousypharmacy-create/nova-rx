import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../../stock-ledger.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };
const code = f => { try { f(); } catch (e) { return e.code; } return null; };

const st = mem(); const led = L.createLedger(st, 'k', () => '2026-11-12T10:00:00Z');
led.append({ kind: 'receive', code: 'A', qty: 10, ref: 'PO-1' });
led.append({ kind: 'sale', code: 'A', qty: 3, ref: 'INV-1' });
led.append({ kind: 'return', code: 'A', qty: 1, ref: 'RET-1' });
led.append({ kind: 'adjustment', code: 'A', qty: -2, ref: 'count' });
assert.equal(led.onHand('A'), 6, '10-3+1-2');
assert.equal(led.onHand('Z'), 0);
assert.deepEqual(led.movements('A').map(r => r.seq), [1, 2, 3, 4]);
assert.equal(led.movements('A')[1].delta, -3);
assert.equal(led.movements('A')[1].ref, 'INV-1');

// validation: nothing written on rejection
assert.equal(code(() => led.append({ kind: 'sale', code: 'A', qty: 1, ref: '' })), 'missing-ref');
assert.equal(code(() => led.append({ kind: 'sale', code: 'A', qty: -1, ref: 'X' })), 'bad-qty');
assert.equal(code(() => led.append({ kind: 'sale', code: 'A', qty: 1.5, ref: 'X' })), 'bad-qty');
assert.equal(code(() => led.append({ kind: 'adjustment', code: 'A', qty: 0, ref: 'X' })), 'bad-qty');
assert.equal(code(() => led.append({ kind: 'steal', code: 'A', qty: 1, ref: 'X' })), 'bad-kind');
assert.equal(code(() => led.append({ kind: 'sale', code: '', qty: 1, ref: 'X' })), 'bad-code');
assert.equal(code(() => led.append({ kind: 'sale', code: 'A', qty: 3, ref: 'INV-1' })), 'duplicate-movement');
assert.equal(led.movements().length, 4);

// append-only: no mutators; returned records are copies; state survives a reload
assert.equal(Object.keys(led).some(k => /update|delete|remove|clear|set/i.test(k)), false);
led.movements('A')[0].delta = 999; assert.equal(led.onHand('A'), 6);
assert.equal(L.createLedger(st, 'k').onHand('A'), 6);
assert.equal(code(() => L.createLedger(Object.assign(mem(), { getItem: () => '{bad' })).onHand('A')), 'ledger-corrupt');

// daily check
led.append({ kind: 'receive', code: 'B', qty: 5, ref: 'PO-2' });
let r = L.checkDaily(led, { A: 6, B: 5 }, '2026-11-12');
assert.equal(r.ok, true); assert.equal(r.day, '2026-11-12');
r = L.checkDaily(led, { A: 7, C: 2 });
assert.equal(r.ok, false);
assert.deepEqual(r.mismatches, [{ code: 'A', ledger: 6, balance: 7 }, { code: 'B', ledger: 5, balance: 0 }, { code: 'C', ledger: 0, balance: 2 }]);
console.log('stock-ledger: all checks passed');
