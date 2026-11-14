// UX200: WhatsApp Web layout, bubble direction, date separators, badge count, idempotent additive history backfill (local + D1).
// Run: node tests/unit/ux200-wa-chat.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { backfillSheetRows, backfillFromQueue, normalizeSheetRow } from '../../backend/src/inbox-backfill.js';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); } }; };
const NOW = new Date(2026, 10, 14, 15, 0).getTime(), D = 86400000;
const rows = [
  { conv: '201001', customer: 'منى', id: 'a1', dir: 'in', text: 'عايزة دوا', at: NOW - 2 * D },
  { conv: '201001', id: 'a2', dir: 'out', text: 'تمام', at: NOW - D, status: 'delivered' },
  { conv: '201001', id: 'a3', dir: 'in', text: 'شكرا', at: NOW - 60000 },
  { conv: '201002', customer: 'أحمد', id: 'b1', dir: 'in', text: 'هل متوفر؟', at: NOW - 5000 },
  { conv: '201003', id: 'c1', dir: 'out', text: 'تم الإرسال', at: NOW - 9000, status: 'read' },
];
// local backfill: additive + idempotent
const st = mem(), inbox = U.create(st).load();
assert.deepEqual(inbox.importHistory(rows), { added: 5, skipped: 0 });
assert.deepEqual(inbox.importHistory(rows), { added: 0, skipped: 5 });
assert.equal(inbox.list().length, 3);
assert.equal(inbox.get('201001').messages.length, 3);
assert.deepEqual(inbox.get('201001').messages.map((m) => m.id), ['a1', 'a2', 'a3']);
assert.equal(U.create(st).load().list().length, 3, 'persisted');
// badge: conversations whose trailing messages are incoming
assert.equal(U.unreadCount(inbox.get('201001')), 1);
assert.equal(U.unreadCount(inbox.get('201003')), 0);
assert.equal(U.totalUnread(inbox.list()), 2);
// layout markers + direction + separators
const html = U.renderWa(inbox.list(), { selected: '201001', now: NOW, sendEnabled: false });
for (const mk of ['wa-root', 'wa-side', 'wa-search', 'wa-list', 'wa-main', 'wa-head', 'wa-composer', 'wa-avatar', 'wa-badge', '#0f4a3c', 'dir="rtl"', 'max-width:700px']) assert.ok(html.includes(mk), 'marker ' + mk);
const msgDirs = [...html.matchAll(/class="wa-msg wa-(in|out)" data-dir="(in|out)" data-mid="(\w+)"/g)].map((m) => [m[1], m[2], m[3]]);
assert.deepEqual(msgDirs, [['in', 'in', 'a1'], ['out', 'out', 'a2'], ['in', 'in', 'a3']]);
assert.deepEqual([...html.matchAll(/data-date-sep><span>([^<]+)</g)].map((m) => m[1]), ['2026/11/12', 'أمس', 'اليوم']);
assert.ok(html.includes('data-tick="delivered"'), 'tick inside outgoing bubble');
assert.match(html, /wa-time">\d\d:\d\d</);
assert.equal((html.match(/data-unread="1"/g) || []).length, 2, 'unread badge in list');
// composer is a disabled draft unless the send flag is on
assert.match(html, /id="waInput"[^>]*disabled/); assert.match(html, /class="wa-send"[^>]*disabled/);
const on = U.renderWa(inbox.list(), { selected: '201001', now: NOW, sendEnabled: true });
assert.doesNotMatch(on, /id="waInput"[^>]*disabled/);
// search + mobile view switching
assert.ok(!U.chatListHtml(inbox.list(), null, 'أحمد', NOW).includes('data-conv="201001"'));
assert.match(U.renderWa(inbox.list(), { now: NOW }), /data-view="list"/);
assert.match(html, /data-view="chat"/);
assert.equal(U.dateLabel(NOW, NOW), 'اليوم'); assert.equal(U.dateLabel(NOW - D, NOW), 'أمس');
// XSS
assert.ok(!U.renderWa([{ id: 'x', customer: '<img onerror=1>', updatedAt: 1, messages: [{ id: 'm', dir: 'in', text: '<script>', at: NOW }] }], { selected: 'x', now: NOW }).includes('<script>'));
// index.html embeds the same lib and uses renderWa
const page = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
assert.ok(page.includes('function renderWa(') && page.includes('U.renderWa('), 'index.html wired');
assert.ok(!/wa\.sel[^;]*fetch\(/.test(page));

// D1 backfill: additive + idempotent, tenant scoped, never deletes
const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; } }) }) };
const sheet = [
  { phone: '+20 100-1', name: 'منى', message: 'مرحبا', direction: 'incoming', timestamp: '2026-11-01T10:00:00Z' },
  { phone: '201001', message: 'أهلا', sender: 'bot', timestamp: '2026-11-01T10:01:00Z' },
  { message: 'no phone' },
];
const r1 = await backfillSheetRows(D1, 't1', sheet);
assert.equal(r1.added, 2);
assert.deepEqual(await backfillSheetRows(D1, 't1', sheet), { conversations: 0, added: 0, skipped: 2 });
const n = (q) => db.prepare(q).get().n;
assert.equal(n('SELECT COUNT(*) n FROM inbox_messages'), 2); assert.equal(n('SELECT COUNT(*) n FROM inbox_conversations'), 1);
assert.equal((await normalizeSheetRow(sheet[1])).dir, 'out'); assert.equal((await normalizeSheetRow(sheet[0])).dir, 'in');
db.prepare("INSERT INTO wa_inbound_queue (wa_message_id, payload_json) VALUES ('wamid.1', ?)").run(JSON.stringify({ message: { id: 'wamid.1', from: '201555', timestamp: '1760000000', text: { body: 'hi' } } }));
assert.equal((await backfillFromQueue(D1, 't1')).added, 1);
assert.equal((await backfillFromQueue(D1, 't1')).added, 0);
assert.equal(n('SELECT COUNT(*) n FROM wa_inbound_queue'), 1, 'source untouched');
const src = readFileSync(fileURLToPath(new URL('../../backend/src/inbox-backfill.js', import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '');
assert.ok(!/\b(DROP|TRUNCATE|DELETE)\b/i.test(src), 'no destructive SQL');
console.log('ux200-wa-chat OK');
