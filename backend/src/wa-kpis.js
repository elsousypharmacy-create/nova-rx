// UX430: WhatsApp KPIs (Home card + KPIs page). Pure functions, no I/O.
// Input is the same text-free event list served by GET /api/v1/inbox/history/metrics (UX300), extended with two optional
// fields per event: m = media kind ('image'|'audio'|'video'|'document'|'sticker'|'other') and s = staff display name.
// The block between BEGIN-KPI-SHARED and END-KPI-SHARED is plain ES5 and is copied VERBATIM into index.html and the
// preview artifact (tests/unit/backend-wa-kpis.check.mjs fails if the copies differ). Day boundaries use the app's existing
// pharmacy timezone (Africa/Cairo, same as UX300 WA_TZ).
// BEGIN-KPI-SHARED
var KP_TZ = 'Africa/Cairo';
var KP_DAY = 86400000;
var _kpFmt = null;
function kpTs(v) { var n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; }
function kpParts(t) {
  if (!_kpFmt) _kpFmt = new Intl.DateTimeFormat('en-US', { timeZone: KP_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  var o = {};
  _kpFmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday] };
}
function kpOffset(t) { var p = kpParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; }
function kpDayStart(t) { var p = kpParts(t), g = Date.UTC(p.y, p.mo - 1, p.d), s = g - kpOffset(g); return g - kpOffset(s); }
function kpNextDay(t) { return kpDayStart(kpDayStart(t) + 30 * 3600000); }
function kpPrevDay(t) { return kpDayStart(kpDayStart(t) - 12 * 3600000); }
function kpPad(n) { return (n < 10 ? '0' : '') + n; }
function kpDayKey(t) { var p = kpParts(t); return p.y + '-' + kpPad(p.mo) + '-' + kpPad(p.d); }
function kpKeyStart(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '')); return m ? kpDayStart(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; }
function kpDaysBack(now, n) { var s = kpDayStart(now); for (var i = 1; i < n; i++) s = kpPrevDay(s); return s; }
// preset: 'today' | '7d' | '30d' | 'custom' (fromKey/toKey 'YYYY-MM-DD', inclusive). Returns {from, to} epoch ms, to exclusive.
function kpRange(preset, now, fromKey, toKey) {
  var s = kpDayStart(now);
  if (preset === '7d') return { from: kpDaysBack(now, 7), to: kpNextDay(s) };
  if (preset === '30d') return { from: kpDaysBack(now, 30), to: kpNextDay(s) };
  if (preset === 'custom') {
    var a = kpKeyStart(fromKey), b = kpKeyStart(toKey);
    if (a == null && b == null) return { from: s, to: kpNextDay(s) };
    if (a == null) a = b; if (b == null) b = a;
    if (b < a) { var x = a; a = b; b = x; }
    return { from: a, to: kpNextDay(b) };
  }
  return { from: s, to: kpNextDay(s) };
}
function kpIsStaff(k) { return k === 'pharm' || k === 'out'; }
function kpStats(list) {
  var n = list.length;
  if (!n) return { n: 0, avg: null, median: null };
  var a = list.slice().sort(function (x, y) { return x - y; }), sum = 0;
  for (var i = 0; i < n; i++) sum += a[i];
  return { n: n, avg: sum / n, median: n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2 };
}
function kpDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return 'أقل من ثانية';
  var s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return d + ' يوم' + (h ? ' ' + h + ' س' : '');
  if (h) return h + ' س' + (m ? ' ' + m + ' د' : '');
  if (m) return m + ' د' + (r ? ' ' + r + ' ث' : '');
  return r + ' ث';
}
// data = { customers:[{id,name}], events:[{c, k:'in'|'bot'|'pharm'|'out'|'sys', t, m?, s?}] }; o = { from, to, now }.
// Definitions (documented on the page):
//  chats    = distinct conversations with at least one customer/bot/staff message in the window (system notes ignored).
//  messages = customer + bot + staff messages in the window.
//  first response = for every customer message that opens a wait (no customer message already waiting since the last staff
//                   reply; bot replies do not end a wait), the time until the next staff (pharmacist) reply. Counted when the
//                   wait opened inside the window. Bot replies never count.
//  waiting  = conversations whose latest non-system message is from the customer (current state at `now`); `open` = that
//             wait started less than 24h ago (WhatsApp reply window still open).
//  new customer = their first-ever message falls inside the window; returning = wrote before the window too.
function kpCompute(data, o) {
  o = o || {};
  var now = o.now || Date.now(), from = o.from == null ? -Infinity : o.from, to = o.to == null ? Infinity : o.to;
  var names = {}, byC = {}, ids = [];
  (data && data.customers || []).forEach(function (c) { names[c.id] = c.name || c.id; });
  (data && data.events || []).forEach(function (e, i) {
    var t = kpTs(e.t);
    if (!t || !e.c) return;
    if (!byC[e.c]) { byC[e.c] = []; ids.push(e.c); }
    byC[e.c].push({ k: e.k, t: t, m: e.m || null, s: e.s || null, i: i });
  });
  var heat = [], h, w;
  for (w = 0; w < 7; w++) { heat.push([]); for (h = 0; h < 24; h++) heat[w].push(0); }
  var hours = []; for (h = 0; h < 24; h++) hours.push(0);
  var convs = {}, msgs = 0, inN = 0, botN = 0, staffN = 0, firstRt = [], staff = {}, media = { image: 0, audio: 0, video: 0, document: 0, sticker: 0, other: 0 };
  var newC = 0, retC = 0, waiting = [], custs = {};
  ids.forEach(function (c) {
    var ev = byC[c].sort(function (a, b) { return a.t - b.t || a.i - b.i; }), i, e, waitFrom = null, firstIn = null, lastNs = null;
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.k === 'sys') continue;
      lastNs = e;
      var inR = e.t >= from && e.t < to;
      if (e.k === 'in' && firstIn === null) firstIn = e;
      if (inR) {
        convs[c] = 1; msgs++;
        if (e.m && Object.prototype.hasOwnProperty.call(media, e.m)) media[e.m]++;
        if (e.k === 'in') { inN++; custs[c] = 1; var p = kpParts(e.t); heat[p.wd][p.h]++; hours[p.h]++; }
        else if (e.k === 'bot') botN++;
        else if (kpIsStaff(e.k)) { staffN++; var nm = e.s || ''; staff[nm] = (staff[nm] || 0) + 1; }
      }
      if (e.k === 'in') { if (waitFrom === null) waitFrom = e; }
      else if (kpIsStaff(e.k)) {
        if (waitFrom !== null && waitFrom.t >= from && waitFrom.t < to) firstRt.push(e.t - waitFrom.t);
        waitFrom = null;
      }
    }
    if (custs[c]) { if (firstIn && firstIn.t >= from) newC++; else retC++; }
    if (lastNs && lastNs.k === 'in') {
      var ws = lastNs;
      for (i = ev.length - 1; i >= 0; i--) { if (ev[i].k === 'sys') continue; if (ev[i].k === 'in') ws = ev[i]; else break; }
      var d = Math.max(0, now - ws.t);
      waiting.push({ c: c, name: names[c] || c, t: ws.t, d: d, open: d < KP_DAY });
    }
  });
  waiting.sort(function (a, b) { return (b.open - a.open) || (a.open ? b.d - a.d : a.d - b.d); });
  var staffList = Object.keys(staff).map(function (k) { return { name: k, n: staff[k] }; }).sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
  var st = kpStats(firstRt);
  return {
    from: from, to: to, now: now,
    chats: Object.keys(convs).length, msgs: msgs, inMsgs: inN, botMsgs: botN, staffMsgs: staffN,
    firstResponse: { n: st.n, avg: st.avg, median: st.median },
    waitingOpen: waiting.filter(function (x) { return x.open; }).length, waiting: waiting,
    customers: { total: newC + retC, newC: newC, returning: retC },
    staff: staffList, media: media, mediaTotal: media.image + media.audio + media.video + media.document + media.sticker + media.other,
    heat: heat, hours: hours
  };
}
// Per-day chats/messages for the `n` days ending today (oldest first).
function kpTrend(data, now, n) {
  var start = kpDaysBack(now, n), out = [], idx = {}, cur = start, g = 0;
  while (out.length < n && g++ < 400) { var k = kpDayKey(cur); idx[k] = out.length; out.push({ key: k, chats: 0, msgs: 0, _c: {} }); cur = kpNextDay(cur); }
  var end = kpNextDay(kpDayStart(now));
  (data && data.events || []).forEach(function (e) {
    var t = kpTs(e.t);
    if (!t || e.k === 'sys' || t < start || t >= end) return;
    var j = idx[kpDayKey(t)];
    if (j == null) return;
    out[j].msgs++; if (!out[j]._c[e.c]) { out[j]._c[e.c] = 1; out[j].chats++; }
  });
  return out.map(function (d) { return { key: d.key, chats: d.chats, msgs: d.msgs }; });
}
// Headline numbers for the Home card: today vs yesterday.
function kpHeadline(data, now) {
  now = now || Date.now();
  var s = kpDayStart(now), y = kpPrevDay(s), today = kpCompute(data, { from: s, to: kpNextDay(s), now: now }), yd = kpCompute(data, { from: y, to: s, now: now });
  return { today: today, yesterday: yd };
}
// END-KPI-SHARED

// Server-only helpers (not copied into the UI).
// Media kind from the stored message text. Live intake writes '[صورة]' / '[مستند]' (whatsapp-process.js); backfilled
// WhatsApp exports use '<Media omitted>' / 'image omitted' style markers. Returns null for plain text.
const MEDIA_RE = [
  ['sticker', /^\s*(?:\[(?:ملصق|استيكر|sticker)\]|‎?sticker omitted|‎?تم حذف الملصق|ملصق محذوف)/i],
  ['image', /^\s*(?:\[(?:صورة|صوره|image|photo)\]|‎?image omitted|‎?(?:تم )?حذف الصورة|صورة محذوفة)/i],
  ['audio', /^\s*(?:\[(?:صوت|رسالة صوتية|ريكورد|فويس|audio|voice)\]|‎?audio omitted|‎?(?:تم )?حذف الصوت|صوت محذوف)/i],
  ['video', /^\s*(?:\[(?:فيديو|video)\]|‎?video omitted|‎?(?:تم )?حذف الفيديو|فيديو محذوف)/i],
  ['document', /^\s*(?:\[(?:مستند|ملف|document|file)\]|‎?document omitted|.*\.(?:pdf|docx?|xlsx?)\s*•?\s*\d+\s*(?:صفحة|pages?)\s*‎?(?:document omitted)?)/i],
];
export function mediaKind(text) {
  const s = String(text == null ? '' : text);
  if (!s) return null;
  if (/^\s*<?\s*(?:media omitted|الوسائط محذوفة|تم استبعاد الوسائط)\s*>?\s*$/i.test(s)) return 'other';
  for (const [k, re] of MEDIA_RE) if (re.test(s)) return k;
  return null;
}

export { KP_TZ, kpTs, kpParts, kpDayStart, kpNextDay, kpPrevDay, kpDayKey, kpKeyStart, kpDaysBack, kpRange, kpStats, kpDur, kpCompute, kpTrend, kpHeadline };
