import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as B from '../../backend/src/bridge.js';

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../../backend/migrations/0011_legacy_bridge.sql', import.meta.url), 'utf8'));
const db = { prepare: (q) => ({ bind: (...a) => ({
  run: async () => sql.prepare(q).run(...a),
  first: async () => sql.prepare(q).get(...a),
}) }) };

// flag default OFF, zero network calls
assert.equal(B.bridgeEnabled(undefined), false);
assert.equal(B.bridgeEnabled({}), false);
assert.equal(B.bridgeEnabled({ NOVA_BRIDGE: '0' }), false);
let calls = 0;
assert.throws(() => B.getAdapter({ PHARMACY_BACKEND_URL: 'u', PHARMACY_BRIDGE_TOKEN: 't' }, 'req_1', () => { calls++; }), (e) => e.code === 'BRIDGE_DISABLED' && /[؀-ۿ]/.test(e.message_ar) && e.requestId === 'req_1');
assert.equal(calls, 0);
assert.throws(() => B.getAdapter({ NOVA_BRIDGE: '1' }, 'r'), (e) => e.code === 'BRIDGE_NOT_CONFIGURED');

// http adapter is GET-only with bearer token
let seen;
const ad = B.getAdapter({ NOVA_BRIDGE: '1', PHARMACY_BACKEND_URL: 'https://l.test/', PHARMACY_BRIDGE_TOKEN: 'tk' }, 'r',
  async (u, o) => { seen = { u, o }; return { ok: true, json: async () => ({ rows: [{ id: 1 }] }) }; });
assert.deepEqual(await ad.list('product'), [{ id: 1 }]);
assert.equal(seen.o.method, 'GET'); assert.equal(seen.o.headers.Authorization, 'Bearer tk');

// id map is idempotent
await B.mapId(db, 't1', 'product', 'L1', 'N1');
await B.mapId(db, 't1', 'product', 'L1', 'N1', 'h');
await B.mapId(db, 't1', 'product', 'L2', 'N2');
assert.equal(await B.lookupNovaId(db, 't1', 'product', 'L1'), 'N1');
assert.equal(await B.lookupNovaId(db, 't2', 'product', 'L1'), null);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM legacy_id_map').get().n, 2);

// reconciliation with mock adapter
const adapter = B.mockAdapter({ product: [
  { id: 'L1', name: 'A', price: 10, stock_qty: 5 },
  { id: 'L2', name: 'B', price: 7, stock_qty: 1 },
  { id: 'L3', name: 'C', price: 1, stock_qty: 1 },
] });
const rep = await B.reconcile({ adapter, db, tenant: 't1', entity: 'product', requestId: 'req_2', novaRows: [
  { id: 'N1', name: 'A', price: 10, stock_qty: 5, reorder_level: 99 },
  { id: 'N2', name: 'B', price: 8, stock_qty: 1 },
  { id: 'N9', name: 'Z' },
] });
assert.equal(rep.matched, 1);
assert.deepEqual(rep.conflicts, [{ legacyId: 'L2', novaId: 'N2', fields: ['price'] }]);
assert.deepEqual(rep.unmapped, ['L3']);
assert.deepEqual(rep.orphanedInNova, ['N9']);

// upstream failure => stable code
await assert.rejects(B.reconcile({ adapter: { list: async () => { throw new Error('x'); } }, db, tenant: 't1', entity: 'product', novaRows: [], requestId: 'req_3' }), (e) => e.code === 'BRIDGE_UPSTREAM_FAILED' && e.requestId === 'req_3');
console.log('backend-bridge: ok');
