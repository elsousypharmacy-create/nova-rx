// FIX46: PIN-gated read-only WhatsApp history. No PIN / wrong PIN => no chat data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle, corsHeaders } from '../../backend/src/index.js';
import { kindOf, atMs } from '../../backend/src/inbox-history.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { db.prepare(sql).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const PIN = 'pin-123456789012';
const env = { DB: D1, KV, NOVA_API_PIN: PIN, CORS_ALLOW_ORIGINS: 'https://p.test' };
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_201','منى',1760800000000),('other','wa_9','x',5)").run();
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES ('default','h_u_1','wa_201','in','عايزة بنادول',NULL,1760799000000),('default','h_b_2','wa_201','out','متوفر','delivered',1760799001000),('default','h_s_3','wa_201','out','اتحوّل للصيدلي',NULL,1760799002000),('default','wa_wamid.X','wa_201','in','live',NULL,1760800000),('other','h_u_9','wa_9','in','secret',NULL,1)").run();

const call = async (path, pin, e = env, ip = '1.1.1.1') => {
  const h = { 'CF-Connecting-IP': ip }; if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/' + path, { headers: h }), e);
  return [r.status, await r.json()];
};

assert.equal(kindOf('h_p_x', 'out'), 'pharm'); assert.equal(kindOf('wa_x', 'in'), 'in'); assert.equal(kindOf('m_1', 'out'), 'out');
assert.equal(atMs(1760800000), 1760800000000); assert.equal(atMs(1760800000000), 1760800000000);

// not configured => 503, never data
let [s, j] = await call('conversations', PIN, { DB: D1, KV });
assert.equal(s, 503); assert.equal(j.conversations, undefined);
[s, j] = await call('conversations', 'short', { DB: D1, KV, NOVA_API_PIN: 'short' });
assert.equal(s, 503);
// no PIN / wrong PIN => 401 and no data
[s, j] = await call('conversations', null); assert.equal(s, 401); assert.equal(j.code, 'PIN_REQUIRED'); assert.equal(j.conversations, undefined);
[s, j] = await call('conversation?id=wa_201', 'wrong-pin-0000000'); assert.equal(s, 401); assert.equal(j.code, 'PIN_INVALID'); assert.equal(j.conversation, undefined);
assert.ok(!JSON.stringify(j).includes('بنادول'));
// right PIN => list of own tenant only, newest first
[s, j] = await call('conversations', PIN); assert.equal(s, 200);
assert.equal(j.conversations.length, 1); assert.equal(j.conversations[0].id, 'wa_201'); assert.equal(j.conversations[0].count, 4);
assert.equal(j.conversations[0].last.text, 'live'); assert.equal(j.conversations[0].last.at, 1760800000000);
[s, j] = await call('conversation?id=wa_201', PIN); assert.equal(s, 200);
assert.deepEqual(j.conversation.messages.map((m) => m.kind), ['in', 'bot', 'sys', 'in']);
[s, j] = await call('conversation?id=wa_9', PIN); assert.equal(j.conversation, null);
// brute force: 10 failures from one IP => 429 even with the right PIN; other IPs unaffected
for (let i = 0; i < 10; i++) await call('conversations', 'bad-pin-00000000' + i, env, '9.9.9.9');
[s, j] = await call('conversations', PIN, env, '9.9.9.9'); assert.equal(s, 429); assert.equal(j.conversations, undefined);
[s] = await call('conversations', PIN, env, '8.8.8.8'); assert.equal(s, 200);
// read-only: POST is not allowed
const r = await handle(new Request('https://x.test/api/v1/inbox/history/conversations', { method: 'POST', headers: { 'X-Nova-Pin': PIN } }), env);
assert.equal(r.status, 405);
// CORS preflight allows the PIN header for the preview origin only
const h = corsHeaders(new Request('https://x.test/', { headers: { Origin: 'https://p.test' } }), env);
assert.match(h['Access-Control-Allow-Headers'], /X-Nova-Pin/);
assert.equal(corsHeaders(new Request('https://x.test/', { headers: { Origin: 'https://evil.test' } }), env)['Access-Control-Allow-Origin'], undefined);
console.log('backend-inbox-history OK');
