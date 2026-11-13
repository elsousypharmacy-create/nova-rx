/* NOVA Rx — BI-01 indicator dictionary (pure logic, no DOM, no network).
   ONE source of definitions and formulas for POS, dashboard and exports. Money = integer piastres.
   Works as a <script> (window.NovaBI) and in Node (module.exports). */
(function (root) {
  'use strict';
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function int(n) { if (n == null) return 0; if (!isInt(n)) fail('bad-integer'); return n; }

  var INDICATORS = {
    gross:    { ar: 'الإجمالي',        en: 'Gross',    unit: 'piastres', rule: 'sum(qty × list price) of sold lines, before discount and returns' },
    discount: { ar: 'الخصم',           en: 'Discount', unit: 'piastres', rule: 'sum of line and invoice discounts, always >= 0' },
    return:   { ar: 'المرتجع',         en: 'Return',   unit: 'piastres', rule: 'sum of refunded amounts net of their discount share, always >= 0' },
    net:      { ar: 'الصافي',          en: 'Net',      unit: 'piastres', rule: 'gross − discount − return' },
    cost:     { ar: 'التكلفة',         en: 'Cost',     unit: 'piastres', rule: 'sum(qty × unit cost) of sold lines minus cost of returned units' },
    margin:   { ar: 'هامش الربح',      en: 'Margin',   unit: 'piastres', rule: 'net − cost' },
    marginPct:{ ar: 'نسبة الهامش',     en: 'Margin %', unit: 'bps',      rule: 'round(margin × 10000 / net) half up in basis points; 0 when net <= 0' },
    visits:   { ar: 'الزيارات',        en: 'Visits',   unit: 'count',    rule: 'count of distinct non-cancelled invoices (one invoice = one visit)' }
  };
  var ORDER = ['gross', 'discount', 'return', 'net', 'cost', 'margin', 'marginPct', 'visits'];

  function divRound(a, b) {
    var s = a < 0 ? -1 : 1, x = Math.abs(a), q = Math.floor(x / b);
    if ((x - q * b) * 2 >= b) q += 1;
    return s * q;
  }

  /* totals: {gross, discount, return, cost, visits} (integers) -> all indicators. */
  function compute(t) {
    t = t || {};
    var gross = int(t.gross), discount = int(t.discount), ret = int(t['return']), cost = int(t.cost), visits = int(t.visits);
    if (gross < 0 || discount < 0 || ret < 0 || cost < 0 || visits < 0) fail('negative-input');
    var net = gross - discount - ret, margin = net - cost;
    return { gross: gross, discount: discount, 'return': ret, net: net, cost: cost, margin: margin,
      marginPct: net > 0 ? divRound(margin * 10000, net) : 0, visits: visits };
  }

  /* invoices: [{status, lines:[{qty, price, cost, discount}], discount, returns:[{amount, cost}]}] */
  function fromInvoices(invoices) {
    var t = { gross: 0, discount: 0, 'return': 0, cost: 0, visits: 0 };
    (invoices || []).forEach(function (inv) {
      if (!inv || inv.status === 'cancelled') return;
      t.visits += 1;
      (inv.lines || []).forEach(function (l) {
        t.gross += int(l.qty) * int(l.price); t.cost += int(l.qty) * int(l.cost); t.discount += int(l.discount);
      });
      t.discount += int(inv.discount);
      (inv.returns || []).forEach(function (r) { t['return'] += int(r.amount); t.cost -= int(r.cost); });
    });
    return compute(t);
  }

  /* Display / export helpers share the same labels and formatting. */
  function label(key, lang) { var d = INDICATORS[key]; if (!d) fail('unknown-indicator'); return lang === 'en' ? d.en : d.ar; }
  function fmt(key, v) {
    if (!INDICATORS[key]) fail('unknown-indicator');
    var u = INDICATORS[key].unit;
    if (u === 'count') return String(v);
    var neg = v < 0, a = Math.abs(v);
    if (u === 'bps') return (neg ? '-' : '') + Math.floor(a / 100) + '.' + ('0' + (a % 100)).slice(-2) + '%';
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + ('0' + (a % 100)).slice(-2);
  }
  function toRows(result, lang) {
    return ORDER.map(function (k) { return { key: k, label: label(k, lang), value: result[k], text: fmt(k, result[k]) }; });
  }
  function toCsv(result, lang) {
    return '﻿' + 'indicator,value\r\n' + toRows(result, lang).map(function (r) { return r.label + ',' + r.text; }).join('\r\n') + '\r\n';
  }

  var api = { INDICATORS: INDICATORS, ORDER: ORDER, compute: compute, fromInvoices: fromInvoices, label: label, fmt: fmt, toRows: toRows, toCsv: toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaBI = api;
})(typeof window !== 'undefined' ? window : globalThis);
