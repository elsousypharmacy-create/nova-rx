// S2-04: confirmed local purchase orders sync as snapshots to D1 (suppliers / purchase_orders / items) and show on a second
// device as read-only remote copies. No supplier call. Run: node tests/unit/po-sync.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';

const require = createRequire(import.meta.url);
const PoSync = require('../../po-sync-wire.js');
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');
const { createStore } = require('../../purchase-orders.js');

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

const sA = memStorage();
const sB = memStorage();
const outA = createOutbox(sA, 'nova.outbox');
const outB = createOutbox(sB, 'nova.outbox');
const storeA = createStore(sA, createLedger(sA));
const storeB = createStore(sB, createLedger(sB));
const wireA = PoSync.create({ storage: sA, outbox: outA });
const wireB = PoSync.create({ storage: sB, outbox: outB });

const po1 = storeA.create({ supplier: 'مخزن 1', lines: [{ code: 'p1', name: 'x', qty: 3, cost: 10 }] });
assert.equal(wireA.flush().queued, 0, 'a draft is not queued');

storeA.send(po1.id, { confirmed: true });
const f1 = wireA.flush();
assert.equal(f1.queued, 1);
assert.equal(wireA.flush().queued, 0);

storeA.create({ supplier: 'مسودة', lines: [{ code: 'p2', name: 'y', qty: 1, cost: 5 }] });
assert.equal(wireA.flush().queued, 0);

storeA.accept(po1.id, { confirmed: true });
const f2 = wireA.flush();
assert.equal(f2.queued, 1);

const listA = outA.all();
assert.equal(listA.length, 2);
const item1 = listA[0].payload;
const item2 = listA[1].payload;
assert.equal(item1.op, 'po');
assert.match(item1.key, /^po:[0-9a-f]{8}$/);
assert.equal(item1.po.state, 'sent');
assert.equal(item2.po.state, 'accepted');
assert.notEqual(item1.id, item2.id);
const key = item1.key;

const ap1 = wireB.applyChanges([{ entity: 'purchase_order', id: key, data: { key, po: item1.po } }]);
assert.equal(ap1.applied, 1);
const ap2 = wireB.applyChanges([{ entity: 'purchase_order', id: key, data: { key, po: item2.po } }]);
assert.equal(ap2.applied, 1);

let bOrders = JSON.parse(sB.getItem('nova.purchase.orders'));
assert.equal(bOrders.length, 1);
assert.equal(bOrders[0].state, 'accepted');
assert.equal(bOrders[0].remote, true);
assert.ok(bOrders[0].id.endsWith('@' + key.slice(3, 9)));

const apOld = wireB.applyChanges([{ entity: 'purchase_order', id: key, data: { key, po: item1.po } }]);
assert.equal(apOld.skipped, 1);
bOrders = JSON.parse(sB.getItem('nova.purchase.orders'));
assert.equal(bOrders[0].state, 'accepted');

const apOwn = wireA.applyChanges([{ entity: 'purchase_order', id: key, data: { key, po: item2.po } }]);
assert.equal(apOwn.skipped, 1);

const localB = storeB.create({ supplier: 'مورد ب', lines: [{ code: 'p9', name: 'z', qty: 2, cost: 4 }] });
assert.equal(localB.id, 'PO-2', 'local numbering continues after the remote copy');
bOrders = JSON.parse(sB.getItem('nova.purchase.orders'));
assert.equal(bOrders.length, 2);
assert.equal(wireB.flush().queued, 0, 'remote copies and drafts are never pushed');

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

const resPush = await push([
  { key: item1.id, kind: 'ledger', entity: 'purchase_order', payload: item1 },
  { key: item2.id, kind: 'ledger', entity: 'purchase_order', payload: item2 }
]);
assert.equal(resPush.length, 2);
assert.equal(resPush[0].status, 'applied', JSON.stringify(resPush[0]));
assert.equal(resPush[1].status, 'applied');

const poRow = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get('ten-a:' + key);
assert.ok(poRow);
assert.equal(poRow.status, 'sent');

const supCount = db.prepare('SELECT COUNT(*) AS c FROM suppliers WHERE tenant_id = ?').get('ten-a').c;
assert.equal(Number(supCount), 1);

const itemRows = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all('ten-a:' + key);
assert.equal(itemRows.length, 1);
assert.equal(Number(itemRows[0].qty), 3);
assert.equal(Number(itemRows[0].unit_cost_minor), 1000);

const replay = await push([{ key: item1.id, kind: 'ledger', entity: 'purchase_order', payload: item1 }]);
assert.equal(replay[0].duplicate, true);

const bad = await push([{
  key: 'po:deadbeef:99',
  kind: 'ledger',
  entity: 'purchase_order',
  payload: { id: 'po:deadbeef:99', op: 'po', key: 'po:deadbeef', po: { id: 'PO-9', supplier: 'x', state: 'sent', lines: [] } }
}]);
assert.equal(bad[0].status, 'rejected');
assert.equal(bad[0].code, 'SYNC_PO_INVALID');

const pulled = await pull(0);
const poChanges = (pulled.changes || []).filter((c) => c.entity === 'purchase_order');
assert.equal(poChanges.length, 2);
assert.equal(poChanges[0].data.key, key);
assert.equal(poChanges[1].data.key, key);

console.log('po-sync OK');
