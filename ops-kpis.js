/* NOVA Rx — OPS-02 fair operational KPIs (pure logic, no DOM, no network, frontend/local only).
   Per-employee KPIs: sales, net, invoices, average, visits, new customers, clocked time.
   Every KPI carries an explicit source and denominator. Records without an explicit employeeId are NEVER
   auto-attributed: they are counted in `unattributed` and excluded. No visual/subjective scoring.
   Ratios with a zero denominator are null (not 0). Works as <script> (window.NovaOpsKpis) and in Node. */
(function (root) {
  'use strict';

  var SOURCES = Object.freeze({
    sales: 'sales[].total where employeeId = employee, at in period, not voided',
    net: 'sales.total minus sales[].refunded (same records)',
    invoices: 'count of sales records (same records)',
    average: 'net',
    visits: 'visits[] where employeeId = employee, at in period',
    newCustomers: 'customers[] where createdBy = employee, createdAt in period',
    clockedMinutes: 'clock[] closed entries (inAt and outAt) clipped to period'
  });
  var DENOMINATORS = Object.freeze({
    sales: 'none (absolute EGP)',
    net: 'none (absolute EGP)',
    invoices: 'none (count)',
    average: 'invoices (null when 0)',
    visits: 'none (count)',
    newCustomers: 'none (count)',
    clockedMinutes: 'none (minutes); salesPerClockedHour uses clockedMinutes/60 (null when 0)'
  });

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function inPeriod(t, p) { t = num(t); return t >= p.from && t < p.to; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  function computeEmployeeKpis(data, employeeId, period) {
    if (!employeeId || typeof employeeId !== 'string') { var e = new Error('bad-employee'); e.code = 'bad-employee'; throw e; }
    if (!period || !(num(period.to) > num(period.from))) { var e2 = new Error('bad-period'); e2.code = 'bad-period'; throw e2; }
    var p = { from: num(period.from), to: num(period.to) };
    data = data || {};
    var unattributed = { sales: 0, visits: 0, newCustomers: 0, clock: 0, openClock: 0 };

    var sales = 0, refunded = 0, invoices = 0;
    arr(data.sales).forEach(function (s) {
      if (!s || s.voided || !inPeriod(s.at, p)) return;
      if (!s.employeeId) { unattributed.sales++; return; }
      if (s.employeeId !== employeeId) return;
      sales += num(s.total); refunded += num(s.refunded); invoices++;
    });

    var visits = 0;
    arr(data.visits).forEach(function (v) {
      if (!v || !inPeriod(v.at, p)) return;
      if (!v.employeeId) { unattributed.visits++; return; }
      if (v.employeeId === employeeId) visits++;
    });

    var newCustomers = 0;
    arr(data.customers).forEach(function (c) {
      if (!c || !inPeriod(c.createdAt, p)) return;
      if (!c.createdBy) { unattributed.newCustomers++; return; }
      if (c.createdBy === employeeId) newCustomers++;
    });

    var ms = 0;
    arr(data.clock).forEach(function (c) {
      if (!c) return;
      if (!c.employeeId) { unattributed.clock++; return; }
      if (c.employeeId !== employeeId) return;
      if (c.outAt == null) { unattributed.openClock++; return; } /* open entry: not counted, never guessed */
      var a = Math.max(num(c.inAt), p.from), b = Math.min(num(c.outAt), p.to);
      if (b > a) ms += b - a;
    });
    var minutes = Math.round(ms / 60000);

    var net = r2(sales - refunded);
    return {
      employeeId: employeeId,
      period: p,
      kpis: {
        sales: r2(sales),
        net: net,
        invoices: invoices,
        average: invoices ? r2(net / invoices) : null,
        visits: visits,
        newCustomers: newCustomers,
        clockedMinutes: minutes,
        salesPerClockedHour: minutes ? r2(net / (minutes / 60)) : null
      },
      sources: SOURCES,
      denominators: DENOMINATORS,
      unattributed: unattributed
    };
  }

  var api = { computeEmployeeKpis: computeEmployeeKpis, SOURCES: SOURCES, DENOMINATORS: DENOMINATORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaOpsKpis = api;
})(typeof window !== 'undefined' ? window : globalThis);
