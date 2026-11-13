/* NOVA Rx — BI-03 inventory analysis (pure logic, no DOM, no network, frontend/local only).
   ABC (by baseline revenue), FSN (by selling-day frequency), dead stock, shortage, expiry, turnover, days of cover.
   Baseline demand EXCLUDES promo lines and incomplete days (the running day `now` + opts.incompleteDays).
   Every item gets recommendations, each with an Arabic + English reason. Works as <script> (window.NovaInventoryBI) and in Node. */
(function (root) {
  'use strict';
  var DAY = 86400000;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function dayKey(t) { return Math.floor(num(t) / DAY); }
  function fail(code) { var e = new Error(code); e.code = code; throw e; }

  /* data: { items:[{id,name,onHand,minLevel?,lots:[{lot,qty,expiresAt}]}], sales:[{itemId,qty,price,at,promo?,voided?}] }
     opts: { now (ms), windowDays=90, deadDays=90, expiryWarnDays=90, leadDays=7, incompleteDays:[ms|dayKey?] (ms timestamps) } */
  function analyze(data, opts) {
    opts = opts || {}; data = data || {};
    var now = num(opts.now);
    if (!(now > 0)) fail('bad-now');
    var windowDays = num(opts.windowDays) || 90, deadDays = num(opts.deadDays) || 90;
    var warn = num(opts.expiryWarnDays) || 90, lead = num(opts.leadDays) || 7;
    var today = dayKey(now), from = today - windowDays;
    var bad = {}; bad[today] = true;
    arr(opts.incompleteDays).forEach(function (t) { bad[dayKey(t)] = true; });
    var usable = 0;
    for (var d = from; d < today; d++) if (!bad[d]) usable++;

    var stat = {};
    arr(data.sales).forEach(function (s) {
      if (!s || s.voided || !s.itemId) return;
      var st = stat[s.itemId] || (stat[s.itemId] = { qty: 0, rev: 0, days: {}, last: 0 });
      var t = num(s.at); if (t > now) return;
      if (t > st.last) st.last = t;
      var k = dayKey(t);
      if (s.promo || bad[k] || k < from) return;
      st.qty += num(s.qty); st.rev += num(s.qty) * num(s.price); st.days[k] = true;
    });

    var rows = arr(data.items).filter(function (i) { return i && i.id; }).map(function (i) {
      var st = stat[i.id] || { qty: 0, rev: 0, days: {}, last: 0 };
      var onHand = num(i.onHand), daily = usable ? st.qty / usable : 0;
      var sellDays = Object.keys(st.days).length;
      var freq = usable ? sellDays / usable : 0;
      var fsn = st.qty <= 0 ? 'N' : (freq >= 0.2 ? 'F' : 'S');
      var cover = daily > 0 ? r2(onHand / daily) : null;
      var turnover = (onHand > 0 && daily > 0) ? r2(daily * 365 / onHand) : null;
      var dead = onHand > 0 && (!st.last || now - st.last > deadDays * DAY);
      var recs = [];
      var short = daily > 0 && (onHand <= 0 || cover < lead);
      if (short) recs.push({ code: 'reorder',
        ar: 'إعادة طلب: الرصيد ' + onHand + ' يكفي ' + (cover == null ? 0 : cover) + ' يوم فقط أقل من مهلة التوريد ' + lead + ' يوم (الطلب اليومي الأساسي ' + r2(daily) + ' بدون العروض والأيام غير المكتملة)',
        en: 'Reorder: on hand ' + onHand + ' covers ' + (cover == null ? 0 : cover) + ' days, below lead time ' + lead + ' (baseline daily demand ' + r2(daily) + ', promo and incomplete days excluded)' });
      if (dead) recs.push({ code: 'dead-stock',
        ar: 'مخزون راكد: لا مبيعات منذ أكثر من ' + deadDays + ' يوم والرصيد ' + onHand + ' — راجع الإرجاع للمورد أو التخفيض',
        en: 'Dead stock: no sales for over ' + deadDays + ' days with ' + onHand + ' on hand — consider supplier return or markdown' });
      var expiring = [], expired = [];
      arr(i.lots).forEach(function (l) {
        if (!l || !(num(l.qty) > 0) || !l.expiresAt) return;
        var left = Math.floor((num(l.expiresAt) - now) / DAY);
        if (left < 0) expired.push({ lot: l.lot, qty: num(l.qty), daysLeft: left });
        else if (left <= warn) expiring.push({ lot: l.lot, qty: num(l.qty), daysLeft: left, willSell: daily > 0 ? daily * left >= num(l.qty) : false });
      });
      if (expired.length) recs.push({ code: 'expired',
        ar: 'منتهي الصلاحية: ' + expired.length + ' تشغيلة — اسحبها من البيع فوراً', en: 'Expired: ' + expired.length + ' lot(s) — remove from sale now' });
      expiring.filter(function (e) { return !e.willSell; }).forEach(function (e) {
        recs.push({ code: 'expiry-risk',
          ar: 'خطر انتهاء: التشغيلة ' + e.lot + ' (' + e.qty + ') تنتهي بعد ' + e.daysLeft + ' يوم ولن تُباع بالمعدل الحالي',
          en: 'Expiry risk: lot ' + e.lot + ' (' + e.qty + ') expires in ' + e.daysLeft + ' days and will not sell at the current rate' });
      });
      return { id: i.id, name: i.name, onHand: onHand, baselineQty: st.qty, baselineRevenue: r2(st.rev), dailyDemand: r2(daily),
        fsn: fsn, abc: null, daysOfCover: cover, turnoverPerYear: turnover, deadStock: dead, shortage: short,
        expiring: expiring, expired: expired, recommendations: recs };
    });

    var total = rows.reduce(function (a, r) { return a + r.baselineRevenue; }, 0), cum = 0;
    rows.slice().sort(function (a, b) { return b.baselineRevenue - a.baselineRevenue; }).forEach(function (r) {
      if (!(r.baselineRevenue > 0) || !(total > 0)) { r.abc = 'C'; return; }
      var before = cum / total; cum += r.baselineRevenue;
      r.abc = before < 0.8 ? 'A' : (before < 0.95 ? 'B' : 'C');
    });
    return { usableDays: usable, windowDays: windowDays, items: rows,
      basis: 'baseline = non-promo sales on complete days in the last ' + windowDays + ' days (today and incompleteDays excluded); dead stock uses any sale incl. promo' };
  }

  var api = { analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaInventoryBI = api;
})(typeof window !== 'undefined' ? window : globalThis);
