import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { inboxEnabled } from '../../backend/src/inbox.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { db.prepare(sql).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
const T1 = 'a'.repeat(40), T2 = 'b'.repeat(40);
await session(T1, { tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
await session(T2, { tenantId: 't2', roles: ['Cashier'], tenantBranchIds: ['b9'], assignedBranchIds: ['b9'], activeBranchId: 'b9' });
const env = { NOVA_INBOX: '1', DB: D1, KV };
const call = async (method, path, body, tok = T1, e = env) => {
  const r = await handle(new Request('https://x.test/api/v1/inbox/' + path, { method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), e);
  return [r.status, await r.json()];
};

// flag default OFF
assert.equal(inboxEnabled({}), false);
let [s, j] = await call('GET', 'conversations', null, T1, { DB: D1, KV });
assert.equal(s, 404); assert.equal(j.code, 'INBOX_DISABLED'); assert.match(j.requestId, /^req_/);
[s] = await call('GET', 'conversations', null, null); assert.equal(s, 401);

// flow
[s, j] = await call('POST', 'open', { id: 'c1', customer: 'منى', now: 1 }); assert.equal(s, 200); assert.equal(j.conversation.mode, 'bot');
await call('POST', 'open', { id: 'c1', customer: 'ignored', now: 9 });
[s, j] = await call('POST', 'receive', { id: 'c1', text: 'عايزة دوا', now: 2 }); assert.equal(s, 200); assert.equal(j.message.dir, 'in');
[s, j] = await call('POST', 'send', { id: 'c1', text: 'أهلاً', now: 3 }); assert.equal(j.message.status, 'sent');
const mid = j.message.id;
[s, j] = await call('POST', 'send', { id: 'c1', text: '   ', now: 3 }); assert.equal(s, 400); assert.equal(j.code, 'INBOX_BAD_REQUEST');
[s, j] = await call('POST', 'status', { id: 'c1', messageId: mid, status: 'delivered' }); assert.equal(s, 200);
[s, j] = await call('POST', 'status', { id: 'c1', messageId: mid, status: 'bogus' }); assert.equal(s, 400);
[s, j] = await call('POST', 'status', { id: 'c1', messageId: 'nope', status: 'failed' }); assert.equal(s, 404);
await call('POST', 'assign', { id: 'c1', staff: 'سارة' });
await call('POST', 'handoff', { id: 'c1' });
[s, j] = await call('POST', 'link', { id: 'c1', customerId: 'C9', orderId: 'O7' });
let c = j.conversation;
assert.deepEqual([c.assignee, c.mode, c.customerId, c.orderId, c.messages.length], ['سارة', 'human', 'C9', 'O7', 2]);
assert.equal(c.messages[1].status, 'delivered');
[s, j] = await call('POST', 'link', { id: 'c1', orderId: null }); assert.equal(j.conversation.customerId, 'C9'); assert.equal(j.conversation.orderId, null);

// state survives "refresh": fresh requests read the same persisted state
[s, j] = await call('GET', 'conversations'); assert.equal(j.conversations.length, 1); assert.equal(j.conversations[0].mode, 'human');
[s, j] = await call('GET', 'conversations?mode=bot'); assert.equal(j.conversations.length, 0);
[s, j] = await call('GET', 'conversations?assignee=' + encodeURIComponent('سارة')); assert.equal(j.conversations.length, 1);
[s, j] = await call('GET', 'conversation?id=zzz'); assert.equal(s, 404); assert.equal(j.code, 'INBOX_NOT_FOUND');

// tenant isolation
[s, j] = await call('GET', 'conversations', null, T2); assert.equal(j.conversations.length, 0);
[s, j] = await call('POST', 'send', { id: 'c1', text: 'x' }, T2); assert.equal(s, 404);
[s, j] = await call('GET', 'conversations?tenantId=t2'); assert.equal(s, 403);

// no deletes
assert.equal(db.prepare('SELECT COUNT(*) c FROM inbox_messages').get().c, 2);
console.log('backend-inbox: all checks passed');
