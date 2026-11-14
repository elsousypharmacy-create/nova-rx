// UX300: exact reply-time metrics, Africa/Cairo display, seconds-vs-ms normalization, PIN-gated /metrics endpoint.
// Run: node tests/unit/ux300-wa-metrics.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as M from '../../backend/src/wa-metrics.js';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';

const S = 1000, MIN = 60 * S;
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0); // 2026-10-20 13:00 Cairo (UTC+3 DST ended 30 Oct? Egypt DST until last Thu of Oct)
// durations
assert.equal(M.waDur(45 * S), '45 ث'); assert.equal(M.waDur(3 * MIN + 12 * S), '3 د 12 ث'); assert.equal(M.waDur(5 * MIN), '5 د');
assert.equal(M.waDur(2 * 3600 * S + 5 * MIN), '2 س 5 د'); assert.equal(M.waDur(400), 'أقل من ثانية'); assert.equal(M.waDur(null), '—');
// seconds vs ms normalization
assert.equal(M.waTs(1760800000), 1760800000000); assert.equal(M.waTs(1760800000000), 1760800000000); assert.equal(M.waTs(0), 0);
// Cairo display: summer (UTC+3) and winter (UTC+2)
assert.equal(M.waClock(Date.UTC(2026, 6, 1, 21, 30, 0)), '00:30'); assert.equal(M.waDayKey(Date.UTC(2026, 6, 1, 21, 30, 0)), '2026-07-02');
assert.equal(M.waClock(Date.UTC(2026, 11, 1, 21, 30, 0)), '23:30'); assert.equal(M.waDayKey(Date.UTC(2026, 11, 1, 21, 30, 0)), '2026-12-01');
assert.equal(M.waDateTime(Date.UTC(2026, 11, 1, 22, 0, 5)), '2026-12-02 00:00:05');
assert.equal(M.waDayStart(Date.UTC(2026, 11, 1, 21, 30, 0)), Date.UTC(2026, 10, 30, 22, 0, 0)); // Cairo midnight in winter
assert.equal(M.waDayStart(Date.UTC(2026, 6, 1, 21, 30, 0)), Date.UTC(2026, 6, 1, 21, 0, 0));
assert.equal(M.waKeyStart('2026-12-02'), Date.UTC(2026, 11, 1, 22, 0, 0));
// tagging
assert.equal(M.waIsHandoff('اتحوّل للصيدلي'), true); assert.equal(M.waIsHandoff('اتحول للصيدلي'), true); assert.equal(M.waIsHandoff('أهلاً'), false);
assert.deepEqual(M.waTopics('بكام البنادول وهل متوفر؟'), ['avail', 'price']);
// stats: exact median (even/odd), mean, p90 nearest rank, max
const it = (...ds) => ds.map((d) => ({ d }));
let st = M.waStats(it(10, 20, 30, 40)); assert.equal(st.median, 25); assert.equal(st.mean, 25); assert.equal(st.p90, 40); assert.equal(st.max, 40); assert.equal(st.min, 10);
st = M.waStats(it(5, 1, 3)); assert.equal(st.median, 3); assert.equal(M.waStats(it(...Array.from({ length: 10 }, (_, i) => i + 1))).p90, 9); assert.equal(M.waStats([]).median, null);

// scenario (customers A,B,C; A has live second-based timestamps)
const ev = (c, k, t, x = {}) => ({ c, k, t, ...x });
const data = { customers: [{ id: 'A', name: 'منى' }, { id: 'B', name: 'علي' }, { id: 'C', name: 'سارة' }], events: [
  ev('A', 'in', T0), ev('A', 'bot', T0 + 5 * S), ev('A', 'in', T0 + 60 * S), ev('A', 'sys', T0 + 61 * S, { h: 1 }), ev('A', 'pharm', T0 + 61 * S + 4 * MIN + 30 * S),
  ev('B', 'in', T0 + 10 * MIN, { tp: ['price'] }), ev('B', 'pharm', T0 + 10 * MIN + 90 * S), ev('B', 'in', T0 + 30 * MIN),
  ev('C', 'in', (T0 - 86400000) / 1000), // yesterday, seconds, unanswered
] };
const NOW = T0 + 2 * 3600 * S;
const r = M.waCompute(data, { now: NOW });
// replies: A1 bot 5s, A2 pharm 4m31s (reply after the sys note), B1 pharm 90s; B2 and C unanswered
assert.deepEqual(r.drill.replies.map((m) => [m.name, m.d, m.by]), [['منى', 5000, 'bot'], ['منى', 271000, 'pharm'], ['علي', 90000, 'pharm']]);
assert.equal(r.all.n, 3); assert.equal(r.all.median, 90000); assert.equal(r.all.max, 271000); assert.equal(r.all.mean, (5000 + 271000 + 90000) / 3);
assert.equal(r.unanswered, 2); assert.deepEqual(r.drill.unanswered.map((m) => m.name).sort(), ['سارة', 'علي']);
assert.equal(r.bot.n, 1); assert.equal(r.bot.median, 5000); assert.equal(r.pharm.n, 2); assert.equal(r.pharm.median, (90000 + 271000) / 2);
// first response per conversation: A=5s, B=90s (C none)
assert.equal(r.first.n, 2); assert.equal(r.first.max, 90000);
// within thresholds: denominator = answered(3)+unanswered(2) = 5
assert.equal(r.within[1].n, 1); assert.equal(r.within[5].n, 3); assert.equal(r.within[5].pct, 60); assert.equal(r.within[1].pct, 20);
// handoff: sys at T0+61s -> pharmacist at +4m30s = exactly 270s
assert.equal(r.handoffs.n, 1); assert.equal(r.handoff.median, 270000); assert.equal(r.handoffs.pending, 0);
// waiting now: B (since T0+30m) and C (since yesterday), oldest first
assert.deepEqual(r.drill.waiting.map((w) => [w.name, w.d]), [['سارة', NOW - (T0 - 86400000)], ['علي', NOW - (T0 + 30 * MIN)]]);
// seconds-based live timestamp normalized: C's message is yesterday in ms
assert.equal(r.drill.unanswered.find((m) => m.name === 'سارة').t, T0 - 86400000);
// volume: 3 customers, all new
assert.equal(r.volume.customers, 3); assert.equal(r.volume.newC, 3); assert.equal(r.volume.returning, 0); assert.equal(r.volume.inMsgs, 5);
assert.equal(r.volume.msgs, 8); assert.equal(r.volume.outMsgs, 3); // sys excluded
assert.equal(r.hours[13].inMsgs, 5); // T0 = 13:00 Cairo (UTC+3 in October 2026)
assert.deepEqual(r.topics.map((t) => [t.id, t.n]), [['price', 1]]);
// who filter: pharmacist only
const rp = M.waCompute(data, { now: NOW, who: 'pharm' });
assert.equal(rp.all.n, 2); assert.equal(rp.all.median, (90000 + 271000) / 2); assert.equal(rp.within[1].den, 4);
const rb = M.waCompute(data, { now: NOW, who: 'bot' }); assert.equal(rb.all.n, 1); assert.equal(rb.all.max, 5000);
// range filter: today only (Cairo) excludes C; returning vs new
const day = M.waDayStart(T0);
const rt = M.waCompute(data, { now: NOW, from: day, to: Infinity });
assert.equal(rt.volume.customers, 2); assert.equal(rt.unanswered, 1);
const rLater = M.waCompute({ customers: data.customers, events: [...data.events, ev('C', 'in', T0 + 5 * MIN)] }, { now: NOW, from: day });
assert.equal(rLater.volume.returning, 1); assert.equal(rLater.volume.newC, 2); // C wrote yesterday => returning today
// per-day series covers every Cairo day in range, including empty ones
const rd = M.waCompute(data, { now: NOW, from: M.waDayStart(T0 - 3 * 86400000), to: Infinity });
assert.deepEqual(rd.days.map((d) => d.key), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
assert.equal(rd.days[3].inMsgs, 4); assert.equal(rd.days[2].inMsgs, 1);
// handoff still pending (bot only after handoff) is not counted as answered
const rpend = M.waCompute({ customers: [{ id: 'Z' }], events: [ev('Z', 'in', T0), ev('Z', 'sys', T0 + S, { h: 1 }), ev('Z', 'bot', T0 + 2 * S)] }, { now: NOW });
assert.equal(rpend.handoffs.pending, 1); assert.equal(rpend.handoff.n, 0); assert.equal(rpend.unansweredNoHuman, 1);
// empty data
const re = M.waCompute({ customers: [], events: [] }, { now: NOW }); assert.equal(re.all.n, 0); assert.equal(re.volume.customers, 0); assert.deepEqual(re.days, []);
// presets
const rg = M.waRange('7d', NOW); assert.equal(rg.from, M.waDayStart(T0 - 6 * 86400000)); assert.equal(M.waRange('today', NOW).from, day);

// shared block is byte-identical in index.html (server tags and dashboard compute with the same code)
const src = readFileSync(new URL('../../backend/src/wa-metrics.js', import.meta.url), 'utf8');
const shared = src.slice(src.indexOf('// BEGIN-SHARED') + '// BEGIN-SHARED'.length, src.indexOf('// END-SHARED')).trim();
assert.ok(readFileSync(new URL('../../index.html', import.meta.url), 'utf8').includes(shared), 'index.html embeds the exact shared block');

// endpoint: PIN gated, read-only, no message text
const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({ async all() { return { results: db.prepare(sql).all(...a) }; }, async first() { return db.prepare(sql).get(...a) ?? null; } }) }) };
const kvm = new Map(); const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); } };
const PIN = 'pin-123456789012', env = { DB: D1, KV, NOVA_API_PIN: PIN };
db.prepare("INSERT INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES ('default','wa_1','منى',1760800000),('other','wa_9','x',5)").run();
db.prepare("INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES ('default','h_u_1','wa_1','in','بكام البنادول سر123',NULL,1760799000000),('default','h_s_2','wa_1','out','اتحوّل للصيدلي',NULL,1760799001000),('default','h_p_3','wa_1','out','تمام',NULL,1760799060),('other','h_u_9','wa_9','in','secret',NULL,1)").run();
const call = async (pin) => { const h = { 'CF-Connecting-IP': '3.3.3.3' }; if (pin) h['X-Nova-Pin'] = pin; const x = await handle(new Request('https://x.test/api/v1/inbox/history/metrics', { headers: h }), env); return [x.status, await x.json()]; };
let [s, j] = await call(null); assert.equal(s, 401); assert.equal(j.data, undefined);
[s, j] = await call('wrong-pin-0000000'); assert.equal(s, 401); assert.equal(j.data, undefined);
[s, j] = await call(PIN); assert.equal(s, 200);
assert.deepEqual(j.data.events.map((e) => [e.k, e.t, !!e.h, e.tp || null]), [['in', 1760799000000, false, ['price']], ['sys', 1760799001000, true, null], ['pharm', 1760799060000, false, null]]);
assert.ok(!JSON.stringify(j).includes('البنادول') && !JSON.stringify(j).includes('secret') && !JSON.stringify(j).includes('سر123'), 'no message text in the response');
const rr = M.waCompute(j.data, { now: 1760800000000 }); assert.equal(rr.pharm.median, 60000); assert.equal(rr.handoff.median, 59000);
const post = await handle(new Request('https://x.test/api/v1/inbox/history/metrics', { method: 'POST', headers: { 'X-Nova-Pin': PIN } }), env); assert.equal(post.status, 405);
console.log('ux300-wa-metrics OK');
