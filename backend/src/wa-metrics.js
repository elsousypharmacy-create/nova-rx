// UX300: WhatsApp customer-service metrics (pure functions, no I/O).
// The block between BEGIN-SHARED and END-SHARED is plain ES5 and is copied VERBATIM into index.html
// (tests/unit/ux300-wa-metrics.check.mjs fails if the two copies differ), so the server tags events with the
// same code the dashboard uses to compute and filter. All times are epoch ms; display is Africa/Cairo.
// BEGIN-SHARED
var WA_TZ = 'Africa/Cairo';
var WA_TOPICS = [
  { id: 'avail', ar: 'توفر دواء', re: /متوفر|موجود|عندكم|متاح/ },
  { id: 'price', ar: 'سعر', re: /بكام|سعر|ثمن|كام/ },
  { id: 'delivery', ar: 'توصيل', re: /توصيل|ديليفري|دليفري|يوصل|عنوان/ },
  { id: 'order', ar: 'طلب / أوردر', re: /اوردر|طلب|اطلب|احجز/ },
  { id: 'rx', ar: 'روشتة', re: /روشت|وصفه|تذكره/ },
  { id: 'alt', ar: 'بديل', re: /بديل|مثيل/ },
  { id: 'hours', ar: 'مواعيد', re: /مواعيد|فاتح|مفتوح|بتقفلوا/ },
  { id: 'dose', ar: 'جرعة واستخدام', re: /جرعه|استخدام|اعراض|ينفع|مضاد/ }
];
function waNorm(s) {
  return String(s == null ? '' : s).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}
function waIsHandoff(text) { return /اتحول\s+(لل|ل)?صيدلي/.test(waNorm(text)); }
function waTopics(text) {
  var n = waNorm(text), out = [];
  for (var i = 0; i < WA_TOPICS.length; i++) if (WA_TOPICS[i].re.test(n)) out.push(WA_TOPICS[i].id);
  return out;
}
function waTs(v) { var n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; }
var _waFmt = null;
function waParts(t) {
  if (!_waFmt) _waFmt = new Intl.DateTimeFormat('en-US', { timeZone: WA_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  var o = {};
  _waFmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday] };
}
function waOffset(t) { var p = waParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; }
function waDayStart(t) { var p = waParts(t), g = Date.UTC(p.y, p.mo - 1, p.d), s = g - waOffset(g); return g - waOffset(s); }
function waNextDay(t) { return waDayStart(waDayStart(t) + 30 * 3600000); }
function waDayKey(t) { var p = waParts(t); return p.y + '-' + (p.mo < 10 ? '0' : '') + p.mo + '-' + (p.d < 10 ? '0' : '') + p.d; }
function waKeyStart(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key)); return m ? waDayStart(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; }
function waPad(n) { return (n < 10 ? '0' : '') + n; }
function waClock(t) { var p = waParts(t); return waPad(p.h) + ':' + waPad(p.mi); }
function waDateTime(t) { var p = waParts(t); return waDayKey(t) + ' ' + waPad(p.h) + ':' + waPad(p.mi) + ':' + waPad(p.s); }
function waDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return 'أقل من ثانية';
  var s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return d + ' يوم' + (h ? ' ' + h + ' س' : '');
  if (h) return h + ' س' + (m ? ' ' + m + ' د' : '');
  if (m) return m + ' د' + (r ? ' ' + r + ' ث' : '');
  return r + ' ث';
}
function waRange(preset, now) {
  var s = waDayStart(now);
  if (preset === 'today') return { from: s, to: Infinity };
  if (preset === '7d') return { from: waDayStart(s - 6 * 86400000 + 3600000), to: Infinity };
  if (preset === '30d') return { from: waDayStart(s - 29 * 86400000 + 3600000), to: Infinity };
  return { from: -Infinity, to: Infinity };
}
function waResponder(k) { return k === 'bot' ? 'bot' : (k === 'pharm' || k === 'out') ? 'pharm' : null; }
function waStats(items) {
  var n = items.length;
  if (!n) return { n: 0, min: null, median: null, mean: null, p90: null, max: null, maxItem: null };
  var a = items.slice().sort(function (x, y) { return x.d - y.d; }), sum = 0;
  for (var i = 0; i < n; i++) sum += a[i].d;
  return { n: n, min: a[0].d, median: n % 2 ? a[(n - 1) / 2].d : (a[n / 2 - 1].d + a[n / 2].d) / 2, mean: sum / n, p90: a[Math.ceil(0.9 * n) - 1].d, max: a[n - 1].d, maxItem: a[n - 1] };
}
// data = { customers:[{id,name}], events:[{c, k:'in'|'bot'|'pharm'|'out'|'sys', t, h?:1, tp?:[topicId]}] }
// o = { from, to, who:'all'|'bot'|'pharm', now }. Range filters the CUSTOMER message time (handoffs: the handoff time).
function waCompute(data, o) {
  o = o || {};
  var now = o.now || Date.now(), who = o.who === 'bot' || o.who === 'pharm' ? o.who : 'all';
  var from = o.from == null ? -Infinity : o.from, to = o.to == null ? Infinity : o.to;
  var names = {}, byC = {}, ids = [];
  (data.customers || []).forEach(function (c) { names[c.id] = c.name || c.id; });
  (data.events || []).forEach(function (e, i) {
    var t = waTs(e.t);
    if (!t) return;
    if (!byC[e.c]) { byC[e.c] = []; ids.push(e.c); }
    byC[e.c].push({ c: e.c, k: e.k, t: t, h: !!e.h, tp: e.tp || [], i: i });
  });
  var msgs = [], handoffs = [], firsts = [], waiting = [], custN = {}, newC = {}, convSet = {}, topics = {};
  var days = {}, hours = [], heat = [], totalMsgs = 0, inMsgs = 0, outMsgs = 0, h, w;
  for (h = 0; h < 24; h++) hours.push({ msgs: 0, inMsgs: 0, convs: {} });
  for (w = 0; w < 7; w++) { heat.push([]); for (h = 0; h < 24; h++) heat[w].push(0); }
  function nm(c) { return names[c] || c; }
  ids.forEach(function (c) {
    var ev = byC[c].sort(function (a, b) { return a.t - b.t || a.i - b.i; }), n = ev.length, nextRep = null, i, e, firstIn = null;
    for (i = 0; i < n; i++) { if (ev[i].k === 'in') { firstIn = ev[i]; break; } }
    for (i = n - 1; i >= 0; i--) {
      e = ev[i];
      if (waResponder(e.k)) nextRep = e;
      var inR = e.t >= from && e.t < to;
      if (inR && e.k !== 'sys') {
        convSet[c] = 1; totalMsgs++;
        var p = waParts(e.t), dk = waDayKey(e.t), dd = days[dk] || (days[dk] = { key: dk, msgs: 0, inMsgs: 0, convs: {}, custs: {} });
        dd.msgs++; dd.convs[c] = (dd.convs[c] || 0) + 1; hours[p.h].msgs++; hours[p.h].convs[c] = (hours[p.h].convs[c] || 0) + 1;
        if (e.k === 'in') { inMsgs++; dd.inMsgs++; dd.custs[c] = 1; hours[p.h].inMsgs++; heat[p.wd][p.h]++; } else outMsgs++;
      }
      if (e.k === 'in' && inR) {
        custN[c] = (custN[c] || 0) + 1;
        if (e === firstIn) newC[c] = 1;
        e.tp.forEach(function (id) { (topics[id] = topics[id] || {})[c] = (topics[id][c] || 0) + 1; });
        var rep = nextRep, it = { c: c, name: nm(c), t: e.t, rt: rep ? rep.t : null, d: rep ? rep.t - e.t : null, by: rep ? waResponder(rep.k) : null };
        msgs.push(it);
        if (e === firstIn) firsts.push(it);
      }
      if (e.h && inR) handoffs.push({ c: c, name: nm(c), t: e.t, rt: nextRep ? nextRep.t : null, d: nextRep && waResponder(nextRep.k) === 'pharm' ? nextRep.t - e.t : null, by: nextRep ? waResponder(nextRep.k) : null, pend: !(nextRep && waResponder(nextRep.k) === 'pharm') });
    }
  });
  function byT(a, b) { return a.t - b.t; }
  msgs.sort(byT); handoffs.sort(byT); firsts.sort(byT);
  // waiting-now: conversations whose last customer-facing message is from the customer (state at `now`, not range-bound)
  ids.forEach(function (c) {
    var ev = byC[c], i, firstWait = null;
    for (i = ev.length - 1; i >= 0; i--) {
      if (ev[i].k === 'sys') continue;
      if (ev[i].k === 'in') firstWait = ev[i]; else break;
    }
    if (firstWait) waiting.push({ c: c, name: nm(c), t: firstWait.t, d: Math.max(0, now - firstWait.t), by: null });
  });
  waiting.sort(function (a, b) { return b.d - a.d; });
  var answered = msgs.filter(function (m) { return m.rt != null; }), unans = msgs.filter(function (m) { return m.rt == null; });
  var scope = answered.filter(function (m) { return who === 'all' || m.by === who; });
  var scopeFirst = firsts.filter(function (m) { return m.rt != null && (who === 'all' || m.by === who); });
  var den = scope.length + unans.length, within = {};
  [1, 5, 15, 60].forEach(function (mn) {
    var l = scope.filter(function (m) { return m.d <= mn * 60000; });
    within[mn] = { n: l.length, den: den, pct: den ? Math.round((l.length / den) * 1000) / 10 : null, items: l };
  });
  var botL = answered.filter(function (m) { return m.by === 'bot'; }), phL = answered.filter(function (m) { return m.by === 'pharm'; });
  var hoAns = handoffs.filter(function (x) { return !x.pend; });
  var unansH = msgs.filter(function (m) { return m.by !== 'pharm'; });
  var custList = Object.keys(custN).map(function (c) { return { c: c, name: nm(c), n: custN[c], t: null, d: null }; });
  var dayList = [], ks = Object.keys(days).sort(), cur = isFinite(from) ? waDayStart(from) : (ks.length ? waKeyStart(ks[0]) : null);
  var last = isFinite(to) ? waDayStart(to - 1) : (isFinite(from) ? waDayStart(now) : (ks.length ? waKeyStart(ks[ks.length - 1]) : null)), guard = 0;
  while (cur !== null && last !== null && cur <= last && guard++ < 800) {
    var key = waDayKey(cur), d0 = days[key];
    dayList.push({ key: key, msgs: d0 ? d0.msgs : 0, inMsgs: d0 ? d0.inMsgs : 0, convs: d0 ? Object.keys(d0.convs).length : 0, custs: d0 ? Object.keys(d0.custs).length : 0, wd: waParts(cur + 3600000).wd });
    cur = waNextDay(cur);
  }
  var drill = { replies: scope, first: scopeFirst, bot: botL, pharm: phL, slowest: scope.length ? [waStats(scope).maxItem] : [], unanswered: unans, waiting: waiting, handoff: handoffs, handoffAns: hoAns, customers: custList,
    newC: custList.filter(function (x) { return newC[x.c]; }), returning: custList.filter(function (x) { return !newC[x.c]; }) };
  [1, 5, 15, 60].forEach(function (mn) { drill['w' + mn] = within[mn].items; });
  function cl(map) { return Object.keys(map).map(function (c) { return { c: c, name: nm(c), n: map[c] }; }); }
  Object.keys(days).forEach(function (k) { drill['d:' + k] = cl(days[k].convs); });
  hours.forEach(function (x, hh) { drill['h:' + hh] = cl(x.convs); });
  var topicList = WA_TOPICS.filter(function (t) { return topics[t.id]; }).map(function (t) { var c = topics[t.id]; drill['t:' + t.id] = cl(c); return { id: t.id, ar: t.ar, n: Object.keys(c).reduce(function (a, k2) { return a + c[k2]; }, 0), customers: Object.keys(c).length }; }).sort(function (a, b) { return b.n - a.n; });
  return {
    who: who, from: from, to: to, now: now,
    all: waStats(scope), first: waStats(scopeFirst), bot: waStats(botL), pharm: waStats(phL), handoff: waStats(hoAns),
    within: within, answered: answered.length, unanswered: unans.length, unansweredNoHuman: unansH.length, inMsgs: inMsgs,
    handoffs: { n: handoffs.length, answered: hoAns.length, pending: handoffs.length - hoAns.length },
    waiting: waiting.length,
    volume: { customers: custList.length, newC: drill.newC.length, returning: drill.returning.length, convs: Object.keys(convSet).length, msgs: totalMsgs, inMsgs: inMsgs, outMsgs: outMsgs },
    days: dayList, hours: hours.map(function (x) { return { msgs: x.msgs, inMsgs: x.inMsgs, convs: Object.keys(x.convs).length }; }), heat: heat, topics: topicList, drill: drill
  };
}
// END-SHARED
export { WA_TZ, WA_TOPICS, waNorm, waIsHandoff, waTopics, waTs, waParts, waDayStart, waNextDay, waDayKey, waKeyStart, waClock, waDateTime, waDur, waRange, waResponder, waStats, waCompute };
