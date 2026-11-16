// A reply sent from NOVA is also forwarded by the bot as wb_<wamid>: only one row may remain, in either order.
// Run: node tests/unit/backend-wa-dedupe.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const TOK = 'a'.repeat(40), PIN = 'pin-123456789012';
let hook = null; // runs inside the bot "reply" call, i.e. before /send inserts its own row
const NOVA_FETCH = async (u, o) => { const p = JSON.parse(o.body); if (p.operation === 'reply' && hook) await hook(p); return { ok: true, status: 200, async json() { return { ok: true }; } }; };
const env = { NOVA_WA_BRIDGE_INTAKE: '1', NOVA_WA_BRIDGE_DIRECT: '1', NOVA_WA_BRIDGE_TOKEN: TOK, DB: D1, KV, NOVA_API_PIN: PIN, NOVA_INBOX_SEND: '1', WA_BACKEND_URL: 'https://script.test/exec', NOVA_FETCH };
const now = () => String(Math.floor(Date.now() / 1000));
const item = (o) => ({ id: 'wamid.1', from: '201001', timestamp: now(), type: 'text', text: 'hi', name: 'منى', phone_number_id: 'P1', direction: 'in', ...o });
const post = async (msgs) => { const r = await handle(new Request('https://x.test/api/v1/webhooks/whatsapp-bridge', { method: 'POST', body: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: msgs }), headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' } }), env); return [r.status, await r.json()]; };
let ip = 0;
const api = async (path, init = {}) => { const r = await handle(new Request('https://x.test' + path, { ...init, headers: { 'X-Nova-Pin': PIN, 'CF-Connecting-IP': '10.2.0.' + (++ip), 'Content-Type': 'application/json' } }), env); return [r.status, await r.json()]; };
const outs = () => db.prepare("SELECT id, text FROM inbox_messages WHERE conversation_id = 'wa_201001' AND dir = 'out' ORDER BY rowid").all();

await post([item()]);
// 1) forward arrives first (during the bot call), then /send stores ps_: one row left, the ps_ one
hook = async (p) => { await post([item({ id: 'wamid.out1', direction: 'out', text: p.text })]); };
let [s, j] = await api('/api/v1/inbox/history/send', { method: 'POST', body: JSON.stringify({ id: 'wa_201001', text: 'تمام' }) });
assert.equal(s, 200, JSON.stringify(j));
assert.deepEqual(outs().map((r) => [r.id.slice(0, 3), r.text]), [['ps_', 'تمام']]);
// 2) /send stores ps_ first, the forward arrives later: it is skipped
hook = null;
[s, j] = await api('/api/v1/inbox/history/send', { method: 'POST', body: JSON.stringify({ id: 'wa_201001', text: 'حاضر' }) });
assert.equal(s, 200);
[s, j] = await post([item({ id: 'wamid.out2', direction: 'out', text: 'حاضر' })]);
assert.deepEqual([j.added, j.duplicates], [0, 1]);
assert.equal(outs().filter((r) => r.text === 'حاضر').length, 1);
// 3) a bot reply with other text is still stored
[s, j] = await post([item({ id: 'wamid.out3', direction: 'out', text: 'رد تاني' })]);
assert.equal(j.added, 1);
assert.deepEqual(outs().map((r) => r.id.slice(0, 3)), ['ps_', 'ps_', 'wb_']);
console.log('backend-wa-dedupe: all passed');
