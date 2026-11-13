/* NOVA Rx — UX-03 performance budget (pure local; no network). Budgets: interaction p95 <=100ms, search <=500ms,
   invoice save <=1000ms, LCP <=2500ms on a DOCUMENTED device/network profile. Time inside an external provider is
   measured with provider(ms-aware) wrappers and reported separately; it is never counted against the local budget.
   Works as <script> (window.NovaRxPerf) and in Node. */
(function (root) {
  'use strict';
  var BUDGET = { interactionP95Ms: 100, searchMs: 500, invoiceSaveMs: 1000, lcpMs: 2500 };
  var DEVICE_PROFILE = { device: 'mid-range Android tablet (4 cores, 4 GB)', network: 'Fast 3G (1.6 Mbps down, 150 ms RTT)', note: 'LCP must be measured on this profile; local timings on the reference fixture.' };
  function percentile(xs, p) {
    if (!xs.length) throw new Error('no-samples');
    var s = xs.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)];
  }
  function create(opts) {
    var clock = (opts && opts.clock) || function () { return (typeof performance !== 'undefined' ? performance : Date).now(); };
    var runs = {};
    function rec(name, local, provider) { (runs[name] = runs[name] || []).push({ local: local, provider: provider }); }
    // fn(provider) — wrap external calls as: await provider(() => fetchSomething()); that time is excluded from local.
    function measure(name, fn) {
      var providerMs = 0;
      function provider(call) {
        var t = clock();
        function done() { providerMs += clock() - t; }
        var r;
        try { r = call(); } catch (e) { done(); throw e; }
        if (r && typeof r.then === 'function') return r.then(function (v) { done(); return v; }, function (e) { done(); throw e; });
        done(); return r;
      }
      var start = clock();
      function finish(v) { rec(name, Math.max(0, clock() - start - providerMs), providerMs); return v; }
      var out = fn(provider);
      return out && typeof out.then === 'function' ? out.then(finish) : finish(out);
    }
    function report(lcpMs) {
      function stats(name) {
        var r = runs[name] || []; if (!r.length) return null;
        var l = r.map(function (x) { return x.local; });
        return { n: r.length, p95LocalMs: percentile(l, 95), maxLocalMs: Math.max.apply(null, l), providerMsTotal: r.reduce(function (a, x) { return a + x.provider; }, 0) };
      }
      var interaction = stats('interaction'), search = stats('search'), save = stats('invoiceSave');
      var checks = {
        interaction: interaction ? interaction.p95LocalMs <= BUDGET.interactionP95Ms : null,
        search: search ? search.p95LocalMs <= BUDGET.searchMs : null,
        invoiceSave: save ? save.p95LocalMs <= BUDGET.invoiceSaveMs : null,
        lcp: typeof lcpMs === 'number' ? lcpMs <= BUDGET.lcpMs : null
      };
      var vals = Object.keys(checks).map(function (k) { return checks[k]; });
      return { budget: BUDGET, profile: DEVICE_PROFILE, interaction: interaction, search: search, invoiceSave: save, lcpMs: lcpMs === undefined ? null : lcpMs, checks: checks,
        pass: vals.every(function (v) { return v === true; }), unmeasured: Object.keys(checks).filter(function (k) { return checks[k] === null; }) };
    }
    return { measure: measure, report: report };
  }
  var api = { BUDGET: BUDGET, DEVICE_PROFILE: DEVICE_PROFILE, percentile: percentile, create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaRxPerf = api;
})(typeof window !== 'undefined' ? window : globalThis);
