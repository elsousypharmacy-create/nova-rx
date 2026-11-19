// UX430: WhatsApp KPIs (Home card + KPIs page). Pure KPI maths on fixture events, the read-only metrics endpoint on a fake
// D1 (node:sqlite + real migrations), and the shared ES5 block copied verbatim into index.html / the ux-430 artifact.
// Run: node --no-warnings tests/unit/backend-wa-kpis.check.mjs   (no network, never prints secrets)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { kpRange, kpStats, kpDur, kpCompute, kpTrend, kpHeadline, kpDayKey, kpParts, kpDayStart, mediaKind } from '../../backend/src/wa-kpis.js';
import { waDayStart } from '../../backend/src/wa-metrics.js';
import { staffBearer } from './helpers/staff-session.mjs';

const MIN = 60000, H = 3600000, D = 86400000;
// Africa/Cairo is UTC+2 in November 2026 (DST ended 29 Oct). NOW = Sun 2026-11-15 12:00 Cairo.
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);
const TODAY = Date.UTC(2026, 10, 14, 22, 0, 0); // 00:00 Cairo
const at = (dayOffset, hh, mm = 0, ss = 0) => TODAY + dayOffset * D + hh * H + mm * MIN + ss * 1000;
const ev = (c, k, t, x = {}) => ({ c, k, t, ...x });
const DATA = {
  customers: [{ id: 'c1', name: 'منى' }, { id: 'c2', name: 'علي' }, { id: 'c3', name: 'سها' }, { id: 'c4', name: 'هدى' }, { id: 'c5', name: 'كريم' }],
  events: [
    // c1: new today. Wait opens 09:00, bot replies (does not end the wait), staff سارة replies 09:05 => 5 min.
    ev('c1', 'in', at(0, 9)), ev('c1', 'bot', at(0, 9, 0, 5)), ev('c1', 'in', at(0, 9, 1), { m: 'image' }), ev('c1', 'in', at(0, 9, 2), { m: 'sticker' }),
    ev('c1', 'pharm', at(0, 9, 5), { s: 'سارة' }),
    // c2: returning (wrote 3 days ago). Today 10:00 -> 10:01 (1 min), 10:30 -> 10:33 (3 min), both by أحمد. Old ts in seconds.
    ev('c2', 'in', at(-3, 14) / 1000), ev('c2', 'pharm', at(-3, 14, 2), { s: 'أحمد' }),
    ev('c2', 'in', at(0, 10), { m: 'audio' }), ev('c2', 'pharm', at(0, 10, 1), { s: 'أحمد' }), ev('c2', 'in', at(0, 10, 30)), ev('c2', 'out', at(0, 10, 33), { s: 'أحمد' }),
    // c3: new today, waiting since 11:00 (system note ignored), no reply yet.
    ev('c3', 'in', at(0, 11)), ev('c3', 'sys', at(0, 11, 0, 30), { h: 1 }), ev('c3', 'in', at(0, 11, 5)),
    // c4: yesterday 20:00 -> staff (no name) 20:10 => 10 min.
    ev('c4', 'in', at(-1, 20)), ev('c4', 'out', at(-1, 20, 10)),
    // c5: waiting for 3 days (24h WhatsApp window closed).
    ev('c5', 'in', at(-3, 9)),
  ],
};

// --- ranges (Cairo days, DST-safe) ---
let r = kpRange('today', NOW); assert.equal(r.from, TODAY); assert.equal(r.to, TODAY + D);
r = kpRange('7d', NOW); assert.equal(r.from, TODAY - 6 * D); assert.equal(r.to, TODAY + D);
r = kpRange('30d', NOW); assert.equal(kpDayKey(r.from), '2026-10-17'); assert.equal(kpParts(r.from).h, 0);
assert.equal(r.from, Date.UTC(2026, 9, 16, 21, 0, 0), '17 Oct is still summer time (UTC+3)');
r = kpRange('custom', NOW, '2026-11-14', '2026-11-14'); assert.equal(r.from, TODAY - D); assert.equal(r.to, TODAY);
r = kpRange('custom', NOW, '2026-11-15', '2026-11-13'); assert.equal(r.from, TODAY - 2 * D); assert.equal(r.to, TODAY + D, 'swapped dates are normalised');
assert.equal(kpDayStart(NOW), waDayStart(NOW), 'same day boundary as the UX300 dashboard');

// --- stats ---
assert.deepEqual(kpStats([1, 2, 3, 10]), { n: 4, avg: 4, median: 2.5 });
assert.deepEqual(kpStats([5, 1, 3]), { n: 3, avg: 3, median: 3 });
assert.deepEqual(kpStats([]), { n: 0, avg: null, median: null });
assert.equal(kpDur(5 * MIN), '5 د'); assert.equal(kpDur(H + 2 * MIN), '1 س 2 د'); assert.equal(kpDur(null), '—');

// --- today vs yesterday ---
const { today: T, yesterday: Y } = kpHeadline(DATA, NOW);
assert.equal(T.chats, 3); assert.equal(T.msgs, 11); assert.equal(T.inMsgs, 7); assert.equal(T.botMsgs, 1); assert.equal(T.staffMsgs, 3);
assert.equal(Y.chats, 1); assert.equal(Y.msgs, 2);
// first response: staff only, bot ignored => [5, 1, 3] min
assert.equal(T.firstResponse.n, 3); assert.equal(T.firstResponse.avg, 3 * MIN); assert.equal(T.firstResponse.median, 3 * MIN);
assert.equal(Y.firstResponse.n, 1); assert.equal(Y.firstResponse.avg, 10 * MIN); assert.equal(Y.firstResponse.median, 10 * MIN);
// waiting: c3 open for 1h (since its first unanswered message), c5 closed (3 days)
assert.equal(T.waitingOpen, 1);
assert.deepEqual(T.waiting.map((w) => [w.c, w.open]), [['c3', true], ['c5', false]]);
assert.equal(T.waiting[0].d, H); assert.equal(T.waiting[0].name, 'سها'); assert.equal(T.waiting[1].d, 3 * D + 3 * H);
// new vs returning
assert.deepEqual(T.customers, { total: 3, newC: 2, returning: 1 });
assert.deepEqual(Y.customers, { total: 1, newC: 1, returning: 0 });
// replies per staff member (unnamed staff => '')
assert.deepEqual(T.staff, [{ name: 'أحمد', n: 2 }, { name: 'سارة', n: 1 }]);
assert.deepEqual(Y.staff, [{ name: '', n: 1 }]);
// media
assert.deepEqual(T.media, { image: 1, audio: 1, video: 0, document: 0, sticker: 1, other: 0 }); assert.equal(T.mediaTotal, 3);
// busiest hours: customer messages only, Cairo hours, weekday row
const wd = new Date(Date.UTC(2026, 10, 15, 12)).getUTCDay();
assert.equal(T.hours[9], 3); assert.equal(T.hours[10], 2); assert.equal(T.hours[11], 2); assert.equal(T.hours.reduce((a, b) => a + b, 0), 7);
assert.equal(T.heat[wd][9], 3); assert.equal(T.heat[wd][11], 2);

// --- 7-day window aggregates the whole range ---
r = kpRange('7d', NOW);
const W = kpCompute(DATA, { ...r, now: NOW });
assert.equal(W.chats, 5); assert.equal(W.msgs, 11 + 2 + 3);
assert.equal(W.firstResponse.n, 5); // 5,1,3 today + 10 yesterday + 2 three days ago
assert.equal(W.firstResponse.median, 3 * MIN); assert.equal(W.firstResponse.avg, (5 + 1 + 3 + 10 + 2) / 5 * MIN);
assert.deepEqual(W.customers, { total: 5, newC: 5, returning: 0 });
assert.deepEqual(W.staff, [{ name: 'أحمد', n: 3 }, { name: '', n: 1 }, { name: 'سارة', n: 1 }]);

// --- 7 / 30 day trends ---
const t7 = kpTrend(DATA, NOW, 7), t30 = kpTrend(DATA, NOW, 30);
assert.equal(t7.length, 7); assert.equal(t30.length, 30);
assert.equal(t7[6].key, '2026-11-15'); assert.equal(t7[0].key, '2026-11-09'); assert.equal(t30[0].key, '2026-10-17');
assert.deepEqual(t7[6], { key: '2026-11-15', chats: 3, msgs: 11 });
assert.deepEqual(t7[5], { key: '2026-11-14', chats: 1, msgs: 2 });
assert.deepEqual(t7[3], { key: '2026-11-12', chats: 2, msgs: 3 });
assert.equal(t30.reduce((a, d) => a + d.msgs, 0), 16);
assert.equal(new Set(t30.map((d) => d.key)).size, 30, 'DST change does not duplicate or skip a day');

// --- empty data ---
const E = kpCompute({ customers: [], events: [] }, { ...kpRange('today', NOW), now: NOW });
assert.equal(E.chats, 0); assert.equal(E.firstResponse.avg, null); assert.deepEqual(E.waiting, []);

// --- media kind from stored text ---
assert.equal(mediaKind('[صورة] روشتة'), 'image'); assert.equal(mediaKind('[مستند] a.pdf'), 'document');
assert.equal(mediaKind('<Media omitted>'), 'other'); assert.equal(mediaKind('audio omitted'), 'audio');
assert.equal(mediaKind('video omitted'), 'video'); assert.equal(mediaKind('sticker omitted'), 'sticker');
assert.equal(mediaKind('صورة جميلة'), null); assert.equal(mediaKind('عايز بنادول'), null); assert.equal(mediaKind(null), null);

// --- endpoint: GET /api/v1/inbox/history/metrics on a fake D1 ---
const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { throw new Error('write attempted: ' + sql.slice(0, 40)); },
}) }) };
const seed = (sql) => db.prepare(sql).run();
seed("INSERT INTO inbox_conversations (tenant_id, id, customer, assignee, updated_at) VALUES ('default','wa_1','منى','نهى',1763200000000),('default','wa_2','علي',NULL,1763200000000)");
seed("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES " +
  "('default','wa_a','wa_1','in','[صورة] روشتة سرية',NULL,1763190000000)," +
  "('default','h_p_1','wa_1','out','رد قديم',NULL,1763190060000)," +
  "('default','wa_b','wa_2','in','audio omitted',NULL,1763190000000)," +
  "('default','ps_1','wa_2','out','تمام يا فندم','sent',1763190120000)");
seed("INSERT INTO wa_send_log (tenant_id, id, conversation_id, sent_by, text_len, status, created_at, finished_at) VALUES ('default','ws_1','wa_2','د. أحمد',12,'sent',1763190110000,1763190119000)");
const call = async (env, method = 'GET', auth = {}) => {
  const res = await handle(new Request('https://x.test/api/v1/inbox/history/metrics', { method, headers: { 'CF-Connecting-IP': '1.1.1.1', ...auth } }), env);
  return [res.status, await res.json()];
};
const kvm = new Map(); const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
// SEC-01: staging needs a staff session too (logged out => 401, no data)
{ const [s0, j0] = await call({ DB: D1, KV, NOVA_ENV: 'staging' }); assert.equal(s0, 401); assert.equal(j0.data, undefined); }
const STAFF = (await staffBearer(KV, { user: 'kpi.test', role: 'manager' })).headers;
let [s, j] = await call({ DB: D1, KV, NOVA_ENV: 'staging' }, 'GET', STAFF);
assert.equal(s, 200); assert.equal(j.ok, true);
const byId = Object.fromEntries(j.data.events.map((e) => [e.c + ':' + e.k, e]));
assert.equal(byId['wa_1:in'].m, 'image'); assert.equal(byId['wa_2:in'].m, 'audio');
assert.equal(byId['wa_2:pharm'].s, 'د. أحمد', 'staff name from wa_send_log'); assert.equal(byId['wa_1:pharm'].s, 'نهى', 'fallback: chat assignee');
const body = JSON.stringify(j);
assert.ok(!body.includes('روشتة') && !body.includes('تمام يا فندم'), 'message text never returned');
// production-like env without the PIN stays gated; POST is not a route
[s, j] = await call({ DB: D1, KV, NOVA_ENV: 'production', NOVA_API_PIN: 'pin-123456789012' }); assert.equal(s, 401); assert.equal(j.data, undefined);
[s] = await call({ DB: D1, KV, NOVA_ENV: 'staging' }, 'POST'); assert.equal(s, 405);
// an old DB without wa_send_log still answers (names fall back to the assignee)
const D1old = { prepare: (sql) => { if (/wa_send_log/.test(sql)) throw new Error('no such table'); return D1.prepare(sql); } };
[s, j] = await call({ DB: D1old, KV, NOVA_ENV: 'staging' }, 'GET', STAFF); assert.equal(s, 200);
assert.equal(j.data.events.find((e) => e.c === 'wa_2' && e.k === 'pharm').s, undefined);

// --- shared block copied verbatim into the UI ---
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const src = readFileSync(join(ROOT, 'backend/src/wa-kpis.js'), 'utf8');
const block = src.slice(src.indexOf('// BEGIN-KPI-SHARED'), src.indexOf('// END-KPI-SHARED') + '// END-KPI-SHARED'.length);
assert.ok(block.length > 2000);
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
assert.ok(idx.includes(block), 'index.html carries the exact KPI block');
const ART = join(ROOT, 'worker/live/nova-rx-preview.ux-430.js');
if (existsSync(ART)) {
  const out = join(tmpdir(), 'ux430-kpi-' + process.pid + '.html');
  execFileSync(process.execPath, [join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', ART, out], { stdio: 'pipe' });
  assert.ok(readFileSync(out, 'utf8').includes(block), 'ux-430 artifact carries the exact KPI block');
}
console.log('backend-wa-kpis OK (ranges, today/yesterday, 7/30 trends, avg+median first response, waiting, new/returning, staff, media, heatmap, endpoint, shared block)');
