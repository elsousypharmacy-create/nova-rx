// WhatsApp accepted a message from the API but failed to DELIVER it (Meta status "failed"): the pharmacy bot forwards a system note
// (direction "sys") and NOVA shows it in the chat. Run: node tests/unit/backend-wa-delivery-failed.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { kindOf } from '../../backend/src/inbox-history.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const TOK = 'a'.repeat(40), PIN = 'pin-123456789012';
const env = { NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_DIRECT: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, KV, NOVA_API_PIN: PIN };
const T = () => String(Math.floor(Date.now() / 1000));
const msg = (o) => ({ id: 'wamid.1', from: '201001', timestamp: T(), type: 'text', text: 'عايز بنادول', name: 'منى', phone_number_id: 'P1', direction: 'in', ...o });
const post = async (msgs, e = env) => { const r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: msgs }), headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' } }), e); return [r.status, await r.json()]; };
let ip = 0;
const thread = async (id) => { const r = await handle(new Request('https://x.test/api/v1/inbox/history/conversation?id=' + id, { headers: { 'X-Nova-Pin': PIN, 'CF-Connecting-IP': '10.3.0.' + (++ip) } }), env); return (await r.json()).conversation.messages; };
const sys = (o) => ({ id: 'fail_wamid.OUT1', from: '201001', timestamp: T(), type: 'status_failed', text: '⚠️ واتساب ما سلّمش رسالتك للعميل — الرقم مش على واتساب (131026)', direction: 'sys', ...o });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

await post([msg()]); // the conversation exists
await t('a delivery-failure note appears in the chat as a system line (kind sys), after the messages', async () => {
  const [s, j] = await post([sys()]); assert.equal(s, 200); assert.deepEqual([j.added, j.duplicates, j.skipped], [1, 0, 0]);
  const m = await thread('wa_201001'); const last = m.at(-1);
  assert.equal(last.kind, 'sys'); assert.equal(last.id, 'sf_fail_wamid.OUT1'); assert.ok(last.text.includes('131026')); assert.equal(m.length, 2);
  assert.equal(kindOf('sf_x', 'out'), 'sys'); assert.equal(kindOf('wb_x', 'out'), 'bot'); assert.equal(kindOf('ps_x', 'out'), 'pharm');
});
await t('the same failure delivered twice is stored once', async () => { const [, j] = await post([sys()]); assert.deepEqual([j.added, j.duplicates], [0, 1]); assert.equal((await thread('wa_201001')).filter((m) => m.kind === 'sys').length, 1); });
await t('a note for a chat NOVA does not know is skipped (a note never creates a conversation)', async () => {
  const [, j] = await post([sys({ id: 'fail_wamid.X', from: '209999' })]); assert.deepEqual([j.added, j.skipped], [0, 1]);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM inbox_conversations WHERE id = 'wa_209999'").get().c, 0);
});
await t('a sys item is never stored as a customer message, never triggers a push, never carries media or a customer name', async () => {
  const before = db.prepare("SELECT customer FROM inbox_conversations WHERE id = 'wa_201001'").get().customer;
  await post([sys({ id: 'fail_wamid.Y', name: 'اسم مزيّف', type: 'image', media_id: 'M1', media_base64: 'AAAA', mime_type: 'image/png' })]);
  const row = db.prepare("SELECT * FROM inbox_messages WHERE id = 'sf_fail_wamid.Y'").get();
  assert.equal(row.dir, 'out'); assert.equal(row.media_type, null); assert.equal(row.media_cached, null);
  assert.equal(db.prepare("SELECT customer FROM inbox_conversations WHERE id = 'wa_201001'").get().customer, before, 'name untouched');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM inbox_messages WHERE dir = 'in' AND id LIKE 'wa\\_%' ESCAPE '\\'").get().c, 1, 'still just the one real customer message');
});
await t('long text is capped at 500 characters and empty text is skipped', async () => {
  await post([sys({ id: 'fail_wamid.Z', text: 'ا'.repeat(2000) })]); assert.equal(db.prepare("SELECT text FROM inbox_messages WHERE id = 'sf_fail_wamid.Z'").get().text.length, 500);
  const [, j] = await post([sys({ id: 'fail_wamid.E', text: '' })]); assert.deepEqual([j.added, j.skipped], [0, 1]);
});
await t('legacy queue path (direct write off): a sys item is skipped, never queued as an incoming message', async () => {
  const [s, j] = await post([sys({ id: 'fail_wamid.Q' })], { ...env, NOVA_WA_BRIDGE_DIRECT: undefined }); assert.equal(s, 200); assert.equal(j.skipped, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM wa_inbound_queue").get().c, 0, 'nothing queued');
});
await t('a failure note is not an unanswered customer message (the chat is not counted as waiting)', async () => {
  const m = await thread('wa_201001'); assert.ok(m.at(-1).dir === 'out' && m.at(-1).kind === 'sys');
});
console.log(`PASS delivery failed note: ${n} cases`);
