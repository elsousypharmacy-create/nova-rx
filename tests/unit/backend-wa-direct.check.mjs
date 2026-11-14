// FIX51: bot forward -> direct inbox write (same tables as history/send), 24h window from the latest real inbound.
// No network, no real customer. Run: node tests/unit/backend-wa-direct.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const TOK = 'a'.repeat(40), PIN = 'pin-123456789012';
const calls = [];
const NOVA_FETCH = async (u, o) => { const p = JSON.parse(o.body); calls.push(p); return { ok: true, status: 200, async json() { return p.operation === 'get' ? { ok: true, msgs: [] } : { ok: true }; } }; };
const env = { NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_DIRECT: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, KV, NOVA_API_PIN: PIN, NOVA_INBOX_SEND: '1', WA_BACKEND_URL: 'https://script.test/exec', NOVA_FETCH };
const item = (o) => ({ id: 'wamid.1', from: '201001', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: 'عايز بنادول', name: 'منى', phone_number_id: 'P1', direction: 'in', ...o });
const post = async (msgs, e = env) => { const r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: msgs }), headers: { Authorization: 'Bearer ' + TOK } }), e); return [r.status, await r.json()]; };
let ip = 0;
const api = async (path, init = {}) => { const r = await handle(new Request('https://x.test' + path, { ...init, headers: { 'X-Nova-Pin': PIN, 'CF-Connecting-IP': '10.1.0.' + (++ip), 'Content-Type': 'application/json' } }), env); return [r.status, await r.json()]; };

// 1) live inbound is visible in the history endpoints immediately (no cron, no tenant map)
let [s, j] = await post([item()]);
assert.deepEqual([s, j.ok, j.direct, j.added], [200, true, true, 1]);
[s, j] = await api('/api/v1/inbox/history/conversations');
assert.equal(j.conversations.length, 1);
assert.equal(j.conversations[0].id, 'wa_201001'); assert.equal(j.conversations[0].customer, 'منى');
assert.equal(j.conversations[0].last.kind, 'in');
// 2) idempotent
[s, j] = await post([item()]); assert.deepEqual([j.added, j.duplicates], [0, 1]);
// 3) outbound (bot reply) stored as bot message, never lowers updated_at
const t0 = Date.now();
[s, j] = await post([item({ id: 'wamid.2', direction: 'out', text: 'أهلا', timestamp: String(Math.floor(t0 / 1000) - 3600) })]);
assert.equal(j.added, 1);
[s, j] = await api('/api/v1/inbox/history/conversation?id=wa_201001');
assert.deepEqual(j.conversation.messages.map((m) => [m.dir, m.kind]), [['out', 'bot'], ['in', 'in']]);
// 4) bad input / disabled / unsupported
assert.equal((await post([{ id: '', from: '1' }]))[0], 400);
[s, j] = await post([item({ id: 'a1', type: 'audio', text: null })]); assert.deepEqual([j.added, j.skipped], [0, 1]);
assert.equal((await post([item()], { ...env, NOVA_WA_BRIDGE_DIRECT: undefined }))[0], 200); // legacy queue path still works
// 5) 24h window computed from the latest real inbound: a fresh inbound re-opens a chat whose backfill is old
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_555','قديم',1)").run();
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES ('default','h_u_1','wa_555','in','قديم',NULL,1760799000000)").run();
[s, j] = await api('/api/v1/inbox/history/send', { method: 'POST', body: JSON.stringify({ id: 'wa_555', text: 'x' }) });
assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED'); assert.equal(calls.filter((c) => c.operation === 'reply').length, 0);
[s, j] = await post([item({ id: 'wamid.9', from: '555' })]);
[s, j] = await api('/api/v1/inbox/history/send', { method: 'POST', body: JSON.stringify({ id: 'wa_555', text: 'اتفضل' }) });
assert.equal(s, 200, JSON.stringify(j)); assert.equal(calls.filter((c) => c.operation === 'reply').length, 1);
console.log('backend-wa-direct check OK');
