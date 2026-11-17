// S2-06: shift closings sync between devices (single source 'nova-rx-shift-closings-v1') and land in cashier_sessions on the server.
// Run: node tests/unit/shift-sync.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';

const require = createRequire(import.meta.url);
const NovaShiftSync = require('../../shift-sync-wire.js');
const NovaOutbox = require('../../offline-outbox.js');

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  };
}

const id1 = NovaShiftSync.newClosingId(1700000000000);
const id2 = NovaShiftSync.newClosingId(1700000000000);
assert.notEqual(id1, id2);
assert.match(id1, /^SC\d+-[a-z0-9]{6}$/);
assert.match(id2, /^SC\d+-[a-z0-9]{6}$/);

const storageA = makeStorage();
const outboxA = NovaOutbox.createOutbox(storageA, 'nova.outbox');
const syncA = NovaShiftSync.create({ storage: storageA, outbox: outboxA });

const rec = {
  id: NovaShiftSync.newClosingId(1700000005000),
  at: 1700000005000,
  period: 'since_last',
  periodLabel: 'منذ آخر إقفال',
  float: 200,
  expected: 550.5,
  counted: 550.5,
  diff: 0,
  cashier: 'Ahmed',
  note: ''
};

storageA.setItem('nova-rx-shift-closings-v1', JSON.stringify([rec]));

const f1 = syncA.flush();
assert.equal(f1.queued, 1);
assert.equal(f1.errors, 0);
const allA = outboxA.all();
assert.equal(allA.length, 1);
assert.equal(allA[0].key, 'sh:' + rec.id);
assert.equal(allA[0].payload.op, 'shift');
assert.deepEqual(allA[0].payload.record, rec);

const f2 = syncA.flush();
assert.equal(f2.queued, 0);
assert.equal(outboxA.all().length, 1);

const storageB = makeStorage();
const outboxB = NovaOutbox.createOutbox(storageB, 'nova.outbox');
const syncB = NovaShiftSync.create({ storage: storageB, outbox: outboxB });

const ap1 = syncB.applyChanges([{ entity: 'shift_close', id: rec.id, data: { record: rec } }]);
assert.equal(ap1.applied, 1);
assert.equal(ap1.skipped, 0);
const listB1 = JSON.parse(storageB.getItem('nova-rx-shift-closings-v1'));
assert.deepEqual(listB1, [rec]);

const ap2 = syncB.applyChanges([{ entity: 'shift_close', id: rec.id, data: { record: rec } }]);
assert.equal(ap2.applied, 0);
assert.equal(ap2.skipped, 1);

const fb = syncB.flush();
assert.equal(fb.queued, 0);
assert.equal(outboxB.all().length, 0);

const olderRec = {
  id: NovaShiftSync.newClosingId(1700000001000),
  at: 1700000001000,
  period: 'today',
  periodLabel: 'اليوم',
  float: 100,
  expected: 300,
  counted: 295,
  diff: -5,
  cashier: 'Sara',
  note: 'short'
};
const apOlder = syncB.applyChanges([{ entity: 'shift_close', id: olderRec.id, data: { record: olderRec } }]);
assert.equal(apOlder.applied, 1);
const listB2 = JSON.parse(storageB.getItem('nova-rx-shift-closings-v1'));
assert.equal(listB2.length, 2);
assert.deepEqual(listB2[0], olderRec);
assert.deepEqual(listB2[1], rec);

assert.throws(() => {
  outboxB.enqueue({ id: 'x', op: 'shift' });
}, /bad-record/);

const invalidRec = {
  id: NovaShiftSync.newClosingId(1700000009000),
  at: 1700000009000,
  float: 100,
  expected: 200,
  counted: -1,
  diff: -201,
  note: 'invalid'
};
const apInvalid = syncB.applyChanges([{ entity: 'shift_close', id: invalidRec.id, data: { record: invalidRec } }]);
assert.equal(apInvalid.applied, 0);
assert.equal(apInvalid.skipped, 1);
const listB3 = JSON.parse(storageB.getItem('nova-rx-shift-closings-v1'));
assert.equal(listB3.length, 2);

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
await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
const push = async (ops) => (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops }) }), env)).json()).results;
const pull = async (cursor) => (await (await handle(new Request('https://x.test/api/v1/sync/pull?cursor=' + cursor, { headers: H }), env)).json());

const res1 = await push([{ key: 'sh:' + rec.id, kind: 'ledger', entity: 'shift_close', payload: allA[0].payload }]);
assert.equal(res1.length, 1);
assert.equal(res1[0].status, 'applied', JSON.stringify(res1[0]));

const csRows1 = db.prepare('SELECT * FROM cashier_sessions WHERE id = ?').all('cs:' + rec.id);
assert.equal(csRows1.length, 1);
assert.equal(csRows1[0].opening_float_minor, 20000);
assert.equal(csRows1[0].closing_counted_minor, 55050);
assert.equal(csRows1[0].status, 'closed');

const res2 = await push([{ key: 'sh:' + rec.id, kind: 'ledger', entity: 'shift_close', payload: allA[0].payload }]);
assert.equal(res2.length, 1);
assert.equal(res2[0].duplicate, true);
const csRows2 = db.prepare('SELECT * FROM cashier_sessions WHERE id = ?').all('cs:' + rec.id);
assert.equal(csRows2.length, 1);

const resInvalid = await push([{ key: 'sh:' + invalidRec.id, kind: 'ledger', entity: 'shift_close', payload: { id: 'sh:' + invalidRec.id, op: 'shift', record: invalidRec } }]);
assert.equal(resInvalid.length, 1);
assert.equal(resInvalid[0].status, 'rejected');
assert.equal(resInvalid[0].code, 'SYNC_SHIFT_INVALID');

const pulled = await pull(0);
const shiftChange = pulled.changes.find((c) => c.entity === 'shift_close' && c.id === rec.id);
assert.ok(shiftChange);
assert.deepEqual(shiftChange.data.record, rec);

console.log('shift-sync OK');
