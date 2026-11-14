import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { processQueue } from '../../backend/src/whatsapp-intake.js';
import { makeProcessor } from '../../backend/src/whatsapp-process.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
const TOK = 'a'.repeat(40), SESS = 'c'.repeat(40);
await KV.put('sess:' + (await sha256Hex(SESS)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' }));

const url = 'https://x.test/api/v1/webhooks/whatsapp-bridge';
const env = { NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, WA_TENANT_MAP: JSON.stringify({ P1: 't1' }) };
const item = (o) => ({ id: 'wamid.1', from: '201001', timestamp: '1700000000', type: 'text', text: 'عايز بنادول', media_id: null, filename: null, name: 'منى', phone_number_id: 'P1', direction: 'in', ...o });
const payload = (...m) => JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: m });
const post = async (b, tok = TOK, e = env) => { const r = await handle(new Request(url, { method: 'POST', body: b, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } }), e); return [r.status, await r.json()]; };
const queued = () => db.prepare('SELECT COUNT(*) c FROM wa_inbound_queue').get().c;

// flag off -> 404; flag not "1" -> 404
let [s, j] = await post(payload(item()), TOK, { ...env, NOVA_WA_BRIDGE_INTAKE: undefined });
assert.equal(s, 404); assert.equal(j.code, 'WA_INTAKE_DISABLED');
[s] = await post(payload(item()), TOK, { ...env, NOVA_WA_BRIDGE_INTAKE: 'true' }); assert.equal(s, 404);

// auth: secret missing / short, token missing / wrong / short
[s, j] = await post(payload(item()), TOK, { ...env, NOVA_WA_BRIDGE_TOKEN: undefined }); assert.equal(s, 503); assert.equal(j.code, 'WA_BRIDGE_NOT_CONFIGURED');
[s] = await post(payload(item()), 'short', { ...env, NOVA_WA_BRIDGE_TOKEN: 'short' }); assert.equal(s, 503);
[s, j] = await post(payload(item()), null); assert.equal(s, 401); assert.equal(j.code, 'WA_BRIDGE_UNAUTHORIZED');
[s] = await post(payload(item()), 'b'.repeat(40)); assert.equal(s, 401);
[s] = await post(payload(item()), 'a'.repeat(39)); assert.equal(s, 401);
assert.equal(queued(), 0);

// bad input
[s, j] = await post('{nope'); assert.equal(s, 400); assert.equal(j.code, 'WA_BAD_JSON');
[s] = await post('{"messages":"x"}'); assert.equal(s, 400);
[s] = await post(payload(item({ id: '' }))); assert.equal(s, 400);
[s] = await post(payload(item({ from: 5 }))); assert.equal(s, 400);
[s] = await post('x'.repeat(1024 * 1024 + 1)); assert.equal(s, 413);
[s] = await post(payload(item()), TOK, { ...env, DB: undefined }); assert.equal(s, 503);
assert.equal(queued(), 0);

// intake: text + image + document, out skipped, unrepresentable (audio, no text) skipped, dedupe
const batch = payload(
  item(),
  item({ id: 'wamid.2', type: 'image', text: 'صورة روشتة', media_id: 'M1' }),
  item({ id: 'wamid.3', type: 'document', text: null, filename: 'rx.pdf', media_id: 'M2' }),
  item({ id: 'wamid.4', direction: 'out' }),
  item({ id: 'wamid.5', type: 'audio', text: null, media_id: 'M3' }),
);
[s, j] = await post(batch);
assert.deepEqual([s, j.ok, j.queued, j.duplicates, j.skipped], [200, true, 3, 0, 2]);
assert.match(j.requestId, /^req_/);
[s, j] = await post(batch); assert.deepEqual([j.queued, j.duplicates, j.skipped], [0, 3, 2]);
assert.equal(queued(), 3);
const stored = JSON.parse(db.prepare("SELECT payload_json p FROM wa_inbound_queue WHERE wa_message_id='wamid.1'").get().p);
assert.deepEqual(stored, { message: { id: 'wamid.1', from: '201001', timestamp: '1700000000', type: 'text', text: { body: 'عايز بنادول' } }, metadata: { phone_number_id: 'P1', contacts: [{ profile: { name: 'منى' } }] } });

// end-to-end: existing processor turns the queue into inbox messages (tenant from WA_TENANT_MAP)
const st = await processQueue(D1, makeProcessor(D1, env), { now: 5000 });
assert.deepEqual(st, { done: 3, retried: 0, dead: 0 });
const rows = db.prepare("SELECT id, dir, text, at FROM inbox_messages WHERE tenant_id='t1' ORDER BY id").all();
assert.deepEqual(rows.map((r) => [r.id, r.dir, r.text]), [['wa_wamid.1', 'in', 'عايز بنادول'], ['wa_wamid.2', 'in', '[صورة] صورة روشتة'], ['wa_wamid.3', 'in', '[مستند] rx.pdf']]);
assert.equal(rows[0].at, 1700000000);
assert.equal(db.prepare("SELECT customer FROM inbox_conversations WHERE id='wa_201001'").get().customer, 'منى');

// auto-reply proxy
const ENV2 = { NOVA_INBOX: '1', DB: D1, KV, WA_BACKEND_URL: 'https://script.google.com/macros/s/AKx/exec', NOVA_WA_BRIDGE_TOKEN: TOK };
const calls = []; let upstream = { ok: true, autoReply: true }, upStatus = 200;
const NOVA_FETCH = async (u, o) => { calls.push([u, JSON.parse(o.body)]); return new Response(JSON.stringify(upstream), { status: upStatus }); };
const ar = async (method, body, tok = SESS, e = { ...ENV2, NOVA_FETCH }) => { const r = await handle(new Request('https://x.test/api/v1/whatsapp/auto-reply', { method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), e); return [r.status, await r.json()]; };
[s, j] = await ar('GET', null, SESS, { ...ENV2, NOVA_INBOX: undefined, NOVA_FETCH }); assert.equal(s, 404); assert.equal(j.code, 'INBOX_DISABLED');
[s] = await ar('GET', null, null); assert.equal(s, 401);
[s, j] = await ar('GET'); assert.deepEqual([s, j.ok, j.autoReply], [200, true, true]);
assert.deepEqual(calls[0], [ENV2.WA_BACKEND_URL, { action: 'novaWhatsAppBridge', bridgeToken: TOK, operation: 'autoReplyGet' }]);
upstream = { ok: true, autoReply: false };
[s, j] = await ar('POST', { enabled: false }); assert.deepEqual([s, j.autoReply], [200, false]);
assert.deepEqual(calls[1][1], { action: 'novaWhatsAppBridge', bridgeToken: TOK, operation: 'autoReplySet', enabled: false });
[s, j] = await ar('POST', { enabled: 'yes' }); assert.equal(s, 400); assert.equal(calls.length, 2);
assert.ok(!JSON.stringify(j).includes(TOK));
// not configured -> fail closed (Arabic), no upstream call
for (const e of [{ ...ENV2, WA_BACKEND_URL: undefined }, { ...ENV2, NOVA_WA_BRIDGE_TOKEN: 'short' }]) {
  [s, j] = await ar('GET', null, SESS, { ...e, NOVA_FETCH }); assert.equal(s, 503); assert.equal(j.code, 'WA_AUTOREPLY_NOT_CONFIGURED'); assert.match(j.message_ar, /[؀-ۿ]/);
}
assert.equal(calls.length, 2);
// upstream failures
upStatus = 500; [s, j] = await ar('GET'); assert.equal(s, 502); upStatus = 200;
upstream = { ok: false }; [s] = await ar('GET'); assert.equal(s, 502);
[s, j] = await ar('GET', null, SESS, { ...ENV2, NOVA_FETCH: async () => { throw new Error('boom ' + TOK); } }); assert.equal(s, 502); assert.ok(!JSON.stringify(j).includes(TOK));
console.log('ok backend-whatsapp-bridge');
