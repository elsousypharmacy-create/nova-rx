// WA-SEND: pharmacist reply from the conversations screen -> pharmacy bot op novaWhatsAppBridge/reply (mocked fetch).
// No network, no real customer. Run: node tests/unit/backend-inbox-send.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { cairoMs, WINDOW_MS } from '../../backend/src/inbox-send.js';

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
let botReply = { ok: true }, botGet = { ok: true, msgs: [] }, botThrow = false;
const NOVA_FETCH = async (u, o) => {
  const p = JSON.parse(o.body); calls.push({ u, p });
  if (botThrow) throw new Error('timeout');
  const j = p.operation === 'get' ? botGet : botReply;
  return { ok: true, status: 200, async json() { return j; } };
};
const env = { DB: D1, KV, NOVA_API_PIN: PIN, NOVA_INBOX_SEND: '1', WA_BACKEND_URL: URL_, NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_FETCH, CORS_ALLOW_ORIGINS: 'https://p.test' };
const now = Date.now();
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_201111','منى',?),('default','wa_old','قديم',1),('default','wa_bot','بوت',1),('other','wa_9','x',5)").run(now);
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES ('default','wa_wamid.A','wa_201111','in','عايزة بنادول',NULL,?),('default','h_u_1','wa_old','in','قديم',NULL,1760799000000),('default','h_u_2','wa_bot','in','قديم',NULL,1760799000000)").run(Math.floor((now - 3600e3) / 1000));

let ipn = 0;
const send = async (body, pin = PIN, e = env, ip) => {
  const h = { 'CF-Connecting-IP': ip || ('10.0.0.' + (++ipn)), 'Content-Type': 'application/json', Origin: 'https://p.test' };
  if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/send', { method: 'POST', headers: h, body: JSON.stringify(body) }), e);
  return [r.status, await r.json(), r];
};

// auth
let [s, j] = await send({ id: 'wa_201111', text: 'hi' }, null); assert.equal(s, 401); assert.equal(j.code, 'PIN_REQUIRED');
[s, j] = await send({ id: 'wa_201111', text: 'hi' }, 'wrong-pin-000000'); assert.equal(s, 401);
assert.equal(calls.length, 0, 'no bot call without a valid PIN');
// flag / config
[s, j] = await send({ id: 'wa_201111', text: 'hi' }, PIN, { ...env, NOVA_INBOX_SEND: undefined }); assert.equal(s, 404); assert.equal(j.code, 'SEND_DISABLED');
[s, j] = await send({ id: 'wa_201111', text: 'hi' }, PIN, { ...env, WA_BACKEND_URL: '' }); assert.equal(s, 503);
// validation: chat id only (never a phone/to field), text only, length
[s, j] = await send({ to: '201111', text: 'hi' }); assert.equal(s, 400);
[s, j] = await send({ id: '201111', text: 'hi' }); assert.equal(s, 400);
[s, j] = await send({ id: 'wa_201111', text: '   ' }); assert.equal(j.code, 'SEND_EMPTY');
[s, j] = await send({ id: 'wa_201111', text: 'a'.repeat(1001) }); assert.equal(j.code, 'SEND_TOO_LONG');
[s, j] = await send({ id: 'wa_201111', text: { x: 1 } }); assert.equal(s, 400);
[s, j] = await send({ id: 'wa_9', text: 'hi' }); assert.equal(j.code, 'SEND_UNKNOWN_CHAT', 'other tenant chat is unknown');
[s, j] = await send({ id: 'wa_nope', text: 'hi' }); assert.equal(s, 404);
assert.equal(calls.length, 0);

// happy path: relays only to this conversation, op reply, existing bridge token by name
[s, j] = await send({ id: 'wa_201111', text: '  متوفر يا فندم\r\nتشرفينا ', clientId: 'cli_abcdef12', by: 'د. أحمد' });
assert.equal(s, 200, JSON.stringify(j)); assert.equal(j.ok, true);
assert.equal(calls.length, 1); assert.equal(calls[0].u, URL_);
assert.deepEqual(calls[0].p, { action: 'novaWhatsAppBridge', bridgeToken: TOKEN, operation: 'reply', chatId: 'wa_201111', text: 'متوفر يا فندم\nتشرفينا' });
assert.equal(j.message.dir, 'out'); assert.equal(j.message.kind, 'pharm'); assert.equal(j.message.status, 'sent');
assert.ok(!JSON.stringify(j).includes(TOKEN), 'token never returned');
const row = db.prepare("SELECT * FROM inbox_messages WHERE id = ?").get(j.message.id); assert.equal(row.dir, 'out'); assert.equal(row.status, 'sent');
const lg = db.prepare("SELECT * FROM wa_send_log WHERE conversation_id = 'wa_201111'").all();
assert.equal(lg.length, 1); assert.equal(lg[0].status, 'sent'); assert.equal(lg[0].sent_by, 'د. أحمد'); assert.equal(lg[0].text_len, 'متوفر يا فندم\nتشرفينا'.length); assert.ok(lg[0].ip_hash && lg[0].ip_hash.length === 32);
// appears in the history thread as a pharmacist outgoing message
const hr = await handle(new Request('https://x.test/api/v1/inbox/history/conversation?id=wa_201111', { headers: { 'X-Nova-Pin': PIN } }), env);
const hm = (await hr.json()).conversation.messages; assert.equal(hm[hm.length - 1].kind, 'pharm'); assert.equal(hm[hm.length - 1].text, 'متوفر يا فندم\nتشرفينا');
// duplicate client id
[s, j] = await send({ id: 'wa_201111', text: 'again', clientId: 'cli_abcdef12' }); assert.equal(s, 409); assert.equal(calls.length, 1);

// 24h window closed (D1 and bot log both old) => 422, nothing sent, logged as blocked
calls.length = 0; botGet = { ok: true, msgs: [{ t: "'2025-10-01 10:00:00", role: 'user', text: 'x' }] };
[s, j] = await send({ id: 'wa_old', text: 'hi' }); assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED'); assert.match(j.message_ar, /24 ساعة/);
assert.deepEqual(calls.map((c) => c.p.operation), ['get'], 'only the read-only bot lookup, no reply');
assert.equal(db.prepare("SELECT status FROM wa_send_log WHERE conversation_id = 'wa_old'").get().status, 'blocked');
// window open according to the bot log (customer wrote 1h ago, not yet in D1) => sent
calls.length = 0;
const fmt = (ms) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms)) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
botGet = { ok: true, msgs: [{ t: fmt(now - 3600e3), role: 'user', text: 'x' }, { t: fmt(now - 60e3), role: 'bot', text: 'y' }] };
[s, j] = await send({ id: 'wa_bot', text: 'hi' }); assert.equal(s, 200, JSON.stringify(j)); assert.deepEqual(calls.map((c) => c.p.operation), ['get', 'reply']);
assert.ok(Math.abs(cairoMs(fmt(now)) - now) < 1500, 'cairoMs round-trips');
assert.equal(cairoMs('bad'), 0); assert.ok(WINDOW_MS < 24 * 3600e3);

// provider failure / no response
botReply = { ok: false, error: 'hold' };
[s, j] = await send({ id: 'wa_201111', text: 'x' }); assert.equal(s, 502); assert.equal(j.code, 'SEND_FAILED');
botThrow = true; [s, j] = await send({ id: 'wa_201111', text: 'y' }); assert.equal(s, 504); assert.equal(j.code, 'SEND_UNKNOWN'); botThrow = false;
assert.deepEqual(db.prepare("SELECT status FROM wa_send_log WHERE conversation_id = 'wa_201111' ORDER BY created_at, rowid").all().map((r) => r.status), ['sent', 'failed', 'unknown']);
assert.equal(db.prepare("SELECT COUNT(*) n FROM inbox_messages WHERE conversation_id = 'wa_201111' AND dir = 'out'").get().n, 1, 'failed sends are not shown as sent');

// per-IP rate limit
botReply = { ok: true }; let last;
for (let i = 0; i < 21; i++) last = await send({ id: 'wa_201111', text: 'r' + i }, PIN, env, '9.9.9.9');
assert.equal(last[0], 429); assert.equal(last[1].code, 'SEND_RATE_LIMITED');
// CORS preflight allows the PIN header
const pre = await handle(new Request('https://x.test/api/v1/inbox/history/send', { method: 'OPTIONS', headers: { Origin: 'https://p.test' } }), env);
assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Nova-Pin/);
console.log('backend inbox send check OK');
