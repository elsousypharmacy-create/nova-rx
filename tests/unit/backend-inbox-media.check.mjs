// UX405: incoming WhatsApp media (image/sticker/audio/video/document) via the pharmacy-bot bridge.
// Fixtures only: fake numbers, fake bytes, in-memory D1 (node:sqlite) + Map KV. No network, no WA_TOKEN, no R2.
// Run: node --no-warnings tests/unit/backend-inbox-media.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { processQueue } from '../../backend/src/whatsapp-intake.js';
import { makeProcessor, messageText } from '../../backend/src/whatsapp-process.js';
import { decodeBase64, mediaKey, MAX_MEDIA_BYTES } from '../../backend/src/inbox-media.js';
import { MAX_BRIDGE_BODY } from '../../backend/src/whatsapp-bridge.js';
import { staffBearer } from './helpers/staff-session.mjs';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map(), puts = [];
const KV = { async get(k, type) { if (!kvm.has(k)) return null; const v = kvm.get(k); return type === 'arrayBuffer' && v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v; },
  async put(k, v, o) { puts.push([k, o]); kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const TOK = 'a'.repeat(40), PIN = 'pin-123456789012';
const env = { NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_DIRECT: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, KV, NOVA_API_PIN: PIN };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 250, 251]);
const b64 = (u8) => Buffer.from(u8).toString('base64');
const nowS = String(Math.floor(Date.now() / 1000));
const item = (o) => ({ id: 'wamid.x', from: '201000000001', timestamp: nowS, type: 'text', text: null, media_id: null, filename: null, name: 'تجربة', phone_number_id: 'P1', direction: 'in', ...o });
const post = async (msgs, e = env) => { const body = JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: msgs }); const r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body, headers: { Authorization: 'Bearer ' + TOK } }), e); return [r.status, await r.json()]; };
const get = (path, h = { 'X-Nova-Pin': PIN }, e = env) => handle(new Request('https://x.test' + path, { headers: h }), e);
const row = (id) => ({ ...db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(id) });
let s, j;

// 1) all five media types are stored (never skipped), caption-less too, with media_id + new fields; bytes -> KV
const batch = [
  item({ id: 'img1', type: 'image', text: 'روشتة', media_id: 'MI1', mime_type: 'image/png', media_size: PNG.length, media_base64: b64(PNG) }),
  item({ id: 'stk1', type: 'sticker', media_id: 'MS1', mime_type: 'image/webp', media_size: 4, media_base64: b64([1, 2, 3, 4]) }),
  item({ id: 'aud1', type: 'audio', media_id: 'MA1', mime_type: 'audio/ogg; codecs=opus', media_size: 3, media_base64: b64([9, 8, 7]) }),
  item({ id: 'vid1', type: 'video', media_id: 'MV1', mime_type: 'video/mp4', media_size: 2, media_base64: b64([5, 6]) }),
  item({ id: 'doc1', type: 'document', filename: 'تحاليل.pdf', media_id: 'MD1', mime_type: 'application/pdf', media_size: 5, media_base64: b64([37, 80, 68, 70, 45]) }),
  item({ id: 'big1', type: 'image', media_id: 'MB1', mime_type: 'image/jpeg', media_size: 7340032, media_skipped: 'too_large' }),
  item({ id: 'ff1', type: 'video', media_id: 'MF1', mime_type: 'video/mp4', media_skipped: 'fetch_failed' }),
  item({ id: 'txt1', type: 'text', text: 'عايز بنادول' }),
];
[s, j] = await post(batch);
assert.deepEqual([s, j.ok, j.added, j.skipped, j.cached], [200, true, 8, 0, 5], JSON.stringify(j));
const T = 'default';
assert.deepEqual([row('wa_img1').media_type, row('wa_img1').media_id, row('wa_img1').media_mime, row('wa_img1').media_size, row('wa_img1').media_caption, row('wa_img1').media_cached, row('wa_img1').text],
  ['image', 'MI1', 'image/png', PNG.length, 'روشتة', 1, '[صورة] روشتة']);
assert.equal(row('wa_stk1').text, '[ملصق]'); assert.equal(row('wa_stk1').media_type, 'sticker');
assert.equal(row('wa_aud1').text, '[رسالة صوتية]'); assert.equal(row('wa_aud1').media_mime, 'audio/ogg');
assert.equal(row('wa_vid1').text, '[فيديو]'); assert.equal(row('wa_vid1').media_id, 'MV1');
assert.equal(row('wa_doc1').text, '[مستند] تحاليل.pdf'); assert.equal(row('wa_doc1').media_filename, 'تحاليل.pdf');
assert.deepEqual([row('wa_big1').media_skipped, row('wa_big1').media_cached, row('wa_big1').media_size, row('wa_big1').text], ['too_large', 0, 7340032, '[صورة]']);
assert.equal(row('wa_ff1').media_skipped, 'fetch_failed');
assert.equal(row('wa_txt1').media_type, null); assert.equal(row('wa_txt1').text, 'عايز بنادول');
assert.deepEqual([...kvm.get(mediaKey(T, 'wa_img1'))], [...PNG]);
assert.ok(puts.every(([k, o]) => k.startsWith('wamedia:default:wa_') && o.expirationTtl > 0));
assert.ok(!kvm.has(mediaKey(T, 'wa_big1')));
// base64 is never persisted in D1
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM inbox_messages').all()).includes(b64(PNG)));
// idempotent
[s, j] = await post(batch); assert.deepEqual([j.added, j.duplicates], [0, 8]);

// 2) history exposes media meta (no bytes) for the UI
let r = await get('/api/v1/inbox/history/conversation?id=wa_201000000001');
j = await r.json();
const byId = Object.fromEntries(j.conversation.messages.map((m) => [m.id, m]));
assert.deepEqual(byId.wa_img1.media, { type: 'image', mime: 'image/png', filename: null, size: PNG.length, skipped: null, caption: 'روشتة', cached: true });
assert.equal(byId.wa_big1.media.skipped, 'too_large'); assert.equal(byId.wa_big1.media.cached, false);
assert.equal(byId.wa_txt1.media, undefined);

// 3) media route: 200 from KV fixture with safe headers; gated like the history
r = await get('/api/v1/inbox/history/media?id=wa_img1');
assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'image/png');
assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(r.headers.get('Content-Security-Policy'), /sandbox/);
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...PNG]);
r = await get('/api/v1/inbox/history/media?id=wa_doc1'); assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'application/pdf');
assert.match(r.headers.get('Content-Disposition'), /filename\*=UTF-8''%D8%AA/);
r = await get('/api/v1/inbox/history/media?id=wa_aud1'); assert.equal(r.headers.get('Content-Type'), 'audio/ogg');
assert.equal((await get('/api/v1/inbox/history/media?id=wa_img1', {})).status, 401); // session/PIN gate
assert.equal((await get('/api/v1/inbox/history/media?id=wa_img1', { 'X-Nova-Pin': 'wrong-pin-000000' })).status, 401);
assert.equal((await get('/api/v1/inbox/history/media?id=wa_img1', {}, { ...env, NOVA_ENV: 'staging' })).status, 401); // SEC-01: staging needs a staff session too
assert.equal((await get('/api/v1/inbox/history/media?id=wa_img1', (await staffBearer(KV)).headers, { ...env, NOVA_ENV: 'staging' })).status, 200); // SEC-01: staff session opens it
// fallbacks: metadata-only, KV miss, not media, unknown id, bad id -> clear Arabic JSON, never 500
for (const [id, code, st] of [['wa_big1', 'MEDIA_UNAVAILABLE', 404], ['wa_txt1', 'MEDIA_NOT_FOUND', 404], ['nope', 'MEDIA_NOT_FOUND', 404], ['', 'MEDIA_BAD_ID', 400]]) {
  r = await get('/api/v1/inbox/history/media?id=' + id); j = await r.json();
  assert.deepEqual([r.status, j.code], [st, code], id); assert.match(j.message_ar, /[؀-ۿ]/);
}
r = await get('/api/v1/inbox/history/media?id=wa_big1'); assert.match((await r.json()).message_ar, /5 ميجا/);
kvm.delete(mediaKey(T, 'wa_vid1'));
r = await get('/api/v1/inbox/history/media?id=wa_vid1'); assert.equal(r.status, 404); assert.equal((await r.json()).code, 'MEDIA_UNAVAILABLE');
// unsafe mime is never served inline (no HTML/SVG from the API origin)
db.prepare("UPDATE inbox_messages SET media_mime='text/html' WHERE id='wa_stk1'").run();
r = await get('/api/v1/inbox/history/media?id=wa_stk1'); assert.equal(r.headers.get('Content-Type'), 'application/octet-stream'); assert.match(r.headers.get('Content-Disposition'), /^attachment/);

// 4) bad base64 / oversize decode never caches and never drops the message
assert.equal(decodeBase64('***'), null); assert.equal(decodeBase64(''), null);
assert.equal(decodeBase64('A'.repeat(Math.ceil((MAX_MEDIA_BYTES + 10) / 3) * 4)), null);
[s, j] = await post([item({ id: 'bad64', type: 'image', media_id: 'X', mime_type: 'image/png', media_base64: '%%%not-base64' })]);
assert.deepEqual([j.added, j.cached], [1, 0]); assert.equal(row('wa_bad64').media_cached, 0);
// KV failure: message still stored, not cached
[s, j] = await post([item({ id: 'kvf', type: 'image', media_id: 'X', mime_type: 'image/png', media_base64: b64(PNG) })], { ...env, KV: { ...KV, async put() { throw new Error('kv down'); } } });
assert.deepEqual([j.added, j.cached], [1, 0]);

// 5) body cap: pharmacy-bot bridge accepts >= 8 MB (a 5 MB file ~ 6.7 MB JSON), still capped
assert.ok(MAX_BRIDGE_BODY >= 8 * 1024 * 1024);
const five = new Uint8Array(5 * 1024 * 1024); five[0] = 0xff; five[five.length - 1] = 0x01;
[s, j] = await post([item({ id: 'five', type: 'video', media_id: 'M5', mime_type: 'video/mp4', media_size: five.length, media_base64: b64(five) })]);
assert.deepEqual([s, j.added, j.cached], [200, 1, 1]);
assert.equal(kvm.get(mediaKey(T, 'wa_five')).length, five.length);
const huge = 'x'.repeat(MAX_BRIDGE_BODY + 1);
r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body: huge, headers: { Authorization: 'Bearer ' + TOK } }), env);
assert.equal(r.status, 413);

// 6) legacy queue path (DIRECT off): bytes go to KV at intake (not into the D1 queue row), processor fills the media columns
const qenv = { ...env, NOVA_WA_BRIDGE_DIRECT: undefined, WA_TENANT_MAP: JSON.stringify({ P1: 't9' }) };
[s, j] = await post([item({ id: 'q1', type: 'sticker', media_id: 'QS', mime_type: 'image/webp', media_base64: b64([1, 1]) }), item({ id: 'q2', type: 'audio', media_id: 'QA', media_skipped: 'too_large', media_size: 9e6 })], qenv);
assert.deepEqual([s, j.queued, j.skipped], [200, 2, 0]);
assert.ok(!db.prepare("SELECT payload_json p FROM wa_inbound_queue WHERE wa_message_id='q1'").get().p.includes(b64([1, 1])));
assert.ok(kvm.has(mediaKey('t9', 'wa_q1')));
assert.deepEqual(await processQueue(D1, makeProcessor(D1, qenv), { now: Number(nowS) + 10 }), { done: 2, retried: 0, dead: 0 });
const q1 = { ...db.prepare("SELECT media_type t, media_id i, media_mime m, media_cached c, text FROM inbox_messages WHERE tenant_id='t9' AND id='wa_q1'").get() };
assert.deepEqual(q1, { t: 'sticker', i: 'QS', m: 'image/webp', c: 1, text: '[ملصق]' });
const q2 = { ...db.prepare("SELECT media_type t, media_skipped k, media_size z, media_cached c FROM inbox_messages WHERE tenant_id='t9' AND id='wa_q2'").get() };
assert.deepEqual(q2, { t: 'audio', k: 'too_large', z: 9000000, c: 0 });

// 7) Meta webhook shape (no bytes) also maps every media type
for (const [t, want] of [['image', '[صورة]'], ['sticker', '[ملصق]'], ['audio', '[رسالة صوتية]'], ['video', '[فيديو]'], ['document', '[مستند]']]) assert.equal(messageText({ type: t, [t]: { id: 'm' } }), want);
assert.equal(messageText({ type: 'video', video: { caption: 'شوف' } }), '[فيديو] شوف');
assert.equal(messageText({ type: 'location' }), null);

// 8) no secrets in any response
for (const p of ['/api/v1/inbox/history/media?id=wa_big1', '/api/v1/inbox/history/conversations']) { const t = await (await get(p)).text(); assert.ok(!t.includes(TOK) && !t.includes(PIN)); }
console.log('backend-inbox-media check OK');
