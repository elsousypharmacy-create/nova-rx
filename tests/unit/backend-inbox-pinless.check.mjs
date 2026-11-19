// SEC-01 / S1-07 (2026-11-19): the UX400 "no PIN on staging/preview" opening is CLOSED. Every NOVA_ENV (staging and preview
// included) needs a signed-in staff session (Authorization: Bearer) for the conversations read + send routes; the old PIN is
// accepted only until PIN_TRANSITION_UNTIL. The send safety rails stay: NOVA_INBOX_SEND kill switch, rate limits, wa_send_log.
// Fake data only, mocked bot fetch, no network, no real customer. Run: node tests/unit/backend-inbox-pinless.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { checkPin, historyAccess, pinTransitionOpen, PIN_TRANSITION_UNTIL } from '../../backend/src/inbox-history.js';
import { staffBearer } from './helpers/staff-session.mjs';

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
// auth: null = nothing, string = X-Nova-Pin, { token } = staff session
const authH = (h, a) => { if (typeof a === 'string') h['X-Nova-Pin'] = a; else if (a && a.token) h.Authorization = 'Bearer ' + a.token; return h; };
const get = async (path, e, pin) => {
  const h = authH({ 'CF-Connecting-IP': '10.1.0.' + (++ipn) }, pin);
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/' + path, { headers: h }), e);
  return [r.status, await r.json()];
};
const send = async (body, e, pin, ip) => {
  const h = authH({ 'CF-Connecting-IP': ip || ('10.2.0.' + (++ipn)), 'Content-Type': 'application/json' }, pin);
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/send', { method: 'POST', headers: h, body: JSON.stringify(body) }), e);
  return [r.status, await r.json()];
};

const cashier = await staffBearer(KV, { user: 'mona.cashier', role: 'cashier' });
const expired = await staffBearer(KV, { user: 'old.session', role: 'cashier', ttlS: -10 });
const revoked = await staffBearer(KV, { user: 'gone', role: 'cashier', revoked: true });
const ALL = [staging, preview, production, { ...base, NOVA_ENV: 'dev' }, base, { ...staging, NOVA_API_PIN: undefined }];

// no DB is still "not configured" (never data)
assert.equal((await checkPin(new Request('https://x.test/'), { NOVA_ENV: 'staging' })).status, 503);

// READ without a session => 401 on EVERY env (staging/preview included), no chat data in the body
for (const e of ALL) {
  let [s, j] = await get('conversations', e, null); assert.equal(s, 401, 'logged out must be 401 on NOVA_ENV=' + e.NOVA_ENV); assert.equal(j.code, 'AUTH_REQUIRED'); assert.equal(j.conversations, undefined);
  [s, j] = await get('conversation?id=wa_201111', e, null); assert.equal(s, 401); assert.ok(!JSON.stringify(j).includes('بنادول')); assert.ok(!JSON.stringify(j).includes('منى'));
  [s, j] = await get('metrics', e, null); assert.equal(s, 401); assert.equal(j.data, undefined);
  [s, j] = await get('media?id=wa_wamid.A', e, null); assert.equal(s, 401);
  [s, j] = await get('link-names', e, null); assert.equal(s, 401);
  [s, j] = await get('push/key', e, null); assert.equal(s, 401);
  // expired / revoked / garbage bearer => 401
  for (const bad of [expired, revoked, { token: 'z'.repeat(40) }]) { [s, j] = await get('conversations', e, bad); assert.equal(s, 401); assert.equal(j.conversations, undefined); }
  // a bearer that is not even token-shaped is still a 401
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/conversations', { headers: { Authorization: 'Bearer short' } }), e); assert.equal(r.status, 401);
}

// READ with a valid staff session => 200 on staging + preview + production
for (const e of [staging, preview, production]) {
  let [s, j] = await get('conversations', e, cashier); assert.equal(s, 200, JSON.stringify(j)); assert.deepEqual(j.conversations.map((c) => c.id).sort(), ['wa_201111', 'wa_old']);
  [s, j] = await get('conversation?id=wa_201111', e, cashier); assert.equal(s, 200); assert.equal(j.conversation.messages[0].text, 'عايزة بنادول');
  [s, j] = await get('metrics', e, cashier); assert.equal(s, 200); assert.ok(Array.isArray(j.data.events));
}
let [s, j] = [0, null];
// read stays read-only
assert.equal((await handle(new Request('https://x.test/api/v1/inbox/history/conversations', { method: 'POST', headers: { Authorization: 'Bearer ' + cashier.token } }), staging)).status, 405);

// TRANSITION: the old PIN still opens it until PIN_TRANSITION_UNTIL, on every env; wrong PIN => 401 PIN_INVALID
assert.equal(pinTransitionOpen(Date.parse('2026-11-19T00:00:00Z')), true);
assert.equal(pinTransitionOpen(Date.parse(PIN_TRANSITION_UNTIL) + 1), false);
for (const e of [staging, production]) {
  [s, j] = await get('conversations', e, PIN); assert.equal(s, 200);
  [s, j] = await get('conversations', e, 'wrong-pin-000000'); assert.equal(s, 401); assert.equal(j.code, 'PIN_INVALID'); assert.equal(j.conversations, undefined);
}
[s, j] = await get('conversations', { ...production, NOVA_API_PIN: undefined }, PIN); assert.equal(s, 503, 'PIN given but none configured stays closed');
// after the transition date the right PIN is refused
{
  const req = new Request('https://x.test/', { headers: { 'X-Nova-Pin': PIN, 'CF-Connecting-IP': '10.9.9.9' } });
  const late = await historyAccess(req, production, { now: () => Date.parse(PIN_TRANSITION_UNTIL) + 1000 });
  assert.equal(late.bad.status, 401); assert.equal(late.bad.code, 'AUTH_REQUIRED');
  const ok = await historyAccess(req, production, { now: () => Date.parse('2026-11-20T00:00:00Z') }); assert.equal(ok.bad, undefined); assert.equal(ok.session, null);
}

// SEND without a session => 401 on staging too; nothing reaches the bot, nothing logged
for (const e of [staging, preview, production]) {
  [s, j] = await send({ id: 'wa_201111', text: 'hi' }, e, null); assert.equal(s, 401); assert.equal(j.code, 'AUTH_REQUIRED');
  [s, j] = await send({ id: 'wa_201111', text: 'hi' }, e, expired); assert.equal(s, 401);
}
assert.equal(calls.length, 0);
assert.equal(db.prepare('SELECT COUNT(*) n FROM wa_send_log').get().n, 0);

// SEND kill switch still enforced with a session: NOVA_INBOX_SEND must be exactly '1'
for (const v of [undefined, '', '0', 'true', 'yes']) {
  [s, j] = await send({ id: 'wa_201111', text: 'hi' }, { ...staging, NOVA_INBOX_SEND: v }, cashier); assert.equal(s, 404); assert.equal(j.code, 'SEND_DISABLED');
}
assert.equal(calls.length, 0);

// SEND with a session: relays to the mocked bot, logged, and sent_by is the SESSION user (the body "by" is ignored)
[s, j] = await send({ id: 'wa_201111', text: 'متوفر', clientId: 'cli_session1', by: 'someone-else' }, staging, cashier); assert.equal(s, 200, JSON.stringify(j)); assert.equal(j.message.status, 'sent');
assert.deepEqual(calls.map((c) => c.p.operation), ['reply']); assert.equal(calls[0].p.chatId, 'wa_201111');
assert.deepEqual(db.prepare("SELECT status, sent_by FROM wa_send_log WHERE conversation_id = 'wa_201111'").all().map((r) => [r.status, r.sent_by]), [['sent', 'mona.cashier']]);
// duplicate guard still on
[s, j] = await send({ id: 'wa_201111', text: 'متوفر', clientId: 'cli_session1' }, staging, cashier); assert.equal(s, 409);

// a WhatsApp refusal (24h window) is a plain note, logged as failed
calls.length = 0; const okR = botReply; botReply = { ok: false, error: 'تيليجرام رفض الرسالة: فات أكتر من 24 ساعة على آخر رسالة من العميل' };
[s, j] = await send({ id: 'wa_old', text: 'hi' }, staging, cashier); assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED');
assert.equal(db.prepare("SELECT status FROM wa_send_log WHERE conversation_id = 'wa_old'").get().status, 'failed'); botReply = okR;

// per-IP rate limit still enforced (20 / 10 min)
let last;
for (let i = 0; i < 21; i++) last = await send({ id: 'wa_201111', text: 'r' + i }, staging, cashier, '9.9.9.9');
assert.equal(last[0], 429); assert.equal(last[1].code, 'SEND_RATE_LIMITED');

// CORS preflight from the preview origin allows the Authorization header
{
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/conversations', { method: 'OPTIONS', headers: { Origin: 'https://p.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } }), staging);
  assert.match(r.headers.get('Access-Control-Allow-Headers') || '', /Authorization/);
}

console.log('backend-inbox-pinless (SEC-01 session gate) OK');
