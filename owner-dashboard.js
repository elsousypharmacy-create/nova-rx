/* NOVA Rx — BI-02 owner dashboard (pure logic + HTML string, no DOM access, no network, frontend/local only).
   Sections: today, month, team, stock, shortages, alerts. Each section is marked available | stale | unknown:
   unknown = source missing or without a valid updatedAt (value null, never guessed as 0);
   stale = updatedAt older than staleMs (default 15 min); available = fresh.
   refresh() keeps the current page and period. Works as <script> (window.NovaOwnerDashboard) and in Node. */
(function (root) {
  'use strict';
  var STALE_MS = 15 * 60000;
  var SECTIONS = ['today', 'month', 'team', 'stock', 'shortages', 'alerts'];
  var LABELS = { today: 'اليوم', month: 'الشهر', team: 'الفريق', stock: 'المخزون', shortages: 'النواقص', alerts: 'التنبيهات' };
  var STATUS_AR = { available: 'متاح', stale: 'قديم', unknown: 'غير معروف' };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function statusOf(src, now, staleMs) {
    if (!src || typeof src !== 'object' || src.updatedAt === null || src.updatedAt === '' || src.updatedAt === undefined || !isFinite(Number(src.updatedAt))) return 'unknown';
    return now - num(src.updatedAt) > staleMs ? 'stale' : 'available';
  }

  function sumSales(items, from, to) {
    var total = 0, invoices = 0;
    arr(items).forEach(function (s) {
      if (!s || s.voided || !(num(s.at) >= from && num(s.at) < to)) return;
      total += num(s.total) - num(s.refunded); invoices++;
    });
    return { net: r2(total), invoices: invoices };
  }

  function build(data, opts) {
    data = data || {}; opts = opts || {};
    var now = num(opts.now), staleMs = opts.staleMs > 0 ? opts.staleMs : STALE_MS;
    var d = new Date(now);
    var dayFrom = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var monthFrom = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    var out = {};
    SECTIONS.forEach(function (k) {
      var src = data[k] || (k === 'today' || k === 'month' ? data.sales : null);
      var st = statusOf(src, now, staleMs), value = null;
      if (st !== 'unknown') {
        if (k === 'today') value = sumSales(src.items, dayFrom, dayFrom + 86400000);
        else if (k === 'month') value = sumSales(src.items, monthFrom, now + 1);
        else if (k === 'team') value = arr(src.items).map(function (m) { return { name: String(m && m.name || ''), net: r2(num(m && m.net)), invoices: num(m && m.invoices) }; });
        else if (k === 'stock') value = { items: arr(src.items).length, lowCount: arr(src.items).filter(function (i) { return i && num(i.qty) <= num(i.min); }).length };
        else if (k === 'shortages') value = { count: arr(src.items).length };
        else value = arr(src.items).map(function (a) { return String(a && a.text || a || ''); });
      }
      out[k] = { key: k, label: LABELS[k], status: st, statusLabel: STATUS_AR[st], value: value, updatedAt: st === 'unknown' ? null : num(src.updatedAt) };
    });
    return out;
  }

  function createState(page, period) { return { page: page || 'today', period: period || 'day' }; }
  /* refresh recomputes data only; page and period are carried over untouched. */
  function refresh(state, data, opts) {
    return { state: { page: state.page, period: state.period }, sections: build(data, opts) };
  }

  function fmt(s) {
    var v = s.value;
    if (v === null) return '—';
    if (s.key === 'today' || s.key === 'month') return v.net + ' ج.م (' + v.invoices + ' فاتورة)';
    if (s.key === 'team') return v.length ? v.map(function (m) { return esc(m.name) + ': ' + m.net; }).join('، ') : '—';
    if (s.key === 'stock') return v.items + ' صنف، ' + v.lowCount + ' منخفض';
    if (s.key === 'shortages') return v.count + ' ناقص';
    return v.length ? v.map(esc).join('، ') : 'لا تنبيهات';
  }

  var CSS = '.nova-od{direction:rtl;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}' +
    '.nova-od .c{border:1px solid #444;border-radius:8px;padding:8px;min-width:0;overflow-wrap:anywhere}' +
    '.nova-od .c[data-status=stale]{opacity:.7}.nova-od .c[data-status=unknown]{opacity:.5}';

  function render(result) {
    var st = result.state;
    return '<style>' + CSS + '</style><div class="nova-od" dir="rtl" data-page="' + esc(st.page) + '" data-period="' + esc(st.period) + '">' +
      SECTIONS.map(function (k) {
        var s = result.sections[k];
        return '<section class="c" data-section="' + k + '" data-status="' + s.status + '"><h3>' + s.label + '</h3><div>' + fmt(s) + '</div><small>' + s.statusLabel + '</small></section>';
      }).join('') + '</div>';
  }

  var api = { build: build, createState: createState, refresh: refresh, render: render, statusOf: statusOf, SECTIONS: SECTIONS, STALE_MS: STALE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaOwnerDashboard = api;
})(typeof window !== 'undefined' ? window : globalThis);
