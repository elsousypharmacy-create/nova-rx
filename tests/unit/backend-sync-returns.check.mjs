// S2-01 server: a POS return op is applied through returnSale in ONE batch with sync_ledger + change_feed + sync_ops; /sync/pull returns it.
// Fake data, node:sqlite (D1 emulation), no network. Run: node tests/unit/backend-sync-returns.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
import { recordStockMovement, stockOnHand } from '../../backend/src/sales/service.js';

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
const count = (t, w = '1=1') => db.prepare('SELECT COUNT(*) c FROM ' + t + ' WHERE ' + w).get().c;

const A = await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
assert.equal(A.ok, true);
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
const sc = { tenantId: 'ten-a', branchId: A.branchIds[0] };
db.prepare('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES(?,?,?,?,?)').run('p1', sc.tenantId, sc.branchId, 'S1', 'x');
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: 10 }, 'r1')).ok, true);

const push = async (ops) => (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops }) }), env)).json()).results;
const pull = async (cursor) => (await (await handle(new Request('https://x.test/api/v1/sync/pull?cursor=' + cursor, { headers: H }), env)).json());
const inv = (id, qty) => ({ key: id, payload: { id, number: id, lines: [{ code: 'p1', qty, price: 5 }] } });
const ret = (clientReturnId, saleInvoiceId, qty) => ({
  key: 'ret:' + clientReturnId,
  kind: 'ledger',
  entity: 'sale_return',
  payload: {
    id: 'ret:' + clientReturnId,
    op: 'return',
    clientReturnId,
    saleInvoiceId,
    lines: [{ code: 'p1', qty, price: 5 }]
  }
});

// 1) Return before its invoice synced -> conflict SYNC_SALE_NOT_SYNCED and no sync_ops row
{
  const [r0] = await push([ret('early-1', 'inv-missing', 1)]);
  assert.equal(r0.status, 'conflict');
  assert.equal(r0.code, 'SYNC_SALE_NOT_SYNCED');
  assert.equal(count('sync_ops', "op_key='ret:early-1'"), 0);
}

// 2) Invoice inv-1 (2 x p1 price 5) then return of 1 -> stock 8 -> 9, change_feed has a sale_return row with clientReturnId
const [invRes] = await push([inv('inv-1', 2)]);
assert.equal(invRes.status, 'applied');
assert.equal(await stockOnHand(env, sc, 'p1'), 8);

const [retRes] = await push([ret('r1', 'inv-1', 1)]);
assert.equal(retRes.status, 'applied', JSON.stringify(retRes));
assert.ok(retRes.returnId);
assert.equal(retRes.refundMinor, 500);
assert.equal(await stockOnHand(env, sc, 'p1'), 9);

const cfRow = db.prepare("SELECT entity_id, payload_json FROM change_feed WHERE tenant_id=? AND branch_id=? AND entity='sale_return'").get(sc.tenantId, sc.branchId);
assert.ok(cfRow);
assert.equal(cfRow.entity_id, retRes.returnId);
const cfPayload = JSON.parse(cfRow.payload_json);
assert.equal(cfPayload.clientReturnId, 'r1');
assert.equal(cfPayload.saleInvoiceId, 'inv-1');
assert.deepEqual(cfPayload.items, [{ productId: 'p1', qty: 1 }]);

// 3) Replay same return key -> duplicate, stock still 9
{
  const [repRes] = await push([ret('r1', 'inv-1', 1)]);
  assert.equal(repRes.status, 'applied');
  assert.equal(repRes.duplicate, true);
  assert.equal(repRes.returnId, retRes.returnId);
  assert.equal(await stockOnHand(env, sc, 'p1'), 9);
}

// 4) Return more than remaining (remaining is 1, try returning 2) -> rejected SYNC_RETURN_REJECTED, no return rows / stock / feed written
{
  const before = [count('sale_returns'), count('change_feed'), count('sync_ledger')];
  const [overRes] = await push([ret('r-over', 'inv-1', 2)]);
  assert.equal(overRes.status, 'rejected');
  assert.equal(overRes.code, 'SYNC_RETURN_REJECTED');
  assert.equal(await stockOnHand(env, sc, 'p1'), 9);
  assert.deepEqual([count('sale_returns'), count('change_feed'), count('sync_ledger')], before);
}

// 5) Pull /api/v1/sync/pull?cursor=0 includes the sale_return change
{
  const p = await pull(0);
  assert.equal(p.ok, true);
  const sr = p.changes.find((c) => c.entity === 'sale_return');
  assert.ok(sr);
  assert.equal(sr.id, retRes.returnId);
  assert.equal(sr.data.clientReturnId, 'r1');
  assert.equal(sr.data.saleInvoiceId, 'inv-1');
  assert.deepEqual(sr.data.items, [{ productId: 'p1', qty: 1 }]);
}

// 6) sales writes OFF -> the return op stays a plain ledger record (no return rows, no stock change)
{
  const off = { ...env, NOVA_SALES_WRITES: undefined };
  const r = (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops: [ret('r-off', 'inv-1', 1)] }) }), off)).json()).results[0];
  assert.equal(r.status, 'applied');
  assert.equal(await stockOnHand(env, sc, 'p1'), 9);
  assert.equal(count('sale_returns'), 1);
}

// 7) S2-05 credit movement: stored + change_feed in one batch, replay = duplicate, invalid move rejected
{
  const move = { id: 'ch-s9', type: 'charge', ref: 's9', customerId: 'c1', cents: 5000, at: 1, due: 2 };
  const op = { key: 'cr:ch-s9', kind: 'ledger', entity: 'credit_move', payload: { id: 'cr:ch-s9', op: 'credit', move } };
  const [c1] = await push([op]);
  assert.equal(c1.status, 'applied', JSON.stringify(c1));
  const row = db.prepare("SELECT entity_id, payload_json FROM change_feed WHERE entity='credit_move'").get();
  assert.equal(row.entity_id, 'ch-s9'); assert.deepEqual(JSON.parse(row.payload_json).move, move);
  const [c2] = await push([op]);
  assert.equal(c2.duplicate, true); assert.equal(count('change_feed', "entity='credit_move'"), 1);
  const [c3] = await push([{ key: 'cr:bad', kind: 'ledger', entity: 'credit_move', payload: { id: 'cr:bad', op: 'credit', move: { id: 'bad', type: 'charge', customerId: 'c1', cents: 1.5 } } }]);
  assert.deepEqual([c3.status, c3.code], ['rejected', 'SYNC_CREDIT_INVALID']);
  const p = await pull(0);
  assert.ok(p.changes.some((c) => c.entity === 'credit_move' && c.data.move.id === 'ch-s9'), 'pull returns the credit move');
}

console.log('backend-sync-returns OK');
