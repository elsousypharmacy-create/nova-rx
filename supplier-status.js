/* NOVA Rx — UX201 supplier connection status model (pure, no DOM, no network).
   States: connected | auth_failed | missing_credential | down | unknown.
   Works as <script> (window.NovaSupplierStatus) and in Node (module.exports). */
(function (root) {
  'use strict';
  var STATES = ['connected', 'auth_failed', 'missing_credential', 'down', 'unknown'];
  var LABELS = { connected: 'متصل', auth_failed: 'فشل الدخول', missing_credential: 'بيانات الدخول ناقصة', down: 'المورد لا يستجيب', unknown: 'غير معروف' };
  var STALE_MS = 90 * 60 * 1000; // 3 missed 30-minute runs

  /* Map a worker /api/suppliers/status entry (+ optional search probe entry) to a state. */
  function classify(entry, probe) {
    if (!entry) return 'unknown';
    if (entry.state === 'off') return 'missing_credential';
    if (entry.state === 'expired') return 'auth_failed';
    if (entry.state !== 'ok') return 'unknown';
    if (probe) {
      if (probe.state === 'error') return /auth|login|401|403|session|جلسة/i.test(String(probe.message || '')) ? 'auth_failed' : 'down';
      if (probe.state === 'off') return 'missing_credential';
    }
    return 'connected';
  }
  function fromHttp(status) { // health call itself failed
    if (status === 401 || status === 403) return 'auth_failed';
    return 'down';
  }
  function summarize(list) {
    var c = { total: 0 }; STATES.forEach(function (s) { c[s] = 0; });
    (list || []).forEach(function (x) { c.total++; c[STATES.indexOf(x.state) < 0 ? 'unknown' : x.state]++; });
    return c;
  }
  function isStale(checkedAt, now) {
    var t = Date.parse(checkedAt || '');
    return !isFinite(t) || (now == null ? Date.now() : now) - t > STALE_MS;
  }
  function label(state) { return LABELS[state] || LABELS.unknown; }
  function build(items, checkedAt) {
    return { checkedAt: checkedAt, suppliers: items.map(function (i) { return { id: i.id, name: i.name, state: STATES.indexOf(i.state) < 0 ? 'unknown' : i.state, detail: i.detail || null }; }) };
  }
  var api = { STATES: STATES, STALE_MS: STALE_MS, classify: classify, fromHttp: fromHttp, summarize: summarize, isStale: isStale, label: label, build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaSupplierStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
