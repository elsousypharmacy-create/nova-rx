// UX400 (owner approved 2026-11-15): the staging/preview backend serves the conversations read + send routes WITHOUT
// the pharmacy PIN; production (and dev / unset / unknown NOVA_ENV) stays PIN-gated. The send safety rails stay:
// NOVA_INBOX_SEND kill switch, WhatsApp 24h window, rate limits, wa_send_log.
// Fake data only, mocked bot fetch, no network, no real customer. Run: node tests/unit/backend-inbox-pinless.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { historyPinless, checkPin } from '../../backend/src/inbox-history.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { db.prepare(sql).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const PIN = 'pin-123456789012', TOKEN = 'x'.repeat(64), URL_ = 'https://script.test/exec';
const calls = [];
let botGet = { ok: true, msgs: [] }, botReply = { ok: true };
const NOVA_FETCH = async (u, o) => {
  const p = JSON.parse(o.body); calls.push({ u, p });
  return { ok: true, status: 200, async json() { return p.operation === 'get' ? botGet : botReply; } };
};
const base = { DB: D1, KV, NOVA_API_PIN: PIN, NOVA_INBOX_SEND: '1', WA_BACKEND_URL: URL_, NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_FETCH, CORS_ALLOW_ORIGINS: 'https://p.test' };
const staging = { ...base, NOVA_ENV: 'staging' }, preview = { ...base, NOVA_ENV: 'preview' }, production = { ...base, NOVA_ENV: 'production' };
const now = Date.now();
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_201111','منى',?),('default','wa_old','قديم',1)").run(now);
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES ('default','wa_wamid.A','wa_201111','in','عايزة بنادول',NULL,?),('default','h_u_1','wa_old','in','قديم',NULL,1760799000000)").run(now - 3600e3);

let ipn = 0;
const get = async (path, e, pin) => {
  const h = { 'CF-Connecting-IP': '10.1.0.' + (++ipn) }; if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/' + path, { headers: h }), e);
  return [r.status, await r.json()];
};
const send = async (body, e, pin, ip) => {
  const h = { 'CF-Connecting-IP': ip || ('10.2.0.' + (++ipn)), 'Content-Type': 'application/json' }; if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/send', { method: 'POST', headers: h, body: JSON.stringify(body) }), e);
  return [r.status, await r.json()];
};

// env flag: only the exact staging / preview values open the gate (fail closed on anything else)
assert.equal(historyPinless(staging), true); assert.equal(historyPinless(preview), true);
for (const v of ['production', 'dev', '', undefined, null, 'Staging', 'STAGING', 'staging ', 'prod', 'staging,production']) assert.equal(historyPinless({ NOVA_ENV: v }), false, 'gated for NOVA_ENV=' + v);
assert.equal(historyPinless(null), false); assert.equal(historyPinless(undefined), false);
// no DB is still "not configured" even on staging (never data)
assert.equal((await checkPin(new Request('https://x.test/'), { NOVA_ENV: 'staging' })).status, 503);

// READ: staging + preview => list + thread without any PIN header and without NOVA_API_PIN configured
for (const e of [staging, preview, { ...staging, NOVA_API_PIN: undefined }]) {
  let [s, j] = await get('conversations', e, null); assert.equal(s, 200, JSON.stringify(j)); assert.deepEqual(j.conversations.map((c) => c.id).sort(), ['wa_201111', 'wa_old']);
  [s, j] = await get('conversation?id=wa_201111', e, null); assert.equal(s, 200); assert.equal(j.conversation.messages[0].text, 'عايزة بنادول');
  [s, j] = await get('metrics', e, null); assert.equal(s, 200); assert.ok(Array.isArray(j.data.events));
}
// a stray/wrong PIN header on staging is ignored, never a 401 lock
let [s, j] = await get('conversations', staging, 'wrong-pin-000000'); assert.equal(s, 200);
// read stays read-only on staging
assert.equal((await handle(new Request('https://x.test/api/v1/inbox/history/conversations', { method: 'POST' }), staging)).status, 405);

// READ: production / dev / unset stay PIN-gated exactly as before
for (const e of [production, { ...base, NOVA_ENV: 'dev' }, base]) {
  [s, j] = await get('conversations', e, null); assert.equal(s, 401); assert.equal(j.code, 'PIN_REQUIRED'); assert.equal(j.conversations, undefined);
  [s, j] = await get('conversation?id=wa_201111', e, 'wrong-pin-000000'); assert.equal(s, 401); assert.equal(j.code, 'PIN_INVALID'); assert.ok(!JSON.stringify(j).includes('بنادول'));
  [s, j] = await get('metrics', e, null); assert.equal(s, 401);
  [s, j] = await get('conversations', e, PIN); assert.equal(s, 200);
}
[s, j] = await get('conversations', { ...production, NOVA_API_PIN: undefined }, null); assert.equal(s, 503, 'production without a PIN configured stays closed');

// SEND: production without / with wrong PIN => 401, nothing reaches the bot, nothing logged
[s, j] = await send({ id: 'wa_201111', text: 'hi' }, production, null); assert.equal(s, 401); assert.equal(j.code, 'PIN_REQUIRED');
[s, j] = await send({ id: 'wa_201111', text: 'hi' }, production, 'wrong-pin-000000'); assert.equal(s, 401);
assert.equal(calls.length, 0);
assert.equal(db.prepare('SELECT COUNT(*) n FROM wa_send_log').get().n, 0);

// SEND kill switch still enforced on staging: NOVA_INBOX_SEND must be exactly '1'
for (const v of [undefined, '', '0', 'true', 'yes']) {
  [s, j] = await send({ id: 'wa_201111', text: 'hi' }, { ...staging, NOVA_INBOX_SEND: v }, null); assert.equal(s, 404); assert.equal(j.code, 'SEND_DISABLED');
}
assert.equal(calls.length, 0);

// SEND on staging without PIN: relays to the mocked bot and is logged in wa_send_log
[s, j] = await send({ id: 'wa_201111', text: 'متوفر', clientId: 'cli_pinless1' }, staging, null); assert.equal(s, 200, JSON.stringify(j)); assert.equal(j.message.status, 'sent');
assert.deepEqual(calls.map((c) => c.p.operation), ['reply']); assert.equal(calls[0].p.chatId, 'wa_201111');
assert.deepEqual(db.prepare("SELECT status FROM wa_send_log WHERE conversation_id = 'wa_201111'").all().map((r) => r.status), ['sent']);
// duplicate guard still on
[s, j] = await send({ id: 'wa_201111', text: 'متوفر', clientId: 'cli_pinless1' }, staging, null); assert.equal(s, 409);

// no 24h pre-check on staging either (owner 2026-11-16): the send is attempted; a WhatsApp refusal is a plain note, logged as failed
calls.length = 0; const okR = botReply; botReply = { ok: false, error: 'تيليجرام رفض الرسالة: فات أكتر من 24 ساعة على آخر رسالة من العميل' };
[s, j] = await send({ id: 'wa_old', text: 'hi' }, staging, null); assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED');
assert.deepEqual(calls.map((c) => c.p.operation), ['reply']);
assert.equal(db.prepare("SELECT status FROM wa_send_log WHERE conversation_id = 'wa_old'").get().status, 'failed'); botReply = okR;

// per-IP rate limit still enforced on staging (20 / 10 min)
let last;
for (let i = 0; i < 21; i++) last = await send({ id: 'wa_201111', text: 'r' + i }, staging, null, '9.9.9.9');
assert.equal(last[0], 429); assert.equal(last[1].code, 'SEND_RATE_LIMITED');

console.log('backend-inbox-pinless OK');
