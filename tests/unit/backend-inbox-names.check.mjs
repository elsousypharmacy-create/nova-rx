// WA-LINK: link WhatsApp conversations to the registered pharmacy customers by number (mocked bot, in-memory D1). No network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { cleanName, planLinks } from '../../backend/src/inbox-names.js';

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
const calls = []; let bot = { ok: true, chats: [] }, botThrow = false;
const NOVA_FETCH = async (u, o) => { const p = JSON.parse(o.body); calls.push({ u, p }); if (botThrow) throw new Error('timeout'); return { ok: true, status: 200, async json() { return bot; } }; };
const env = { DB: D1, KV, NOVA_API_PIN: PIN, WA_BACKEND_URL: URL_, NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_FETCH, CORS_ALLOW_ORIGINS: 'https://p.test' };
const ins = db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default',?,?,1)");
ins.run('wa_201142677350', '201142677350'); ins.run('wa_201111', 'Sara (profile)'); ins.run('wa_201222', 'منى السيد'); ins.run('wa_201333', '201333');
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('other','wa_201142677350','other tenant',1)").run();
const names = () => Object.fromEntries(db.prepare("SELECT id, customer FROM inbox_conversations WHERE tenant_id='default'").all().map((r) => [r.id, r.customer]));
const msgsBefore = db.prepare('SELECT COUNT(*) n FROM inbox_messages').get().n;
let ipn = 0;
const link = async (pin = PIN, e = env) => {
  const h = { 'CF-Connecting-IP': '10.1.0.' + (++ipn), Origin: 'https://p.test' }; if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/link-names', { method: 'GET', headers: h }), e);
  return [r.status, await r.json()];
};
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

await ok('pure: cleanName accepts real names only', () => {
  assert.equal(cleanName('  أحمد   علي '), 'أحمد علي'); assert.equal(cleanName('01142677350'), null); assert.equal(cleanName('+20 114 267 7350'), null);
  assert.equal(cleanName(''), null); assert.equal(cleanName(null), null); assert.equal(cleanName('x'.repeat(121)), null); assert.equal(cleanName('a\u0000b'), 'a b');
});
await ok('pure: planLinks skips unknown chats, same names, bad ids, numbers; one entry per chat', () => {
  const cur = new Map([['wa_1', '201'], ['wa_2', 'منى'], ['wa_3', 'x']]);
  const p = planLinks([{ id: 'wa_1', name: 'علي' }, { id: 'wa_2', name: 'منى' }, { id: 'wa_9', name: 'جديد' }, { id: 'bad id', name: 'x' }, { id: 'wa_3', name: '0100' }, { id: 'wa_1', name: 'تاني' }], cur);
  assert.deepEqual(p, [{ id: 'wa_1', name: 'علي' }]);
});
await ok('auth: no / wrong PIN -> 401 and the bot is never called', async () => {
  let [s, j] = await link(null); assert.equal(s, 401); assert.equal(j.code, 'PIN_REQUIRED'); [s] = await link('wrong-pin-000000'); assert.equal(s, 401); assert.equal(calls.length, 0);
});
await ok('config: missing bot URL / short token -> 503, no bot call', async () => {
  let [s, j] = await link(PIN, { ...env, WA_BACKEND_URL: '' }); assert.equal(s, 503); assert.equal(j.code, 'LINK_NOT_CONFIGURED');
  [s] = await link(PIN, { ...env, NOVA_WA_BRIDGE_TOKEN: 'short' }); assert.equal(s, 503); assert.equal(calls.length, 0);
});
await ok('links the registered name by number: number-named and profile-named chats get the CRM name; others stay', async () => {
  bot = { ok: true, chats: [
    { id: 'wa_201142677350', name: 'محمد السيد', phone: '01142677350' }, { id: 'wa_201111', name: 'سارة أحمد', phone: '01111' },
    { id: 'wa_201222', name: '', phone: '01222' }, { id: 'wa_201333', name: '201333', phone: '01333' }, { id: 'wa_999', name: 'غير موجود', phone: '1' }, { id: 'tg_55', name: 'تيليجرام', phone: '' }] };
  const [s, j] = await link(); assert.equal(s, 200); assert.equal(j.linked, 2); assert.equal(j.throttled, false);
  const x = names(); assert.equal(x.wa_201142677350, 'محمد السيد'); assert.equal(x.wa_201111, 'سارة أحمد'); assert.equal(x.wa_201222, 'منى السيد'); assert.equal(x.wa_201333, '201333');
  assert.equal(db.prepare("SELECT customer FROM inbox_conversations WHERE tenant_id='other'").get().customer, 'other tenant', 'other tenant untouched');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inbox_conversations WHERE tenant_id='default'").get().n, 4, 'never creates a conversation');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inbox_messages').get().n, msgsBefore, 'messages untouched');
  assert.deepEqual(calls[0].p, { action: 'novaWhatsAppBridge', bridgeToken: TOKEN, operation: 'list' }); assert.equal(calls[0].u, URL_);
});
await ok('throttled: a second call within 2 minutes does not call the bot again', async () => {
  const c = calls.length; const [s, j] = await link(); assert.equal(s, 200); assert.equal(j.throttled, true); assert.equal(calls.length, c);
});
await ok('bot failure -> 502, nothing changes; a bot reply that is not ok -> 502', async () => {
  kvm.clear(); const before = JSON.stringify(names()); botThrow = true; let [s, j] = await link(); assert.equal(s, 502); assert.equal(j.code, 'LINK_FAILED');
  botThrow = false; kvm.clear(); bot = { ok: false, error: 'unauthorized' }; [s] = await link(); assert.equal(s, 502); assert.equal(JSON.stringify(names()), before);
});
await ok('a later run follows a changed registered name (CRM is the authority)', async () => {
  kvm.clear(); bot = { ok: true, chats: [{ id: 'wa_201142677350', name: 'محمد السيد الجديد' }] }; const [s, j] = await link(); assert.equal(j.linked, 1); assert.equal(names().wa_201142677350, 'محمد السيد الجديد');
});
console.log('PASS wa-link names:', n, 'cases');
