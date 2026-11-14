import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { enqueue, MAX_ATTEMPTS } from '../../backend/src/whatsapp-intake.js';
import { scheduledWaProcess } from '../../backend/src/whatsapp-process.js';
import { handle } from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const env = { NOVA_WA_INTAKE: '1', DB: D1, WA_TENANT_MAP: JSON.stringify({ P1: 't1' }) };
const md = (pid) => ({ phone_number_id: pid });
const q = (id, message, pid = 'P1') => enqueue(D1, [{ id, message: { id, from: '966500', ...message }, metadata: md(pid) }]);
const count = (t) => db.prepare('SELECT COUNT(*) c FROM inbox_messages' + (t ? ' WHERE tenant_id=?' : '')).get(...(t ? [t] : [])).c;

// flag off: hook does nothing
await q('w1', { type: 'text', text: { body: 'hello' } });
assert.equal(await scheduledWaProcess({ ...env, NOVA_WA_INTAKE: undefined }, { now: 1000 }), null);
assert.equal(count(), 0);
assert.equal(db.prepare("SELECT status FROM wa_inbound_queue WHERE wa_message_id='w1'").get().status, 'pending');
assert.equal((await handle(new Request('https://x.test/api/v1/webhooks/whatsapp', { method: 'POST', body: '{}' }), { DB: D1 })).status, 404);

// text + image + document
await q('w2', { type: 'image', image: { caption: 'cap' } });
await q('w3', { type: 'document', document: { filename: 'rx.pdf' } });
let s = await scheduledWaProcess(env, { now: 1000 });
assert.deepEqual(s, { done: 3, retried: 0, dead: 0 });
assert.equal(count('t1'), 3);
assert.equal(db.prepare('SELECT COUNT(*) c FROM inbox_conversations WHERE tenant_id=?').get('t1').c, 1);
assert.ok(db.prepare("SELECT 1 FROM inbox_messages WHERE id='wa_w1'").get());

// duplicate id is a no-op (re-queue forced, processed again)
const r = await q('w1', { type: 'text', text: { body: 'hello' } });
assert.equal(r.duplicates, 1);
db.prepare("UPDATE wa_inbound_queue SET status='pending' WHERE wa_message_id='w1'").run();
s = await scheduledWaProcess(env, { now: 2000 });
assert.equal(s.done, 1); assert.equal(count('t1'), 3);

// bad payload + unknown phone id: retry then dead-letter; no cross-tenant write
await q('bad1', { type: 'sticker' });
await q('unk1', { type: 'text', text: { body: 'x' } }, 'NOPE');
let t = 3000;
s = await scheduledWaProcess(env, { now: t });
assert.deepEqual(s, { done: 0, retried: 2, dead: 0 });
for (let i = 1; i < MAX_ATTEMPTS; i++) { t += 4000; s = await scheduledWaProcess(env, { now: t }); }
assert.equal(s.dead, 2);
for (const id of ['bad1', 'unk1']) assert.equal(db.prepare('SELECT status FROM wa_inbound_queue WHERE wa_message_id=?').get(id).status, 'dead');
assert.equal(count(), 3);
assert.equal(db.prepare("SELECT last_error e FROM wa_inbound_queue WHERE wa_message_id='unk1'").get().e, 'WA_UNKNOWN_PHONE_NUMBER_ID');
console.log('backend-whatsapp-process: OK');
