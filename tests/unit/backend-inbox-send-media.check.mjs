// WA-SEND-IMG: pharmacist sends a photo from the conversations screen -> bot op novaWhatsAppBridge/sendMedia (mocked fetch).
// No network, no real customer. Run: node tests/unit/backend-inbox-send-media.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';

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
const calls = []; let botReply = { ok: true, message_id: 'wamid.OUT' }, botThrow = false;
const NOVA_FETCH = async (u, o) => { const p = JSON.parse(o.body); calls.push({ u, p }); if (botThrow) throw new Error('timeout'); return { ok: true, status: 200, async json() { return botReply; } }; };
const env = { DB: D1, KV, NOVA_API_PIN: PIN, NOVA_INBOX_SEND_MEDIA: '1', WA_BACKEND_URL: URL_, NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_FETCH, CORS_ALLOW_ORIGINS: 'https://p.test' };
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_201111','منى',1),('other','wa_9','x',5)").run();

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-fake-jpeg')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png')]);
const b64 = (b) => b.toString('base64');
let ipn = 0;
const send = async (body, pin = PIN, e = env) => {
  const h = { 'CF-Connecting-IP': '10.1.0.' + (++ipn), 'Content-Type': 'application/json', Origin: 'https://p.test' };
  if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/send-media', { method: 'POST', headers: h, body: JSON.stringify(body) }), e);
  return [r.status, await r.json()];
};
const ok = () => ({ id: 'wa_201111', mime: 'image/jpeg', data: b64(JPEG), caption: 'الروشتة', clientId: 'cli_img_0001', by: 'د. أحمد' });

let [s, j] = await send(ok(), null); assert.equal(s, 401);
[s, j] = await send(ok(), 'wrong-pin-000000'); assert.equal(s, 401);
[s, j] = await send(ok(), PIN, { ...env, NOVA_INBOX_SEND_MEDIA: undefined }); assert.equal(s, 404); assert.equal(j.code, 'SENDMEDIA_DISABLED');
[s, j] = await send(ok(), PIN, { ...env, WA_BACKEND_URL: '' }); assert.equal(s, 503);
assert.equal(calls.length, 0, 'nothing reaches the bot without auth, the flag and config');

const bads = [
  [{ id: '201111' }, 'bad id'], [{ to: '201111', id: undefined }, 'phone not accepted'], [{ id: 'wa_9' }, 'other tenant', 404], [{ id: 'wa_nope' }, 'unknown chat', 404],
  [{ mime: 'image/gif' }, 'gif'], [{ mime: 'image/gif', data: b64(PNG) }, 'png bytes labelled gif'], [{ mime: 'image/webp', data: b64(JPEG) }, 'webp'],
  [{ data: b64(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024 - JPEG.length + 1)])) }, 'one byte over 5MB', 413], [{ mime: 'text/html' }, 'html'], [{ mime: 'application/pdf' }, 'pdf'], [{ data: '' }, 'empty'], [{ data: '***' }, 'not base64'],
  [{ data: b64(PNG) }, 'png bytes labelled jpeg'], [{ mime: 'image/png', data: b64(JPEG) }, 'jpeg bytes labelled png'], [{ data: b64(Buffer.from('<script>x</script>')) }, 'script'],
  [{ data: b64(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)])) }, 'too big', 413], [{ caption: 'ا'.repeat(1025) }, 'caption', 400], [{ caption: 5 }, 'caption type'],
];
for (const [over, why, st] of bads) { [s, j] = await send({ ...ok(), ...over, clientId: 'cli_' + (++ipn) + '_xxxxxx' }); assert.equal(s, st || 400, why + ' ' + JSON.stringify(j)); }
assert.equal(calls.length, 0, 'invalid requests never reach the bot');

[s, j] = await send(ok()); assert.equal(s, 200, JSON.stringify(j)); assert.equal(j.ok, true);
assert.equal(calls.length, 1); assert.equal(calls[0].u, URL_);
assert.deepEqual(calls[0].p, { action: 'novaWhatsAppBridge', bridgeToken: TOKEN, operation: 'sendMedia', chatId: 'wa_201111', kind: 'image', mime: 'image/jpeg', media_base64: b64(JPEG), caption: 'الروشتة' });
assert.equal(j.message.dir, 'out'); assert.equal(j.message.kind, 'pharm'); assert.equal(j.message.status, 'sent'); assert.equal(j.message.media.type, 'image'); assert.equal(j.message.media.cached, true); assert.equal(j.message.text, 'الروشتة');
assert.ok(!JSON.stringify(j).includes(TOKEN));
const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(j.message.id);
assert.equal(row.media_type, 'image'); assert.equal(row.media_mime, 'image/jpeg'); assert.equal(row.media_cached, 1); assert.equal(row.dir, 'out');
assert.ok(kvm.has('wamedia:default:' + j.message.id), 'bytes cached so the sender sees the photo');
const lg = db.prepare("SELECT * FROM wa_send_log WHERE client_id = 'cli_img_0001'").all(); assert.equal(lg.length, 1); assert.equal(lg[0].status, 'sent'); assert.equal(lg[0].sent_by, 'د. أحمد');
const hr = await handle(new Request('https://x.test/api/v1/inbox/history/conversation?id=wa_201111', { headers: { 'X-Nova-Pin': PIN } }), env);
const hm = (await hr.json()).conversation.messages; assert.equal(hm.at(-1).media.type, 'image');

[s, j] = await send({ ...ok(), data: b64(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024 - JPEG.length)])), clientId: 'cli_img_exact' }); assert.equal(s, 200, 'exactly 5 MB is accepted');
// duplicate client id -> not sent twice
const nCalls = calls.length; [s, j] = await send(ok()); assert.equal(s, 409); assert.equal(calls.length, nCalls, 'duplicate not relayed');
// bot forwards the same photo as wb_<wamid> -> only our ps_ row remains
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at, media_type) VALUES ('default','wb_wamid.OUT','wa_201111','out','الروشتة',NULL,?, 'image')").run(Date.now());
[s, j] = await send({ ...ok(), clientId: 'cli_img_0002' }); assert.equal(s, 200);
assert.equal(db.prepare("SELECT COUNT(*) c FROM inbox_messages WHERE id LIKE 'wb\\_%' ESCAPE '\\' AND conversation_id='wa_201111'").get().c, 0, 'echo row replaced by ours');
// PNG without caption
[s, j] = await send({ id: 'wa_201111', mime: 'image/png', data: b64(PNG), clientId: 'cli_img_0003' }); assert.equal(s, 200); assert.equal(j.message.text, ''); assert.equal(calls.at(-1).p.caption, undefined);
// bot failures: window closed, generic, timeout -> mapped, nothing stored
const before = db.prepare('SELECT COUNT(*) c FROM inbox_messages').get().c;
botReply = { ok: false, error: 'فات أكتر من 24 ساعة على آخر رسالة' }; [s, j] = await send({ ...ok(), clientId: 'cli_img_0004' }); assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED');
botReply = { ok: false, error: 'upload failed: x' }; [s, j] = await send({ ...ok(), clientId: 'cli_img_0005' }); assert.equal(s, 502); assert.equal(j.code, 'SEND_FAILED');
botThrow = true; [s, j] = await send({ ...ok(), clientId: 'cli_img_0006' }); assert.equal(s, 504); assert.equal(j.code, 'SEND_UNKNOWN');
assert.equal(db.prepare('SELECT COUNT(*) c FROM inbox_messages').get().c, before, 'no message stored on failure');
assert.deepEqual(db.prepare("SELECT status FROM wa_send_log WHERE client_id IN ('cli_img_0004','cli_img_0005','cli_img_0006') ORDER BY client_id").all().map((x) => x.status), ['failed', 'failed', 'unknown']);
console.log('PASS backend inbox send-media');
