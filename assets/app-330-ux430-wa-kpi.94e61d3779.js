
(function(){
"use strict";
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
/* UX430 UI: Home card + dedicated WhatsApp KPIs page. Hidden unless localStorage nova.flags.waKpis==='1' (default OFF) so the
   code can come back later without showing on Home. Read-only: one GET to /api/v1/inbox/history/metrics (UX300 endpoint, same
   gate as the conversations list since UX400, no PIN header). Data stays in memory only. Never sends a message: tapping a waiting
   chat only opens it in المحادثات (the same click a pharmacist would make). Automated browsers (navigator.webdriver) do not
   auto-load the Home numbers so unrelated offline smoke tests make no network call; localStorage nova.waKpi.autoload=1 opts in. */
var KPW = { data: null, at: 0, busy: false, err: '', preset: 'today', fromKey: '', toKey: '', trendN: 7, open: false, wait: [] };
function kpFlagOn() { try { return localStorage.getItem('nova.flags.waKpis') === '1'; } catch (e) { return false; } }
function kpWdList() { return [T('الأحد', 'Sun'), T('الاثنين', 'Mon'), T('الثلاثاء', 'Tue'), T('الأربعاء', 'Wed'), T('الخميس', 'Thu'), T('الجمعة', 'Fri'), T('السبت', 'Sat')]; }
function kpMediaList() { return [['image', T('صور', 'Images')], ['audio', T('صوت', 'Audio')], ['video', T('فيديو', 'Video')], ['document', T('مستندات', 'Documents')], ['sticker', T('ملصقات', 'Stickers')], ['other', T('وسائط أخرى', 'Other media')]]; }
function kpEn() { var l = document.documentElement.getAttribute('lang'); if (l === 'en') return true; if (l === 'ar') return false; try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } }
function T(ar, en) { return kpEn() ? en : ar; }
function kpD(ms) {
  if (!kpEn()) return kpDur(ms);
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return 'under 1 s';
  var s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return d + ' d' + (h ? ' ' + h + ' h' : '');
  if (h) return h + ' h' + (m ? ' ' + m + ' min' : '');
  if (m) return m + ' min' + (r ? ' ' + r + ' s' : '');
  return r + ' s';
}
function kpEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function kpNum(n) { return n == null ? '—' : String(Math.round(n)); }
function kpUrl() {
  var u = '';
  try { u = localStorage.getItem('novaBackend.url') || ''; if (!u && localStorage.getItem('novaBackend.enabled') === 'true') u = 'https://nova-rx-api.elsousypharmacy.workers.dev'; } catch (e) { }
  return String(u || 'https://nova-rx-api-staging.elsousypharmacy.workers.dev').replace(/\/+$/, '') + '/api/v1/inbox/history/metrics';
}
function kpAuto() {
  try { if (localStorage.getItem('nova.waKpi.autoload') === '1') return true; } catch (e) { }
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}
function kpLoad(force) {
  if (KPW.busy || typeof fetch !== 'function') return;
  if (!force && KPW.data && Date.now() - KPW.at < 60000) { kpPaint(); return; }
  KPW.busy = true; KPW.err = ''; kpPaint();
  fetch(kpUrl(), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit' }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401 || r.status === 429) throw new Error(T('السيرفر ده لسه مش فاتح بيانات واتساب. افتح نسخة التجربة أو حاول تاني بعد شوية.', 'This server does not share WhatsApp data yet. Open the preview or try again later.'));
      if (!r.ok || !j || !j.ok || !j.data) throw new Error(T('السيرفر مش بيرد دلوقتي. حاول تاني بعد شوية.', 'The server is not responding right now. Try again shortly.'));
      KPW.data = j.data; KPW.at = Date.now();
    });
  }, function () { throw new Error(typeof navigator !== 'undefined' && navigator.onLine === false ? T('أنت غير متصل بالإنترنت.', 'You are offline.') : T('تعذّر الاتصال بالسيرفر.', 'Could not reach the server.')); })
    .catch(function (e) { KPW.err = String((e && e.message) || e); })
    .then(function () { KPW.busy = false; kpPaint(); });
}
function kpDelta(a, b) {
  if (a == null || b == null) return '';
  return T('أمس ', 'Yesterday ') + b + (a > b ? ' ▲' : a < b ? ' ▼' : '');
}
function kpCardHtml() {
  var h = KPW.data ? kpHeadline(KPW.data, Date.now()) : null, t = h && h.today, y = h && h.yesterday;
  var fr = t && t.firstResponse.avg != null ? kpD(t.firstResponse.avg) : '—';
  function tile(v, l, sub, cls, key) { return '<span class="wk-t' + (cls ? ' ' + cls : '') + '" data-wk="' + key + '"><b>' + kpEsc(v) + '</b><span>' + l + '</span><i>' + kpEsc(sub || ' ') + '</i></span>'; }
  return T('<span class="wk-top"><span class="wk-ico" aria-hidden="true">✆</span>واتساب النهارده<span class="wk-more">كل المؤشرات ‹</span></span>', '<span class="wk-top"><span class="wk-ico" aria-hidden="true">✆</span>WhatsApp today<span class="wk-more">All KPIs ›</span></span>') +
    '<span class="wk-tiles">' +
    tile(t ? t.chats : '—', T('محادثات', 'Chats'), t ? kpDelta(t.chats, y.chats) : '', '', 'chats') +
    tile(t ? t.msgs : '—', T('رسائل', 'Messages'), t ? kpDelta(t.msgs, y.msgs) : '', '', 'msgs') +
    tile(t ? t.waitingOpen : '—', T('بانتظار الرد', 'Waiting'), t && t.waitingOpen ? T('محتاجين رد', 'Need a reply') : (t ? T('مفيش حد', 'None') : ''), t && t.waitingOpen ? 'wk-warn' : '', 'waiting') +
    tile(fr, T('متوسط الرد', 'Avg reply'), t ? T('أمس ', 'Yesterday ') + kpD(y.firstResponse.avg) : '', '', 'first') +
    '</span>' + (KPW.err && !KPW.data ? '<span class="wk-note" role="status">' + kpEsc(KPW.err) + '</span>' : KPW.busy && !KPW.data ? T('<span class="wk-note" role="status">جارٍ التحميل…</span>', '<span class="wk-note" role="status">Loading…</span>') : '');
}
function kpTrendHtml(n) {
  var tr = kpTrend(KPW.data, Date.now(), n), mx = 1, i, s = '';
  for (i = 0; i < tr.length; i++) mx = Math.max(mx, tr[i].msgs, tr[i].chats);
  var sumM = 0, sumC = 0;
  for (i = 0; i < tr.length; i++) {
    var d = tr[i]; sumM += d.msgs; sumC += d.chats;
    s += '<div class="wkp-col' + (d.msgs ? '' : ' zero') + '" title="' + d.key + ': ' + d.chats + T(' محادثة، ', ' chats, ') + d.msgs + T(' رسالة" data-day="', ' messages" data-day="') + d.key + '"><span class="c" style="height:' + Math.round(d.chats / mx * 100) + '%"></span><span class="m" style="height:' + Math.round(d.msgs / mx * 100) + '%"></span></div>';
  }
  return T('<div class="wkp-chart" role="img" aria-label="رسائل ومحادثات آخر ', '<div class="wkp-chart" role="img" aria-label="Messages and chats, last ') + n + T(' يوم">', ' days">') + s + '</div>' +
    '<div class="wkp-axis"><span>' + tr[0].key.slice(5) + '</span><span>' + tr[tr.length - 1].key.slice(5) + '</span></div>' +
    T('<div class="wkp-leg"><span><i style="background:#76b8d5"></i>رسائل: <b data-trend-msgs>', '<div class="wkp-leg"><span><i style="background:#76b8d5"></i>Messages: <b data-trend-msgs>') + sumM + T('</b></span><span><i style="background:#60b99b"></i>محادثات (مجموع الأيام): <b data-trend-chats>', '</b></span><span><i style="background:#60b99b"></i>Chats (sum of days): <b data-trend-chats>') + sumC + '</b></span></div>';
}
function kpHeatHtml(r) {
  var mx = 0, w, h, s = '<span></span>';
  for (w = 0; w < 7; w++) for (h = 0; h < 24; h++) mx = Math.max(mx, r.heat[w][h]);
  for (h = 0; h < 24; h++) s += '<span class="hl">' + (h % 3 === 0 ? h : '') + '</span>';
  var order = [6, 0, 1, 2, 3, 4, 5];
  for (var oi = 0; oi < 7; oi++) {
    w = order[oi]; s += '<span class="dl">' + kpWdList()[w] + '</span>';
    for (h = 0; h < 24; h++) {
      var v = r.heat[w][h], a = mx ? v / mx : 0;
      s += '<span class="cell" data-heat="' + w + '-' + h + '" title="' + kpWdList()[w] + ' ' + kpPad(h) + ':00 — ' + v + T(' رسالة"', ' messages"') + (v ? ' style="background:rgba(118,184,213,' + (0.18 + a * 0.82).toFixed(2) + ')"' : '') + '></span>';
    }
  }
  var top = r.hours.map(function (n, i) { return { h: i, n: n }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n || a.h - b.h; }).slice(0, 3);
  return T('<div class="wkp-heat" role="img" aria-label="أوقات الذروة حسب اليوم والساعة">', '<div class="wkp-heat" role="img" aria-label="Busiest hours by day and hour">') + s + '</div>' +
    '<p class="wkp-foot" data-peak>' + (top.length ? T('أكتر ساعات زحمة: ', 'Busiest hours: ') + top.map(function (x) { return kpPad(x.h) + ':00 (' + x.n + ')'; }).join(T('، ', ', ')) : T('مفيش رسائل عملاء في الفترة دي.', 'No customer messages in this period.')) + '</p>';
}
function kpPageHtml() {
  var presets = [['today', T('اليوم', 'Today')], ['7d', T('7 أيام', '7 days')], ['30d', T('30 يوم', '30 days')], ['custom', T('مخصص', 'Custom')]], seg = '';
  presets.forEach(function (p) { seg += '<button type="button" data-kp-preset="' + p[0] + '" aria-pressed="' + (KPW.preset === p[0]) + '">' + p[1] + '</button>'; });
  var head = T('<div class="wkp-head"><button type="button" class="wkp-btn" data-kp-back aria-label="رجوع">→ رجوع</button><h1>مؤشرات واتساب<small>بتوقيت القاهرة • قراءة فقط</small></h1><button type="button" class="wkp-btn" data-kp-reload aria-label="تحديث">↻</button></div>', '<div class="wkp-head"><button type="button" class="wkp-btn" data-kp-back aria-label="Back">← Back</button><h1>WhatsApp KPIs<small>Cairo time • read-only</small></h1><button type="button" class="wkp-btn" data-kp-reload aria-label="Refresh">↻</button></div>') +
    T('<div class="wkp-filter"><div class="wkp-seg" role="group" aria-label="الفترة">', '<div class="wkp-filter"><div class="wkp-seg" role="group" aria-label="Period">') + seg + '</div>' +
    '<div class="wkp-dates"' + (KPW.preset === 'custom' ? '' : ' hidden') + T('><label>من <input type="date" data-kp-from value="', '><label>From <input type="date" data-kp-from value="') + kpEsc(KPW.fromKey) + T('"></label><label>إلى <input type="date" data-kp-to value="', '"></label><label>To <input type="date" data-kp-to value="') + kpEsc(KPW.toKey) + '"></label></div></div>';
  if (!KPW.data) return '<div class="wkp">' + head + '<div class="wkp-msg' + (KPW.err ? ' err' : '') + '" role="status">' + (KPW.err ? kpEsc(KPW.err) : T('جارٍ تحميل المؤشرات…', 'Loading KPIs…')) + '</div></div>';
  var now = Date.now(), rg = kpRange(KPW.preset, now, KPW.fromKey, KPW.toKey), r = kpCompute(KPW.data, { from: rg.from, to: rg.to, now: now }), hl = kpHeadline(KPW.data, now);
  var label = KPW.preset === 'today' ? T('اليوم', 'Today') : KPW.preset === '7d' ? T('آخر 7 أيام', 'Last 7 days') : KPW.preset === '30d' ? T('آخر 30 يوم', 'Last 30 days') : (kpDayKey(rg.from) + ' ← ' + kpDayKey(rg.to - 1));
  function k(cls, key, l, v, sub) { return '<div class="wkp-k' + (cls ? ' ' + cls : '') + '" data-kpi="' + key + '"><span>' + l + '</span><b>' + kpEsc(v) + '</b><i>' + kpEsc(sub || ' ') + '</i></div>'; }
  var fr = r.firstResponse;
  var out = '<div class="wkp">' + head + (KPW.err ? '<div class="wkp-msg err" role="status">' + kpEsc(KPW.err) + T(' (المعروض آخر بيانات اتحملت)</div>', ' (showing the last loaded data)</div>') : '') +
    '<div class="wkp-grid" aria-label="' + kpEsc(label) + '">' +
    k('acc', 'chats', T('محادثات • ', 'Chats • ') + label, r.chats, r.inMsgs + T(' رسالة من العملاء', ' customer messages')) +
    k('', 'msgs', T('رسائل • ', 'Messages • ') + label, r.msgs, T('صيدلي ', 'Staff ') + r.staffMsgs + T(' • بوت ', ' • Bot ') + r.botMsgs) +
    k(r.waitingOpen ? 'warn' : 'ok', 'waiting', T('بانتظار الرد الآن', 'Waiting now'), r.waitingOpen, T('آخر 24 ساعة', 'Last 24 hours')) +
    k('', 'avg', T('متوسط أول رد للصيدلي', 'Avg staff first reply'), kpD(fr.avg), fr.n ? fr.n + T(' رد', ' replies') : T('مفيش ردود', 'No replies')) +
    k('', 'median', T('وسيط أول رد للصيدلي', 'Median staff first reply'), kpD(fr.median), T('نص الردود أسرع من كده', 'Half of replies are faster')) +
    k('', 'media', T('وسائط', 'Media'), r.mediaTotal, T('صور وصوت وملفات', 'Images, audio, files')) + '</div>';
  var t = hl.today, y = hl.yesterday;
  out += T('<div class="wkp-two"><section class="wkp-sec" data-sec="today"><h2>النهارده مقابل امبارح</h2><div class="wkp-tv">', '<div class="wkp-two"><section class="wkp-sec" data-sec="today"><h2>Today vs yesterday</h2><div class="wkp-tv">') +
    T('<div data-tv="chats"><span>محادثات</span><b>', '<div data-tv="chats"><span>Chats</span><b>') + t.chats + T('</b><em>أمس ', '</b><em>Yesterday ') + y.chats + '</em></div>' +
    T('<div data-tv="msgs"><span>رسائل</span><b>', '<div data-tv="msgs"><span>Messages</span><b>') + t.msgs + T('</b><em>أمس ', '</b><em>Yesterday ') + y.msgs + '</em></div>' +
    T('<div data-tv="avg"><span>متوسط أول رد</span><b>', '<div data-tv="avg"><span>Avg first reply</span><b>') + kpD(t.firstResponse.avg) + T('</b><em>أمس ', '</b><em>Yesterday ') + kpD(y.firstResponse.avg) + '</em></div>' +
    T('<div data-tv="median"><span>وسيط أول رد</span><b>', '<div data-tv="median"><span>Median first reply</span><b>') + kpD(t.firstResponse.median) + T('</b><em>أمس ', '</b><em>Yesterday ') + kpD(y.firstResponse.median) + '</em></div></div></section>' +
    T('<section class="wkp-sec" data-sec="trend"><h2>الاتجاه<div class="wkp-seg sm" role="group" aria-label="مدة الاتجاه"><button type="button" data-kp-trend="7" aria-pressed="', '<section class="wkp-sec" data-sec="trend"><h2>Trend<div class="wkp-seg sm" role="group" aria-label="Trend length"><button type="button" data-kp-trend="7" aria-pressed="') + (KPW.trendN === 7) + T('">7 أيام</button><button type="button" data-kp-trend="30" aria-pressed="', '">7 days</button><button type="button" data-kp-trend="30" aria-pressed="') + (KPW.trendN === 30) + T('">30 يوم</button></div></h2>', '">30 days</button></div></h2>') + kpTrendHtml(KPW.trendN) + '</section></div>';
  KPW.wait = r.waiting;
  var wl = r.waiting.slice(0, 50).map(function (w) {
    return '<li><button type="button" class="' + (w.open ? 'open' : 'closed') + '" data-kp-chat="' + kpEsc(w.c) + '"><span class="n">' + kpEsc(w.name) + '<span class="s">' + (w.open ? T('مستني من ', 'Waiting since ') + kpClockStr(w.t) : T('عدّت 24 ساعة — واتساب مش هيسمح بالرد لحد ما يكتب تاني', 'Over 24h — WhatsApp allows a reply only after the customer writes again')) + '</span></span><span class="d" data-wait-dur>' + kpD(w.d) + '</span></button></li>';
  }).join('');
  out += T('<section class="wkp-sec" data-sec="waiting"><h2>بانتظار الرد<small>', '<section class="wkp-sec" data-sec="waiting"><h2>Waiting for a reply<small>') + r.waitingOpen + T(' مفتوحة • ', ' open • ') + (r.waiting.length - r.waitingOpen) + T(' قديمة • اضغط لفتح المحادثة</small></h2>', ' older • tap to open the chat</small></h2>') +
    (wl ? '<ul class="wkp-wait">' + wl + '</ul>' : T('<p class="wkp-foot">مفيش عملاء مستنيين رد. 👏</p>', '<p class="wkp-foot">Nobody is waiting for a reply. 👏</p>')) + '</section>';
  out += T('<section class="wkp-sec" data-sec="heat"><h2>أوقات الذروة<small>رسائل العملاء • ', '<section class="wkp-sec" data-sec="heat"><h2>Busiest hours<small>Customer messages • ') + kpEsc(label) + '</small></h2>' + kpHeatHtml(r) + '</section>';
  var c = r.customers, np = c.total ? Math.round(c.newC / c.total * 100) : 0;
  var sMax = 1; r.staff.forEach(function (x) { sMax = Math.max(sMax, x.n); }); sMax = Math.max(sMax, r.botMsgs);
  var staff = r.staff.map(function (x) { return '<div class="wkp-bar" data-staff="' + kpEsc(x.name) + '"><span class="l">' + kpEsc(x.name || T('صيدلي (بدون اسم)', 'Staff (no name)')) + '</span><span class="t"><i style="width:' + Math.round(x.n / sMax * 100) + '%"></i></span><span class="v">' + x.n + '</span></div>'; }).join('');
  if (r.botMsgs) staff += T('<div class="wkp-bar bot" data-staff-bot><span class="l">البوت (للمقارنة)</span><span class="t"><i style="width:', '<div class="wkp-bar bot" data-staff-bot><span class="l">Bot (for comparison)</span><span class="t"><i style="width:') + Math.round(r.botMsgs / sMax * 100) + '%"></i></span><span class="v">' + r.botMsgs + '</span></div>';
  out += T('<div class="wkp-two"><section class="wkp-sec" data-sec="customers"><h2>عملاء جدد وعائدين<small>', '<div class="wkp-two"><section class="wkp-sec" data-sec="customers"><h2>New vs returning customers<small>') + kpEsc(label) + '</small></h2>' +
    T('<div class="wkp-tv"><div data-cust="new"><span>جدد</span><b>', '<div class="wkp-tv"><div data-cust="new"><span>New</span><b>') + c.newC + T('</b></div><div data-cust="ret"><span>عائدين</span><b>', '</b></div><div data-cust="ret"><span>Returning</span><b>') + c.returning + '</b></div></div>' +
    T('<div class="wkp-split" role="img" aria-label="جدد ', '<div class="wkp-split" role="img" aria-label="New ') + np + T('٪"><i style="width:', '%"><i style="width:') + np + '%;background:#60b99b"></i><i style="width:' + (c.total ? 100 - np : 0) + '%;background:#76b8d5"></i></div>' +
    T('<p class="wkp-foot">جديد = أول رسالة ليه في الفترة دي. عائد = كتب قبل كده.</p></section>', '<p class="wkp-foot">New = first-ever message in this period. Returning = wrote before.</p></section>') +
    T('<section class="wkp-sec" data-sec="staff"><h2>ردود كل صيدلي<small>', '<section class="wkp-sec" data-sec="staff"><h2>Replies per staff member<small>') + r.staffMsgs + T(' رد</small></h2>', ' replies</small></h2>') + (staff ? '<div class="wkp-bars">' + staff + '</div>' : T('<p class="wkp-foot">مفيش ردود في الفترة دي.</p>', '<p class="wkp-foot">No replies in this period.</p>')) + '</section></div>';
  out += T('<section class="wkp-sec" data-sec="media"><h2>الوسائط<small>', '<section class="wkp-sec" data-sec="media"><h2>Media<small>') + r.mediaTotal + ' • ' + kpEsc(label) + '</small></h2><div class="wkp-chips">' +
    kpMediaList().map(function (m) { return '<span class="wkp-chip" data-media="' + m[0] + '">' + m[1] + '<b>' + (r.media[m[0]] || 0) + '</b></span>'; }).join('') + '</div></section>';
  out += T('<ul class="wkp-foot"><li>أول رد = الوقت من أول رسالة للعميل مستنية لحد أول رد من الصيدلي (ردود البوت مش محسوبة).</li><li>بانتظار الرد = آخر رسالة في المحادثة من العميل. المفتوحة = أقل من 24 ساعة.</li><li>آخر تحديث ', '<ul class="wkp-foot"><li>First reply = time from the first waiting customer message to the first staff reply (bot replies do not count).</li><li>Waiting = the latest message in the chat is from the customer. Open = under 24 hours.</li><li>Last update ') + kpClockStr(KPW.at) + '.</li></ul></div>';
  return out;
}
function kpClockStr(t) { var p = kpParts(t); return kpPad(p.h) + ':' + kpPad(p.mi); }
var kpCardEl = null, kpViewEl = null, kpLastFocus = null;
function kpPaint() {
  var dir = kpEn() ? 'ltr' : 'rtl';
  if (kpCardEl) { kpCardEl.dir = dir; kpCardEl.setAttribute('aria-label', T('مؤشرات واتساب النهارده — افتح صفحة المؤشرات', 'Today\'s WhatsApp KPIs — open the KPIs page')); kpCardEl.innerHTML = kpCardHtml(); }
  if (kpViewEl) { kpViewEl.dir = dir; kpViewEl.setAttribute('aria-label', T('مؤشرات واتساب', 'WhatsApp KPIs')); }
  if (kpViewEl && KPW.open) {
    var f = document.activeElement, sel = f && kpViewEl.contains(f) ? (f.getAttribute('data-kp-preset') ? '[data-kp-preset="' + f.getAttribute('data-kp-preset') + '"]' : f.getAttribute('data-kp-trend') ? '[data-kp-trend="' + f.getAttribute('data-kp-trend') + '"]' : f.hasAttribute('data-kp-from') ? '[data-kp-from]' : f.hasAttribute('data-kp-to') ? '[data-kp-to]' : f.hasAttribute('data-kp-reload') ? '[data-kp-reload]' : null) : null;
    var st = kpViewEl.scrollTop;
    kpViewEl.innerHTML = kpPageHtml(); kpViewEl.scrollTop = st;
    if (sel) { var n = kpViewEl.querySelector(sel); if (n) try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
  }
}
function kpOpenPage() {
  if (!kpViewEl) return;
  kpLastFocus = document.activeElement;
  KPW.open = true; kpViewEl.hidden = false; kpViewEl.scrollTop = 0;
  try { document.documentElement.style.overflow = 'hidden'; } catch (e) { }
  kpPaint(); kpLoad(true);
  var b = kpViewEl.querySelector('[data-kp-back]'); if (b) b.focus();
}
function kpClosePage(noFocus) {
  if (!kpViewEl) return;
  KPW.open = false; kpViewEl.hidden = true;
  try { document.documentElement.style.overflow = ''; } catch (e) { }
  if (!noFocus && kpLastFocus && kpLastFocus.focus) try { kpLastFocus.focus(); } catch (e) { }
  kpPaint();
}
// Open one chat in المحادثات exactly like a pharmacist tap: show the inbox, then click that row. Sends nothing.
function kpOpenChat(id) {
  kpClosePage(true);
  var btn = document.getElementById('novaWaBtn') || document.querySelector('[data-wa-inbox-open]');
  if (!btn) return;
  btn.click();
  var tries = 0;
  (function look() {
    var box = document.getElementById('novaInboxView'), row = null;
    if (box) { var rows = box.querySelectorAll('[data-conv]'); for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-conv') === id) { row = rows[i]; break; } }
    if (row) { row.click(); return; }
    if (++tries < 60) setTimeout(look, 200);
  })();
}
function kpInit() {
  if (!kpFlagOn()) {
    window.novaWaKpis = { open: function () {}, close: function () {}, reload: function () {}, enabled: false };
    return;
  }
  var ws = document.querySelector('.pos-root .main-workspace');
  if (ws && !document.getElementById('novaWaKpiCard')) {
    kpCardEl = document.createElement('button');
    kpCardEl.type = 'button'; kpCardEl.id = 'novaWaKpiCard'; kpCardEl.dir = 'rtl';
    kpCardEl.setAttribute('aria-label', T('مؤشرات واتساب النهارده — افتح صفحة المؤشرات', 'Today\'s WhatsApp KPIs — open the KPIs page'));
    var hdr = ws.querySelector('.top-header');
    if (hdr && hdr.parentNode === ws) ws.insertBefore(kpCardEl, hdr.nextSibling); else ws.insertBefore(kpCardEl, ws.firstChild);
    kpCardEl.addEventListener('click', kpOpenPage);
  }
  if (!document.getElementById('novaWaKpiView')) {
    kpViewEl = document.createElement('div');
    kpViewEl.id = 'novaWaKpiView'; kpViewEl.dir = 'rtl'; kpViewEl.hidden = true;
    kpViewEl.setAttribute('role', 'dialog'); kpViewEl.setAttribute('aria-modal', 'true'); kpViewEl.setAttribute('aria-label', T('مؤشرات واتساب', 'WhatsApp KPIs'));
    document.body.appendChild(kpViewEl);
    kpViewEl.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-kp-back]')) { kpClosePage(); return; }
      if (t.closest('[data-kp-reload]')) { kpLoad(true); return; }
      var p = t.closest('[data-kp-preset]');
      if (p) {
        KPW.preset = p.getAttribute('data-kp-preset');
        if (KPW.preset === 'custom' && !KPW.fromKey) { var tk = kpDayKey(Date.now()); KPW.fromKey = kpDayKey(kpDaysBack(Date.now(), 7)); KPW.toKey = tk; }
        kpPaint(); return;
      }
      var tr = t.closest('[data-kp-trend]'); if (tr) { KPW.trendN = +tr.getAttribute('data-kp-trend') === 30 ? 30 : 7; kpPaint(); return; }
      var ch = t.closest('[data-kp-chat]'); if (ch) { kpOpenChat(ch.getAttribute('data-kp-chat')); }
    });
    kpViewEl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-kp-from')) { KPW.fromKey = t.value; KPW.preset = 'custom'; kpPaint(); }
      else if (t.hasAttribute('data-kp-to')) { KPW.toKey = t.value; KPW.preset = 'custom'; kpPaint(); }
    });
    kpViewEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); kpClosePage(); } });
  }
  kpPaint();
  var kpLang = kpEn();
  try { new MutationObserver(function () { var e = kpEn(); if (e !== kpLang) { kpLang = e; kpPaint(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) { }
  if (kpAuto()) {
    setTimeout(function () { kpLoad(false); }, 1200);
    setInterval(function () { if (document.visibilityState === 'visible' && kpCardEl && kpCardEl.offsetParent && !KPW.open) kpLoad(true); }, 300000);
  }
  window.novaWaKpis = { open: kpOpenPage, close: kpClosePage, reload: function () { kpLoad(true); }, enabled: true };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kpInit); else kpInit();
})();
