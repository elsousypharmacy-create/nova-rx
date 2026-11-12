import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const L = req('../../stock-ledger.js'), C = req('../../stock-count.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const code = f => { try { f(); } catch (e) { return e.code; } return null; };
const setup = () => {
  const led = L.createLedger(mem(), 'l');
  led.append({ kind: 'receive', code: 'A', qty: 10, ref: 'PO-1' });
  led.append({ kind: 'receive', code: 'B', qty: 5, ref: 'PO-1' });
  led.append({ kind: 'receive', code: 'C', qty: 3, ref: 'PO-1' });
  return { led, st: mem(), cnt: C.createCounts(mem(), led, 'c', () => '2026-11-12T10:00:00Z') };
};

// partial count: blind view, differences, reasons, lock
let { led, cnt } = setup();
assert.equal(code(() => cnt.start({ scope: 'partial', codes: [] })), 'no-codes');
assert.equal(code(() => cnt.start({ scope: 'x' })), 'bad-scope');
const id = cnt.start({ scope: 'partial', codes: ['A', 'B'] });
assert.equal(code(() => cnt.start({ scope: 'full' })), 'session-already-open');
assert.deepEqual(cnt.view(id).lines, [{ code: 'A', counted: null }, { code: 'B', counted: null }]);
assert.equal(JSON.stringify(cnt.view(id)).includes('expected'), false, 'blind');
assert.equal(code(() => cnt.count(id, 'C', 1)), 'not-in-scope');
assert.equal(code(() => cnt.count(id, 'A', -1)), 'bad-qty');
assert.equal(code(() => cnt.count(id, 'A', 1.5)), 'bad-qty');
cnt.count(id, 'A', 8);
assert.equal(code(() => cnt.close(id, {})), 'uncounted');
cnt.count(id, 'B', 5);
assert.deepEqual(cnt.differences(id), [{ code: 'A', expected: 10, counted: 8, diff: -2 }]);
assert.equal(code(() => cnt.close(id, {})), 'missing-reason');
assert.equal(code(() => cnt.close(id, { A: '  ' })), 'missing-reason');
assert.equal(led.onHand('A'), 10, 'nothing written on rejection');
const rep = cnt.close(id, { A: 'broken box' });
assert.equal(rep.closed, true);
assert.equal(led.onHand('A'), 8); assert.equal(led.onHand('B'), 5); assert.equal(led.onHand('C'), 3);
const adj = led.movements('A').filter(m => m.kind === 'adjustment');
assert.equal(adj.length, 1); assert.match(adj[0].ref, /broken box/);
assert.equal(led.movements('B').filter(m => m.kind === 'adjustment').length, 0, 'no diff, no adjustment');
assert.equal(cnt.view(id).lines[0].expected, 10, 'closed session shows expected');
assert.equal(code(() => cnt.count(id, 'A', 9)), 'session-locked');
assert.equal(code(() => cnt.close(id, { A: 'again' })), 'session-locked');
assert.equal(led.onHand('A'), 8);
assert.equal(cnt.start({ scope: 'full' }), 'C2', 'new session allowed after close');

// full count: every ledger code, sales during the count are kept
({ led, cnt } = setup());
const f = cnt.start({ scope: 'full' });
assert.deepEqual(cnt.view(f).lines.map(l => l.code), ['A', 'B', 'C']);
led.append({ kind: 'sale', code: 'C', qty: 1, ref: 'INV-9' });          // sold while counting
['A', 'B'].forEach(c => cnt.count(f, c, c === 'A' ? 10 : 6));
cnt.count(f, 'C', 2);                                                    // shelf has 2 = ledger now 2
assert.equal(code(() => cnt.close(f, { B: 'found extra' })), 'missing-reason', 'C differs from the start snapshot');
cnt.close(f, { B: 'found extra', C: 'sold during count' });
assert.equal(led.onHand('B'), 6); assert.equal(led.onHand('C'), 2);
assert.equal(led.movements('C').filter(m => m.kind === 'adjustment').length, 0, 'ledger already equals the count');
assert.equal(cnt.report(f).lines.find(l => l.code === 'B').reason, 'found extra');

// persistence across reload
const st2 = mem(); const l2 = L.createLedger(mem(), 'l'); l2.append({ kind: 'receive', code: 'Z', qty: 4, ref: 'P' });
const c1 = C.createCounts(st2, l2, 'c'); const z = c1.start({ scope: 'full' }); c1.count(z, 'Z', 4);
assert.equal(C.createCounts(st2, l2, 'c').view(z).lines[0].counted, 4);
assert.equal(code(() => C.createCounts(Object.assign(mem(), { getItem: () => '{bad' }), l2).view('C1')), 'counts-corrupt');
console.log('stock-count: all checks passed');
