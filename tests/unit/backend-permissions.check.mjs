import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ROLES, ACTIONS, MATRIX, decide, canAssignRole, requirePermission, permissionsEnabled, memoryDenialLog } from '../../backend/src/auth/permissions.js';

const require = createRequire(import.meta.url);
const local = require('../../auth-permissions.js');

// parity with the client matrix (client "store" == server "stock")
assert.deepEqual([...ACTIONS], [...local.ACTIONS]);
for (const r of local.ROLES) {
  const s = r === 'store' ? 'stock' : r;
  assert.deepEqual([...MATRIX[s]].sort(), [...local.MATRIX[r]].sort(), 'matrix parity ' + r);
}
assert.equal(ROLES.length, 7);

// per-role: every action allowed iff in matrix
for (const r of ROLES) for (const a of ACTIONS) assert.equal(decide(r, a).ok, MATRIX[r].includes(a), r + ' ' + a);
assert.equal(decide('cashier', 'prices.edit').ok, false);
assert.equal(decide('cashier', 'sale.create').ok, true);
assert.equal(decide('stock', 'stock.adjust').ok, true);
assert.equal(decide('store', 'purchases.manage').ok, true);
assert.equal(decide('accountant', 'sale.create').ok, false);
assert.equal(decide('delivery', 'delivery.update').ok, true);
assert.equal(decide('delivery', 'data.export').ok, false);
assert.equal(decide('owner', 'data.import').ok, true);
assert.equal(decide('pharmacist', 'prices.edit').ok, false);
// deny by default
assert.equal(decide('hacker', 'sale.create').why, 'unknown-role');
assert.equal(decide('__proto__', 'sale.create').ok, false);
assert.equal(decide('constructor', 'sale.create').ok, false);
assert.equal(decide(null, 'sale.create').why, 'signed-out');
assert.equal(decide('owner', 'nuke').why, 'unknown-action');

// escalation
assert.equal(canAssignRole('owner', 'owner').ok, true);
assert.equal(canAssignRole('owner', 'cashier').ok, true);
assert.equal(canAssignRole('manager', 'cashier').ok, true);
assert.equal(canAssignRole('manager', 'owner').why, 'escalation');
assert.equal(canAssignRole('manager', 'manager').why, 'escalation');
assert.equal(canAssignRole('pharmacist', 'cashier').why, 'role-denied');
assert.equal(canAssignRole('owner', 'god').why, 'bad-role');

// flag default OFF
assert.equal(permissionsEnabled({}), false);
assert.equal(permissionsEnabled(undefined), false);
assert.equal(permissionsEnabled({ NOVA_PERMISSIONS: '0' }), false);
assert.equal(permissionsEnabled({ NOVA_PERMISSIONS: '1' }), true);
const log = memoryDenialLog();
assert.equal(await requirePermission({ env: {}, session: null, action: 'prices.edit', requestId: 'req_1', log }), null);
assert.equal(log.entries.length, 0);

// middleware on
const env = { NOVA_PERMISSIONS: '1' };
const t = () => 1700000000000;
assert.equal(await requirePermission({ env, session: { role: 'cashier' }, action: 'sale.create', requestId: 'req_1', log, now: t }), null);
let d = await requirePermission({ env, session: { role: 'cashier', id: 'u1' }, action: 'prices.edit', requestId: 'req_2', log, now: t });
assert.equal(d.status, 403); assert.equal(d.code, 'PERMISSION_DENIED'); assert.equal(d.requestId, 'req_2'); assert.match(d.message_ar, /[؀-ۿ]/);
assert.deepEqual(log.entries[0], { at: new Date(t()).toISOString(), action: 'prices.edit', account: 'u1', role: 'cashier', why: 'role-denied', requestId: 'req_2' });
d = await requirePermission({ env, session: null, action: 'sale.create', requestId: 'req_3', log });
assert.equal(d.status, 401); assert.equal(d.code, 'AUTH_REQUIRED');
d = await requirePermission({ env, session: { role: 'manager' }, action: 'accounts.manage', target: 'owner', requestId: 'req_4', log });
assert.equal(d.status, 403); assert.equal(log.entries.at(-1).why, 'escalation');
assert.equal(await requirePermission({ env, session: { role: 'owner' }, action: 'accounts.manage', target: 'manager', requestId: 'req_5', log }), null);
assert.equal(log.entries.length, 3);
// log failure does not change the decision
d = await requirePermission({ env, session: { role: 'delivery' }, action: 'sale.create', requestId: 'req_6', log: { write() { throw new Error('x'); } } });
assert.equal(d.status, 403);
console.log('backend-permissions: OK');
