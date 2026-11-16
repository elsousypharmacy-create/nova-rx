// UX406: Web Push for new inbound WhatsApp messages: subscription register/unregister (KV), payload shaping,
// RFC 8291 encryption round-trip, RFC 8292 VAPID JWT, bridge ingest -> push via waitUntil (non-blocking), gone subscriptions removed.
// Keys are generated in-process for the test only (never real secrets). No network: the push fetch is injected.
// Run: node --no-warnings tests/unit/backend-inbox-push.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { pushPayload, encryptPayload, vapidAuth, cleanSubscription, b64u, unb64u, pushConfigured, MAX_SUBS, SUB_PREFIX } from '../../backend/src/inbox-push.js';

let n = 0; const ok = (name) => { n++; console.log('ok', name); };
const S = crypto.subtle, te = new TextEncoder();
const gen = (alg) => S.generateKey({ name: alg, namedCurve: 'P-256' }, true, alg === 'ECDH' ? ['deriveBits'] : ['sign', 'verify']);

// VAPID test keys (ephemeral)
const vk = await gen('ECDSA');
const vjwk = await S.exportKey('jwk', vk.privateKey);
const VPUB = b64u(new Uint8Array(await S.exportKey('raw', vk.publicKey)));
// browser (user agent) subscription keys
const ua = await gen('ECDH');
const uaPub = new Uint8Array(await S.exportKey('raw', ua.publicKey));
const AUTH = crypto.getRandomValues(new Uint8Array(16));
const SUB = (ep = 'https://fcm.googleapis.com/fcm/send/abc123') => ({ endpoint: ep, keys: { p256dh: b64u(uaPub), auth: b64u(AUTH) } });

async function hkdf(salt, ikm, info, len) { const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
const cat = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
// Independent RFC 8291 decryption (what the browser does)
async function decrypt(body) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asKey = await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(AUTH, secret, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(pt[pt.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(pt.slice(0, -1));
}

// 1) payload shaping
{
  assert.equal(pushPayload([]), null); assert.equal(pushPayload(null), null);
  const p1 = pushPayload([{ cid: 'wa_2010', name: 'منى', text: 'عايزة   بنادول\nلو سمحت', at: 5 }]);
  assert.deepEqual(p1, { v: 1, kind: 'wa-in', title: 'منى', body: 'عايزة بنادول لو سمحت', chat: 'wa_2010', chats: ['wa_2010'], count: 1, at: 5, tag: 'nova-wa-wa_2010' });
  const p2 = pushPayload([{ cid: 'wa_1', name: 'أ', text: 'x', at: 1 }, { cid: 'wa_1', name: 'أ', text: 'آخر رسالة', at: 2 }]);
  assert.equal(p2.body, '(2) آخر رسالة'); assert.equal(p2.chat, 'wa_1'); assert.equal(p2.count, 2);
  const p3 = pushPayload([{ cid: 'wa_1', text: 'a' }, { cid: 'wa_2', text: 'b' }, { cid: 'wa_1', text: 'c' }]);
  assert.deepEqual([p3.title, p3.body, p3.chat, p3.tag, p3.chats], ['رسائل واتساب جديدة', '3 رسائل جديدة من 2 محادثات', null, 'nova-wa', ['wa_1', 'wa_2']]);
  const long = pushPayload([{ cid: 'wa_9', name: '', text: 'ب'.repeat(500) }]);
  assert.equal(Array.from(long.body).length, 120); assert.ok(long.body.endsWith('…')); assert.equal(long.title, 'عميل واتساب');
  assert.ok(JSON.stringify(long).length < 1024);
  ok('payload shaping (single chat, multi-message, multi-chat, trimmed, < 1 KB)');
}

// 2) subscription validation (SSRF guard)
{
  assert.ok(cleanSubscription(SUB()));
  for (const ep of ['http://fcm.googleapis.com/x', 'https://evil.test/x', 'https://fcm.googleapis.com.evil.test/x', 'https://u:p@fcm.googleapis.com/x', 'not a url'])
    assert.equal(cleanSubscription(SUB(ep)), null, ep);
  assert.ok(cleanSubscription(SUB('https://updates.push.services.mozilla.com/wpush/v2/x')));
  assert.ok(cleanSubscription(SUB('https://web.push.apple.com/abc')));
  assert.equal(cleanSubscription({ ...SUB(), keys: { p256dh: 'AAAA', auth: b64u(AUTH) } }), null);
  assert.equal(cleanSubscription({ endpoint: SUB().endpoint }), null);
  ok('subscription validation (push-service hosts only, key lengths)');
}

// 3) encryption round-trip + VAPID JWT
{
  const msg = JSON.stringify(pushPayload([{ cid: 'wa_1', name: 'منى', text: 'سلام', at: 1 }]));
  const body = await encryptPayload(SUB(), msg);
  assert.equal(await decrypt(body), msg);
  const body2 = await encryptPayload(SUB(), msg);
  assert.notDeepEqual(body.slice(0, 16), body2.slice(0, 16), 'fresh salt per message');
  const env = { VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vjwk.d };
  assert.ok(pushConfigured(env)); assert.ok(!pushConfigured({})); assert.ok(!pushConfigured({ VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: 'short' }));
  const now = Date.UTC(2026, 10, 15);
  const h = await vapidAuth(env, 'https://fcm.googleapis.com/fcm/send/abc', now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m); assert.equal(m[4], VPUB);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.deepEqual([claims.aud, claims.exp, /^https:/.test(claims.sub)], ['https://fcm.googleapis.com', now / 1000 + 43200, true]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(m[1]))), { typ: 'JWT', alg: 'ES256' });
  assert.ok(await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk.publicKey, unb64u(m[3]), te.encode(m[1] + '.' + m[2])), 'ES256 signature verifies');
  assert.ok(!h.includes(vjwk.d), 'private key never in the header');
  ok('RFC 8291 aes128gcm round-trip + RFC 8292 VAPID ES256 JWT');
}

// 4) routes + bridge ingest hook
const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); },
  async list({ prefix, limit }) { return { keys: [...kvm.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }; } };
const sent = []; let pushStatus = 201;
const NOVA_PUSH_FETCH = async (u, o) => { sent.push({ u, o }); if (pushStatus === 'throw') throw new Error('net'); return { status: pushStatus }; };
const TOK = 'a'.repeat(40);
const PIN = 'pin-123456789012';
const env = { NOVA_ENV: 'staging', NOVA_API_PIN: PIN, NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_DIRECT: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, KV, VAPID_PUBLIC_KEY: VPUB, VAPID_PRIVATE_KEY: vjwk.d, NOVA_PUSH_FETCH };
const api = async (path, body, e = env, pin = PIN) => { const hh = pin ? { 'X-Nova-Pin': pin } : {}; const r = await handle(new Request('https://x.test/api/v1/inbox/history/push/' + path, body === undefined ? { headers: hh } : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...hh } }), e); return [r.status, await r.json()]; };
const subs = () => [...kvm.keys()].filter((k) => k.startsWith(SUB_PREFIX));
{
  let [s, j] = await api('key');
  assert.deepEqual([s, j.enabled, j.publicKey], [200, true, VPUB]);
  assert.ok(!JSON.stringify(j).includes(vjwk.d));
  [s, j] = await api('key', undefined, { ...env, VAPID_PRIVATE_KEY: undefined });
  assert.deepEqual([s, j.enabled, j.publicKey], [200, false, null]);
  [s, j] = await api('subscribe', { subscription: SUB() }, { ...env, VAPID_PUBLIC_KEY: undefined });
  assert.deepEqual([s, j.code], [503, 'PUSH_NOT_CONFIGURED']);
  [s, j] = await api('subscribe', { subscription: SUB('https://evil.test/x') });
  assert.deepEqual([s, j.code], [400, 'PUSH_BAD_SUBSCRIPTION']);
  [s, j] = await api('subscribe', { subscription: SUB() });
  assert.deepEqual([s, j.subscribed], [200, true]);
  [s, j] = await api('subscribe', { subscription: SUB() }); // idempotent per device
  assert.equal(subs().length, 1);
  assert.ok(!subs()[0].includes('abc123'), 'KV key is a hash, not the endpoint');
  [s, j] = await api('subscribe', { subscription: SUB('https://fcm.googleapis.com/fcm/send/second') });
  assert.equal(subs().length, 2);
  [s, j] = await api('unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/second' });
  assert.deepEqual([s, j.subscribed, subs().length], [200, false, 1]);
  [s, j] = await api('unsubscribe', {});
  assert.equal(s, 400);
  // S1-01: PIN-gated in every env (staging included)
  [s, j] = await api('key', undefined, { ...env, NOVA_ENV: 'production' }, null); assert.equal(s, 401);
  [s, j] = await api('key', undefined, env, null); assert.equal(s, 401);
  [s, j] = await api('subscribe', { subscription: SUB() }, env, null); assert.equal(s, 401);
  // per-tenant cap
  for (let i = 0; i < MAX_SUBS + 2; i++) await api('subscribe', { subscription: SUB('https://fcm.googleapis.com/fcm/send/cap' + i) });
  assert.equal(subs().length, MAX_SUBS);
  [s, j] = await api('subscribe', { subscription: SUB('https://fcm.googleapis.com/fcm/send/over') });
  assert.deepEqual([s, j.code], [409, 'PUSH_LIMIT']);
  for (const k of subs()) if (!kvm.get(k).includes('abc123')) kvm.delete(k);
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint NOT LIKE '%abc123'").run(); // UX414: D1 mirror of the KV cleanup
  assert.equal(subs().length, 1);
  ok('push routes: key, subscribe (validated, idempotent, capped), unsubscribe, gate');
}

const post = async (msgs, e = env, ec) => {
  const waits = [];
  const r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: msgs }), headers: { Authorization: 'Bearer ' + TOK } }), e, ec === undefined ? { waitUntil: (p) => waits.push(p) } : ec);
  const j = await r.json(); await Promise.all(waits); return [r.status, j, waits.length];
};
const item = (o) => ({ id: 'wamid.p1', from: '201001', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: 'عايز بنادول', name: 'منى', direction: 'in', ...o });
{
  let [s, j, w] = await post([item()]);
  assert.deepEqual([s, j.added, w, sent.length], [200, 1, 1, 1]);
  const { u, o } = sent[0];
  assert.equal(u, 'https://fcm.googleapis.com/fcm/send/abc123');
  assert.deepEqual([o.method, o.headers['Content-Encoding'], o.headers.TTL, o.headers.Urgency], ['POST', 'aes128gcm', '21600', 'high']);
  assert.match(o.headers.Authorization, /^vapid t=.+, k=/);
  const p = JSON.parse(await decrypt(o.body));
  assert.deepEqual([p.title, p.body, p.chat, p.count], ['منى', 'عايز بنادول', 'wa_201001', 1]);
  // duplicate / outbound (bot reply) never notify
  [s, j, w] = await post([item(), item({ id: 'wamid.out1', direction: 'out', text: 'أهلاً' })]);
  assert.deepEqual([j.duplicates, j.added, w, sent.length], [1, 1, 0, 1]);
  // several inbound in one batch => one push
  [s, j, w] = await post([item({ id: 'wamid.p2', text: 'ألو' }), item({ id: 'wamid.p3', from: '201002', name: 'سعيد', text: 'صباح الخير' })]);
  assert.deepEqual([j.added, w, sent.length], [2, 1, 2]);
  assert.equal(JSON.parse(await decrypt(sent[1].o.body)).body, '2 رسائل جديدة من 2 محادثات');
  ok('bridge ingest -> one encrypted push after the rows are written; duplicates/outbound silent');
}
{
  // push failure never blocks or fails the ingest
  pushStatus = 'throw';
  let [s, j] = await post([item({ id: 'wamid.p4' })]);
  assert.deepEqual([s, j.ok, j.added], [200, true, 1]);
  pushStatus = 500;
  [s, j] = await post([item({ id: 'wamid.p5' })]);
  assert.deepEqual([s, j.added, subs().length], [200, 1, 1]);
  // a gone subscription (410) is removed
  pushStatus = 410;
  [s, j] = await post([item({ id: 'wamid.p6' })]);
  assert.deepEqual([s, j.added, subs().length], [200, 1, 0]);
  // not configured => no push call at all; rows still written
  const before = sent.length; pushStatus = 201;
  await api('subscribe', { subscription: SUB() });
  [s, j] = await post([item({ id: 'wamid.p7' })], { ...env, VAPID_PRIVATE_KEY: undefined });
  assert.deepEqual([s, j.added, sent.length], [200, 1, before]);
  // no ExecutionContext (tests/local) => still answers, push runs detached
  [s, j] = await post([item({ id: 'wamid.p8' })], env, null);
  assert.deepEqual([s, j.added], [200, 1]);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, before + 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE id LIKE 'wa_wamid.p%'").get().n, 8);
  ok('push errors/500/410/not-configured/no-ctx never block message writes');
}

// UX414: D1 push_subscriptions (migration 0025) is the primary store; KV is the fallback
{
  const rows = () => db.prepare('SELECT * FROM push_subscriptions').all();
  db.prepare('DELETE FROM push_subscriptions').run(); kvm.clear(); sent.length = 0; pushStatus = 201;
  let [s, j] = await api('subscribe', { subscription: SUB() });
  assert.deepEqual([s, j.subscribed, rows().length], [200, true, 1]);
  assert.equal(rows()[0].endpoint, SUB().endpoint); assert.ok(!rows()[0].id.includes('abc123'), 'id is a hash');
  await api('subscribe', { subscription: SUB() }); assert.equal(rows().length, 1, 'idempotent');
  await api('subscribe', { subscription: SUB('https://fcm.googleapis.com/fcm/send/two') });
  assert.equal(rows().length, 2);
  await api('unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/two' });
  assert.deepEqual([rows().length, subs().length], [1, 1], 'unsubscribe removes from D1 and KV');
  // D1-only (no KV binding) still subscribes, notifies, and deletes on 410
  const noKv = { ...env, KV: undefined };
  let r = await post([item({ id: 'wamid.d1a' })], noKv);
  assert.deepEqual([r[0], r[1].added, sent.length], [200, 1, 1]);
  assert.equal(JSON.parse(await decrypt(sent[0].o.body)).title, 'منى');
  pushStatus = 404; r = await post([item({ id: 'wamid.d1b' })], noKv);
  assert.deepEqual([rows().length], [0], '404 deletes the D1 row');
  // KV-only fallback (no DB binding)
  pushStatus = 201; sent.length = 0;
  await api('subscribe', { subscription: SUB() }, { ...env, DB: undefined });
  assert.deepEqual([rows().length, subs().length], [0, 1]);
  r = await post([item({ id: 'wamid.d1c' })], env); // env has DB: KV subscription is still found
  assert.equal(sent.length, 1);
  pushStatus = 410; await post([item({ id: 'wamid.d1d' })], env);
  assert.deepEqual([rows().length, subs().length], [0, 0], '410 deletes KV-only subscriptions too');
  // DB without the migrated table never breaks subscribe (falls back to KV)
  const badDb = { prepare: () => { throw new Error('no such table'); } };
  [s, j] = await api('subscribe', { subscription: SUB() }, { ...env, DB: badDb });
  assert.deepEqual([s, j.subscribed, subs().length], [200, true, 1]);
  ok('UX414 D1 storage: subscribe/unsubscribe, D1-only notify, 404/410 deletion, KV fallback, unmigrated D1 safe');
}
console.log('ALL PASS', n);
