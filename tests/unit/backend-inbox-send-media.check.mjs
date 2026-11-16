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

const probe = async (pin = PIN, e = env) => { const h = { 'CF-Connecting-IP': '10.2.0.1', Origin: 'https://p.test' }; if (pin != null) h['X-Nova-Pin'] = pin; const r = await handle(new Request('https://x.test/api/v1/inbox/history/send-media', { headers: h }), e); return [r.status, await r.json()]; };
let [ps, pj] = await probe(null); assert.equal(ps, 401);
[ps, pj] = await probe(); assert.equal(ps, 200); assert.equal(pj.enabled, true);
[ps, pj] = await probe(PIN, { ...env, NOVA_INBOX_SEND_MEDIA: undefined }); assert.equal(pj.enabled, false, 'flag off -> buttons stay hidden');
[ps, pj] = await probe(PIN, { ...env, WA_BACKEND_URL: '' }); assert.equal(pj.enabled, false, 'not configured -> hidden');
[ps, pj] = await probe(PIN, { ...env, NOVA_WA_BRIDGE_TOKEN: 'short' }); assert.equal(pj.enabled, false, 'short token -> hidden');
assert.ok(!JSON.stringify(pj).includes(TOKEN));
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
assert.equal(j.message.dir, 'out'); assert.equal(j.message.kind, 'pharm'); assert.equal(j.message.status, 'sent'); assert.equal(j.message.media.type, 'image'); assert.equal(j.message.media.cached, true); assert.equal(j.message.media.caption, 'الروشتة'); assert.equal(j.message.text, '[صورة] الروشتة');
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
[s, j] = await send({ id: 'wa_201111', mime: 'image/png', data: b64(PNG), clientId: 'cli_img_0003' }); assert.equal(s, 200); assert.equal(j.message.text, '[صورة]'); assert.equal(calls.at(-1).p.caption, undefined);
// bot failures: window closed, generic, timeout -> mapped, nothing stored
const before = db.prepare('SELECT COUNT(*) c FROM inbox_messages').get().c;
botReply = { ok: false, error: 'فات أكتر من 24 ساعة على آخر رسالة' }; [s, j] = await send({ ...ok(), clientId: 'cli_img_0004' }); assert.equal(s, 422); assert.equal(j.code, 'SEND_WINDOW_CLOSED');
botReply = { ok: false, error: 'upload failed: x' }; [s, j] = await send({ ...ok(), clientId: 'cli_img_0005' }); assert.equal(s, 502); assert.equal(j.code, 'SEND_FAILED');
botThrow = true; [s, j] = await send({ ...ok(), clientId: 'cli_img_0006' }); assert.equal(s, 504); assert.equal(j.code, 'SEND_UNKNOWN');
assert.equal(db.prepare('SELECT COUNT(*) c FROM inbox_messages').get().c, before, 'no message stored on failure');
assert.deepEqual(db.prepare("SELECT status FROM wa_send_log WHERE client_id IN ('cli_img_0004','cli_img_0005','cli_img_0006') ORDER BY client_id").all().map((x) => x.status), ['failed', 'failed', 'unknown']);

// ---- voice notes ----
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.from([0, 2]), Buffer.from('fake-ogg-opus')]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.from('fake-m4a')]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from('fake-mp3')]);
const AMR = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.from('fake-amr')]);
const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.from('fake-adts')]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('fake-webm')]);
const voice = (over = {}) => ({ id: 'wa_201111', kind: 'audio', mime: 'audio/ogg', data: b64(OGG), clientId: 'cli_voice_' + (++ipn) + '_x', by: 'د. أحمد', ...over });
calls.length = 0; botThrow = false; botReply = { ok: true, message_id: 'wamid.V1' };
[s, j] = await send(voice({ clientId: 'cli_voice_0001' })); assert.equal(s, 200, JSON.stringify(j));
assert.deepEqual(calls.at(-1).p, { action: 'novaWhatsAppBridge', bridgeToken: TOKEN, operation: 'sendMedia', chatId: 'wa_201111', kind: 'audio', mime: 'audio/ogg', media_base64: b64(OGG) });
assert.equal(j.message.media.type, 'audio'); assert.equal(j.message.media.mime, 'audio/ogg'); assert.equal(j.message.media.cached, true); assert.equal(j.message.text, '[رسالة صوتية]'); assert.equal(j.message.kind, 'pharm');
assert.ok(kvm.has('wamedia:default:' + j.message.id), 'voice bytes cached');
const vrow = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(j.message.id); assert.equal(vrow.media_type, 'audio'); assert.equal(vrow.media_caption, null); assert.equal(vrow.text, '[رسالة صوتية]', 'stored like the bot copy: placeholder text');
assert.equal(db.prepare("SELECT text FROM inbox_messages WHERE id LIKE 'ps\\_%' ESCAPE '\\' AND media_type = 'image' AND media_caption = 'الروشتة' LIMIT 1").get().text, '[صورة] الروشتة', 'photo + caption stored as placeholder + caption');
for (const [mime, buf] of [['audio/mp4', M4A], ['audio/mpeg', MP3], ['audio/aac', AAC], ['audio/amr', AMR]]) { [s, j] = await send(voice({ mime, data: b64(buf) })); assert.equal(s, 200, mime + JSON.stringify(j)); assert.equal(calls.at(-1).p.mime, mime); }
const nv = calls.length;
const vbad = [[{ mime: 'audio/webm', data: b64(WEBM) }, 400, 'webm'], [{ mime: 'audio/wav' }, 400, 'wav'], [{ mime: 'image/png', data: b64(PNG) }, 400, 'image mime on audio'], [{ kind: 'image', mime: 'audio/ogg' }, 400, 'audio mime on image kind'],
  [{ kind: 'video', mime: 'video/mp4' }, 400, 'video'], [{ kind: '__proto__' }, 400, 'proto'], [{ data: b64(M4A) }, 400, 'mp4 bytes labelled ogg'], [{ mime: 'audio/mpeg', data: b64(OGG) }, 400, 'ogg bytes labelled mpeg'], [{ mime: 'audio/mp4', data: b64(OGG) }, 400, 'ogg bytes labelled mp4'],
  [{ mime: 'audio/aac', data: b64(OGG) }, 400, 'ogg bytes labelled aac'], [{ mime: 'audio/amr', data: b64(OGG) }, 400, 'ogg bytes labelled amr'], [{ data: b64(Buffer.from('<html>x</html>')) }, 400, 'html'],
  [{ caption: 'تعليق' }, 400, 'caption on voice'], [{ data: b64(Buffer.concat([OGG, Buffer.alloc(5 * 1024 * 1024)])) }, 413, 'too big'], [{ data: b64(Buffer.concat([OGG, Buffer.alloc(5 * 1024 * 1024 - OGG.length + 1)])) }, 413, 'one byte over 5MB'], [{ data: '' }, 400, 'empty']];
for (const [over, st, why] of vbad) { [s, j] = await send(voice(over)); assert.equal(s, st, why + ' ' + JSON.stringify(j)); }
assert.equal(calls.length, nv, 'invalid voice requests never reach the bot');
[s, j] = await send(voice({ data: b64(Buffer.concat([OGG, Buffer.alloc(5 * 1024 * 1024 - OGG.length)])), clientId: 'cli_voice_exact' })); assert.equal(s, 200, 'exactly 5 MB accepted');
// no kind = image (the old clients keep working)
[s, j] = await send({ id: 'wa_201111', mime: 'image/jpeg', data: b64(JPEG), clientId: 'cli_default_k1' }); assert.equal(s, 200); assert.equal(calls.at(-1).p.kind, 'image');
// the bot's forwarded copy of a voice note / photo that arrives AFTER our row is not stored twice
{ const { ingestDirect } = await import('../../backend/src/whatsapp-bridge.js');
  const at = Math.floor(Date.now() / 1000);
  const r1 = await ingestDirect(D1, 'default', [{ id: 'wamid.VOICE1', from: '201111', type: 'audio', direction: 'out', timestamp: at, mime_type: 'audio/ogg', media_id: 'M1' }], Date.now(), KV);
  assert.equal(r1.duplicates, 1, 'voice echo skipped'); assert.equal(r1.added, 0);
  const r2 = await ingestDirect(D1, 'default', [{ id: 'wamid.IMG1', from: '201111', type: 'image', direction: 'out', timestamp: at, mime_type: 'image/jpeg', media_id: 'M2', text: 'الروشتة' }], Date.now(), KV);
  assert.equal(r2.duplicates, 1, 'photo echo skipped'); assert.equal(r2.added, 0);
  const r3 = await ingestDirect(D1, 'default', [{ id: 'wamid.IMGIN', from: '201111', type: 'image', direction: 'in', timestamp: at, mime_type: 'image/jpeg', media_id: 'M3' }], Date.now(), KV);
  assert.equal(r3.added, 1, 'a customer photo is never skipped');
  const r4 = await ingestDirect(D1, 'default', [{ id: 'wamid.IMGOLD', from: '201111', type: 'image', direction: 'out', timestamp: at - 3600, mime_type: 'image/jpeg', media_id: 'M4' }], Date.now(), KV);
  assert.equal(r4.added, 1, 'an hour apart is a different message');
  const r5 = await ingestDirect(D1, 'default', [{ id: 'wamid.DOCOUT', from: '201111', type: 'document', direction: 'out', timestamp: at, mime_type: 'application/pdf', media_id: 'M5', filename: 'a.pdf' }], Date.now(), KV);
  assert.equal(r5.added, 1, 'only the same media type counts as the same message (a document sent by the bot at the same time is kept)'); }
// probe says audio is supported
[ps, pj] = await probe(); assert.equal(pj.audio, true);
console.log('PASS backend inbox send-media');
