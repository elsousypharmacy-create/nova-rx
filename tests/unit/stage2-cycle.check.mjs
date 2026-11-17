// S2-07 Stage 2 software gate: receive -> cash sale -> credit sale -> partial return -> collection -> shift close on device A;
// after sync, device B matches A on stock, sales, credit balance and shift close through ONE real backend (in-memory D1).
// Flag OFF device: sells locally with zero fetches. Fake data only, no network. Run: node tests/unit/stage2-cycle.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
import { stockOnHand } from '../../backend/src/sales/service.js';

const require = createRequire(import.meta.url);
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');
const { createBackendClient } = require('../../backend-client.js');
const { create: createPosWire, createScheduler } = require('../../pos-sync-wire.js');
const { createCreditLedger } = require('../../credit-ledger.js');
const { create: createCreditSync } = require('../../credit-sync-wire.js');
const { create: createReceiptSync } = require('../../receipt-sync-wire.js');
const { createStore } = require('../../purchase-orders.js');
const { create: createShiftSync, newClosingId } = require('../../shift-sync-wire.js');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const mk = (sql, a = []) => ({
  bind: (...x) => mk(sql, x),
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  get sql() { return sql; },
  get a() { return a; }
});
const D1 = {
  prepare: (s) => mk(s),
  async batch(list) {
    db.exec('BEGIN');
    try {
      for (const s of list) db.prepare(s.sql).run(...s.a);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
};
const kvm = new Map();
const KV = {
  async get(k) { return kvm.has(k) ? kvm.get(k) : null; },
  async put(k, v) { kvm.set(k, v); },
  async delete(k) { kvm.delete(k); }
};
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1', NOVA_TENANT_ID: 'ten-a' };
const A_ten = await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const sc = { tenantId: 'ten-a', branchId: A_ten.branchIds[0] };

const serverFetch = async (url, init = {}) => {
  const u = new URL(url);
  const res = await handle(new Request('https://x.test' + u.pathname + u.search, {
    method: init.method || 'GET',
    headers: init.headers,
    body: init.body
  }), env);
  return res;
};

function device() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
  const outbox = createOutbox(storage, 'nova.outbox', { now: () => Date.now(), baseMs: 1, capMs: 1 });
  const ledger = createLedger(storage, 'nova.stock.ledger');
  const sales = [];
  const hasSale = (id) => sales.some((s) => s.id === id);
  const addSale = (rec) => { sales.push(rec); return true; };
  let calls = 0;
  const client = createBackendClient({
    storage,
    fetch: (u, i) => { calls++; return serverFetch(u, i); },
    outbox,
    getToken: () => tok
  });
  client.setUrl('https://api.test');
  client.setEnabled(true);
  const credit = createCreditLedger(storage, 'nova.credit');
  const creditSync = createCreditSync({ storage, outbox, ledger: credit });
  const receiptSync = createReceiptSync({ outbox, storage, ledger });
  const shiftSync = createShiftSync({ storage, outbox });
  const wire = createPosWire({ outbox, ledger, storage, hasSale, addSale });
  const sched = createScheduler({
    client,
    wire,
    storage,
    extras: () => [creditSync, receiptSync, shiftSync],
    getSale: (id) => sales.find((s) => s.id === id)
  });
  return {
    storage,
    outbox,
    ledger,
    sales,
    client,
    credit,
    creditSync,
    receiptSync,
    shiftSync,
    wire,
    sched,
    get calls() { return calls; }
  };
}

const devA = device();
const devB = device();

// 1) A receives a GRN for code 'P1'
const poStore = createStore(devA.storage, devA.ledger);
const po = poStore.create({ supplier: 'Sup1', lines: [{ code: 'P1', name: 'Prod 1', qty: 10, cost: 4 }] });
poStore.send(po.id, { confirmed: true });
poStore.accept(po.id, { confirmed: true });
const grn = { ref: 'GRN-1', lines: [{ code: 'P1', lot: 'L1', expiry: '2030-01-01', qty: 10, cost: 4 }] };
const r = poStore.receive(po.id, grn, { confirmed: true });
devA.receiptSync.afterReceive(r.po, grn);

// 2) A sells cash sale s1: 2 x P1 at 10 (total 20)
const s1 = {
  id: 's1',
  number: 'INV-1',
  at: '2026-04-01T10:00:00Z',
  total: 20,
  payment: 'cash',
  lines: [{ name: 'Prod 1', barcode: 'P1', unit: 'box', unitFactor: 1, price: 10, qty: 2, discount: 0 }]
};
devA.sales.push(s1);
devA.wire.afterSale(s1);

// 3) A sells credit sale s2: 1 x P1 at 10, payment 'credit', customerId 'c1'
const s2 = {
  id: 's2',
  number: 'INV-2',
  at: '2026-04-01T10:05:00Z',
  total: 10,
  payment: 'credit',
  customerId: 'c1',
  lines: [{ name: 'Prod 1', barcode: 'P1', unit: 'box', unitFactor: 1, price: 10, qty: 1, discount: 0 }]
};
devA.sales.push(s2);
devA.wire.afterSale(s2);
devA.credit.charge({ id: 's2', customerId: 'c1', amount: 10 });

// 4) A returns 1 of s1
devA.wire.afterReturn(s1, { id: 'r1', saleId: 's1', lines: [{ idx: 0, qty: 1 }] });

// 5) A collects 4 from c1
devA.credit.collect({ id: 'k1', customerId: 'c1', amount: 4 });

// 6) A closes the shift
const nowMs = Date.now();
const closing = {
  id: newClosingId(nowMs),
  at: nowMs,
  period: 'day',
  periodLabel: 'اليوم',
  float: 100,
  expected: 114,
  counted: 114,
  diff: 0,
  cashier: 'a',
  note: ''
};
devA.storage.setItem('nova-rx-shift-closings-v1', JSON.stringify([closing]));

// 7) Sync A twice, then B twice
await devA.sched.tick();
await devA.sched.tick();
await devB.sched.tick();
await devB.sched.tick();

// ASSERTIONS
assert.equal(await stockOnHand(env, sc, 'P1'), 8);

const unsynced = devA.outbox.all().filter((e) => e.status !== 'synced');
assert.equal(unsynced.length, 0, 'Unsynced entries: ' + JSON.stringify(devA.outbox.all()));

assert.equal(devB.sales.length, 2);
assert.deepEqual(devB.sales.map((s) => s.id).sort(), ['s1', 's2']);
assert.ok(devB.sales.every((s) => s.source === 'SYNC'));

assert.equal(devB.ledger.onHand('P1'), 8);
assert.equal(devA.credit.balance('c1'), 6);
assert.equal(devB.credit.balance('c1'), 6);

const closingsA = JSON.parse(devA.storage.getItem('nova-rx-shift-closings-v1') || '[]');
const closingsB = JSON.parse(devB.storage.getItem('nova-rx-shift-closings-v1') || '[]');
assert.deepEqual(closingsB, closingsA);

const retRows = db.prepare('SELECT COUNT(*) AS c FROM sale_returns').get();
assert.equal(Number(retRows.c), 1);
const sessRows = db.prepare('SELECT COUNT(*) AS c FROM cashier_sessions').get();
assert.equal(Number(sessRows.c), 1);

// 8) FLAG OFF: third device C
const devC = device();
devC.client.setEnabled(false);
const s3 = {
  id: 's3',
  number: 'INV-3',
  at: '2026-04-01T11:00:00Z',
  total: 10,
  payment: 'cash',
  lines: [{ name: 'Prod 1', barcode: 'P1', unit: 'box', unitFactor: 1, price: 10, qty: 1, discount: 0 }]
};
devC.sales.push(s3);
devC.wire.afterSale(s3);
assert.equal(devC.outbox.all().length, 1);
const tickRes = await devC.sched.tick();
assert.deepEqual(tickRes, { skipped: true });
assert.equal(devC.calls, 0);

console.log('stage2-cycle OK');
