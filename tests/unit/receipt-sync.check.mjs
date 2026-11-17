// S2-03: a confirmed GRN is queued once (base units, lot/expiry/cost), applied on the server (product + batch + receipt movement)
// and appended once to the other device's ledger. Run: node tests/unit/receipt-sync.check.mjs
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
const ReceiptSync = require('../../receipt-sync-wire.js');
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');
const { createStore } = require('../../purchase-orders.js');

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); }
  };
}

const sA = memStorage();
const sB = memStorage();

sA.setItem('nova-rx-packaging-v1', JSON.stringify({ p1: { stripsPerBox: 3, unitsPerStrip: 10 } }));

const ledgerA = createLedger(sA);
const ledgerB = createLedger(sB);
const outboxA = createOutbox(sA, 'nova.outbox');
const outboxB = createOutbox(sB, 'nova.outbox');
const wireA = ReceiptSync.create({ outbox: outboxA, storage: sA, ledger: ledgerA });
const wireB = ReceiptSync.create({ outbox: outboxB, storage: sB, ledger: ledgerB });

const store = createStore(sA, ledgerA);
const po = store.create({ supplier: 's', lines: [{ code: 'p1', qty: 2, cost: 60 }] });
store.send(po.id, { confirmed: true });
store.accept(po.id, { confirmed: true });

const grn = {
  ref: 'فاتورة 1',
  lines: [{ code: 'p1', lot: 'L1', expiry: '2030-01-01', qty: 2, cost: 60 }]
};
const r = store.receive(po.id, grn, { confirmed: true });
const ar1 = wireA.afterReceive(r.po, grn);
assert.equal(ar1.ok, true);

const allA = outboxA.all();
assert.equal(allA.length, 1);
const key = allA[0].key;
assert.ok(key.startsWith('rcv:'));
assert.match(key, /^[A-Za-z0-9_\-:.]{1,128}$/, 'key passes the server op-key rule even with an Arabic ref');
assert.deepEqual(allA[0].payload.lines[0], {
  code: 'p1',
  qty: 60,
  price: 2,
  lot: 'L1',
  expiry: '2030-01-01',
  unit: 'tablet',
  perBox: 30
});

wireA.afterReceive(r.po, grn);
assert.equal(outboxA.all().length, 1);

const change = {
  entity: 'stock_receipt',
  id: key,
  data: {
    receiptId: key,
    poId: po.id,
    ref: grn.ref,
    items: [
      {
        productId: 'p1',
        qty: 60,
        lot: 'L1',
        expiry: '2030-01-01',
        unitCostMinor: 200,
        unit: 'tablet',
        perBox: 30
      }
    ]
  }
};

const resB1 = wireB.applyChanges([change]);
assert.equal(resB1.applied, 1);
assert.equal(ledgerB.onHand('p1'), 60);

const resB2 = wireB.applyChanges([change]);
assert.equal(resB2.applied, 0);
assert.equal(resB2.skipped, 1);
assert.equal(ledgerB.onHand('p1'), 60);

const resA1 = wireA.applyChanges([change]);
assert.equal(resA1.applied, 0);
assert.equal(resA1.skipped, 1);
assert.equal(ledgerA.onHand('p1'), 2);

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
const D1 = { prepare: (s) => mk(s), async batch(list) { db.exec('BEGIN'); try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1', NOVA_TENANT_ID: 'ten-a' };
const A = await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
const sc = { tenantId: 'ten-a', branchId: A.branchIds[0] };
const push = async (ops, e = env) => (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops }) }), e)).json()).results;
const pull = async (cursor) => (await (await handle(new Request('https://x.test/api/v1/sync/pull?cursor=' + cursor, { headers: H }), env)).json());

const payloadP9 = {
  id: 'rcv:PO-1:abcdef01',
  op: 'receipt',
  poId: 'PO-1',
  ref: 'فاتورة 1',
  lines: [{ code: 'p9', qty: 60, price: 2, lot: 'L1', expiry: '2030-01-01', unit: 'tablet', perBox: 30 }]
};

const p1 = await push([{ key: payloadP9.id, kind: 'ledger', entity: 'stock_receipt', payload: payloadP9 }]);
assert.equal(p1[0].status, 'applied', JSON.stringify(p1[0]));
assert.equal(await stockOnHand(env, sc, 'p9'), 60);

const batches1 = db.prepare('SELECT qty_on_hand, batch_no FROM inventory_batches WHERE tenant_id = ? AND product_id = ?').all('ten-a', 'p9');
assert.equal(batches1.length, 1);
assert.equal(batches1[0].qty_on_hand, 60);
assert.equal(batches1[0].batch_no, 'L1');

const prodP9 = db.prepare('SELECT id FROM products WHERE tenant_id = ? AND id = ?').get('ten-a', 'p9');
assert.ok(prodP9);

const pReplay = await push([{ key: payloadP9.id, kind: 'ledger', entity: 'stock_receipt', payload: payloadP9 }]);
assert.equal(pReplay[0].status, 'applied');
assert.equal(pReplay[0].duplicate, true);
assert.equal(await stockOnHand(env, sc, 'p9'), 60);

const payloadP9b = {
  id: 'rcv:PO-1:abcdef02',
  op: 'receipt',
  poId: 'PO-1',
  ref: 'فاتورة 2',
  lines: [{ code: 'p9', qty: 6, price: 2, lot: 'L1', expiry: '2030-01-01', unit: 'tablet', perBox: 30 }]
};
const p2 = await push([{ key: payloadP9b.id, kind: 'ledger', entity: 'stock_receipt', payload: payloadP9b }]);
assert.equal(p2[0].status, 'applied');
const batches2 = db.prepare('SELECT qty_on_hand, batch_no FROM inventory_batches WHERE tenant_id = ? AND product_id = ?').all('ten-a', 'p9');
assert.equal(batches2.length, 1);
assert.equal(batches2[0].qty_on_hand, 66);

const payloadBad = {
  id: 'rcv:PO-1:bad00001',
  op: 'receipt',
  poId: 'PO-1',
  ref: 'bad',
  lines: [{ code: 'p9', qty: 0, price: 2, lot: 'L1', expiry: '2030-01-01', unit: 'tablet', perBox: 30 }]
};
const pBad = await push([{ key: payloadBad.id, kind: 'ledger', entity: 'stock_receipt', payload: payloadBad }]);
assert.equal(pBad[0].status, 'rejected');
assert.equal(pBad[0].code, 'SYNC_RECEIPT_INVALID');
assert.equal(await stockOnHand(env, sc, 'p9'), 66);

const pulled = await pull(0);
const rcvChanges = (pulled.changes || []).filter((c) => c.entity === 'stock_receipt');
assert.ok(rcvChanges.length >= 1);
assert.equal(rcvChanges[0].data.items[0].productId, 'p9');
assert.equal(rcvChanges[0].data.items[0].qty, 60);

const envFlagOff = { ...env, NOVA_SALES_WRITES: undefined };
const payloadOff = {
  id: 'rcv:PO-1:flagoff1',
  op: 'receipt',
  poId: 'PO-1',
  ref: 'off',
  lines: [{ code: 'p9', qty: 10, price: 2, lot: 'L1', expiry: '2030-01-01', unit: 'tablet', perBox: 30 }]
};
const pOff = await push([{ key: payloadOff.id, kind: 'ledger', entity: 'stock_receipt', payload: payloadOff }], envFlagOff);
assert.equal(pOff[0].status, 'applied');
assert.equal(await stockOnHand(env, sc, 'p9'), 66);

console.log('receipt-sync OK');
