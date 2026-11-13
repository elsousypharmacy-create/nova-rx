import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { waIntakeEnabled, hmacSha256Hex, processQueue, MAX_ATTEMPTS } from '../../backend/src/whatsapp-intake.js';
import { handle } from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
const SECRET = 's3cret-test', env = { NOVA_WA_INTAKE: '1', WA_APP_SECRET: SECRET, WA_VERIFY_TOKEN: 'vt', DB: D1 };
const url = 'https://x.test/api/v1/webhooks/whatsapp';
const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'p' }, messages: [{ id: 'wamid.1', text: { body: 'hi' } }, { id: 'wamid.2' }] } }] }] });
const sig = async (b, s = SECRET) => 'sha256=' + await hmacSha256Hex(s, b);
const post = async (b, h, e = env) => handle(new Request(url, { method: 'POST', body: b, headers: h }), e);

// flag default OFF
assert.equal(waIntakeEnabled({}), false);
let r = await post(body, { 'X-Hub-Signature-256': await sig(body) }, { WA_APP_SECRET: SECRET, DB: D1 });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'WA_INTAKE_DISABLED');
assert.equal((await handle(new Request(url + '?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=1'), {})).status, 404);

// GET verify
r = await handle(new Request(url + '?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc123'), env);
assert.equal(r.status, 200); assert.equal(await r.text(), 'abc123');
r = await handle(new Request(url + '?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1'), env);
assert.equal(r.status, 403); assert.equal((await r.json()).code, 'WA_VERIFY_FAILED');

// signature
r = await post(body, {}); assert.equal(r.status, 401);
r = await post(body, { 'X-Hub-Signature-256': await sig(body, 'wrong') }); assert.equal(r.status, 401);
let j = await r.json(); assert.equal(j.code, 'WA_BAD_SIGNATURE'); assert.match(j.requestId, /^req_/); assert.match(j.message_ar, /[؀-ۿ]/);
assert.equal(db.prepare('SELECT COUNT(*) c FROM wa_inbound_queue').get().c, 0);

// intake + dedup
r = await post(body, { 'X-Hub-Signature-256': await sig(body) }); j = await r.json();
assert.equal(r.status, 200); assert.equal(j.queued, 2); assert.equal(j.duplicates, 0);
r = await post(body, { 'X-Hub-Signature-256': await sig(body) }); j = await r.json();
assert.equal(j.queued, 0); assert.equal(j.duplicates, 2);
assert.equal(db.prepare('SELECT COUNT(*) c FROM wa_inbound_queue').get().c, 2);
const bad = '{not json'; r = await post(bad, { 'X-Hub-Signature-256': await sig(bad) }); assert.equal(r.status, 400);

// processing: wamid.1 ok, wamid.2 always fails -> retry w/ backoff then dead-letter
const seen = [];
const proc = async (p) => { seen.push(p.message.id); if (p.message.id === 'wamid.2') throw new Error('mock fail'); };
let t = 1000;
let s = await processQueue(D1, proc, { now: t });
assert.deepEqual(s, { done: 1, retried: 1, dead: 0 });
s = await processQueue(D1, proc, { now: t }); // not due yet
assert.deepEqual(s, { done: 0, retried: 0, dead: 0 });
for (let i = 1; i < MAX_ATTEMPTS; i++) { t += 4000; s = await processQueue(D1, proc, { now: t }); }
assert.equal(s.dead, 1);
const row = db.prepare("SELECT status, attempts, last_error FROM wa_inbound_queue WHERE wa_message_id='wamid.2'").get();
assert.equal(row.status, 'dead'); assert.equal(row.attempts, MAX_ATTEMPTS); assert.equal(row.last_error, 'mock fail');
assert.equal(db.prepare("SELECT status FROM wa_inbound_queue WHERE wa_message_id='wamid.1'").get().status, 'done');
assert.equal(seen.filter((x) => x === 'wamid.1').length, 1);
console.log('backend-whatsapp-intake: OK');
