// S2-05: credit (آجل) movements sync between two devices through the outbox; imports are idempotent and never pushed back.
// Run: node tests/unit/credit-sync.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCreditLedger } = require('../../credit-ledger.js');
const { createOutbox } = require('../../offline-outbox.js');
const { create: createCreditSync } = require('../../credit-sync-wire.js');

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); }
  };
}

function makeDevice() {
  const storage = memStorage();
  const ledger = createCreditLedger(storage, 'nova.credit');
  const outbox = createOutbox(storage, 'nova.outbox');
  const sync = createCreditSync({ storage, outbox, ledger });
  return { storage, ledger, outbox, sync };
}

const A = makeDevice();
const B = makeDevice();

const t0 = 1700000000000;
const ch = A.ledger.charge({ id: 's1', customerId: 'c1', amount: 50, at: t0, due: t0 + 86400000 });
assert.equal(ch.id, 'ch-s1');
const co = A.ledger.collect({ id: 'col1', customerId: 'c1', amount: 20, at: t0 + 1000, method: 'cash' });
assert.equal(co.id, 'co-col1');

const f1 = A.sync.flush();
assert.equal(f1.queued, 2);

const pendingA = A.outbox.all();
assert.equal(pendingA.length, 2);
for (const item of pendingA) {
  assert.equal(item.payload.op, 'credit');
  assert.equal(typeof item.payload.move, 'object');
}

const changes = pendingA.map((item) => ({
  entity: 'credit_move',
  id: item.payload.move.id,
  data: { move: item.payload.move }
}));

const ap1 = B.sync.applyChanges(changes);
assert.equal(ap1.applied, 2);
assert.equal(ap1.skipped, 0);

assert.equal(B.ledger.balance('c1'), 30);
const asOf = t0 + 10 * 86400000;
assert.deepEqual(B.ledger.aging('c1', asOf), A.ledger.aging('c1', asOf));

const ap2 = B.sync.applyChanges(changes);
assert.equal(ap2.applied, 0);
assert.equal(ap2.skipped, 2);
assert.equal(B.ledger.balance('c1'), 30);

const fB = B.sync.flush();
assert.equal(fB.queued, 0);
assert.equal(B.outbox.all().length, 0);

const fA2 = A.sync.flush();
assert.equal(fA2.queued, 0);

const rv = A.ledger.reverse(co.id, 'خطأ');
assert.match(rv.id, /^rv-\d+-[a-z0-9]{6}$/);
assert.equal(A.ledger.reverse(co.id, 'خطأ').id, rv.id, 'reversal is idempotent');

const fA3 = A.sync.flush();
assert.equal(fA3.queued, 1);

const revChanges = A.outbox.all().slice(2).map((item) => ({
  entity: 'credit_move',
  id: item.payload.move.id,
  data: { move: item.payload.move }
}));

const ap3 = B.sync.applyChanges(revChanges);
assert.equal(ap3.applied, 1);
assert.equal(B.ledger.balance('c1'), 50);

const opA = A.ledger.openingBalance('c2', 10, { at: t0 });
const opB = B.ledger.openingBalance('c3', 15, { at: t0 });
assert.notEqual(opA.id, opB.id);
assert.match(opA.id, /^op-\d+-[a-z0-9]{6}$/);
assert.match(opB.id, /^op-\d+-[a-z0-9]{6}$/);

assert.throws(() => {
  A.outbox.enqueue({ id: 'x', op: 'credit' });
}, /bad-move/);

assert.throws(() => {
  A.outbox.enqueue({ id: 'inv-empty' });
}, /no-lines/);

console.log('credit-sync OK');
