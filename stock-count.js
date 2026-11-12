/* NOVA Rx — INV-04 on-device stock count session (pure logic, no DOM, no network).
   Blind count: while open, view() shows codes and what was counted, never the expected quantity.
   differences() reveals counted vs expected. close() needs a reason for every difference, writes one
   adjustment per difference to the stock ledger, then locks the session (no further count/close).
   Works as a <script> (window.NovaStockCount) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function createCounts(storage, ledger, key, now) {
    key = key || 'nova.stock.counts';
    now = now || function () { return new Date().toISOString(); };
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { fail('counts-corrupt'); }
    }
    function save(a) { storage.setItem(key, JSON.stringify(a)); }
    function find(a, id) {
      for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
      fail('no-session');
    }
    function open(a, id) { var s = find(a, id); if (s.closedAt) fail('session-locked'); return s; }
    function diffs(s) {
      return s.codes.filter(function (c) { return s.counted[c] !== undefined && s.counted[c] !== s.expected[c]; })
        .map(function (c) { return { code: c, expected: s.expected[c], counted: s.counted[c], diff: s.counted[c] - s.expected[c] }; });
    }
    return {
      /* scope 'full' counts every code the ledger knows; 'partial' needs a non-empty codes list.
         The expected quantity is a snapshot of the ledger at start. */
      start: function (o) {
        o = o || {};
        var bal = ledger.balances(), codes;
        if (o.scope === 'full') codes = Object.keys(bal).sort();
        else if (o.scope === 'partial') {
          if (!Array.isArray(o.codes) || !o.codes.length) fail('no-codes');
          codes = o.codes.filter(function (c, i, l) { return l.indexOf(c) === i; });
          if (codes.some(function (c) { return typeof c !== 'string' || !c; })) fail('bad-code');
        } else fail('bad-scope');
        if (!codes.length) fail('no-codes');
        var a = load();
        if (a.some(function (s) { return !s.closedAt; })) fail('session-already-open');
        var s = { id: 'C' + (a.length + 1), scope: o.scope, startedAt: now(), closedAt: null, codes: codes, expected: {}, counted: {}, reasons: {} };
        codes.forEach(function (c) { s.expected[c] = ledger.onHand(c); });
        a.push(s); save(a);
        return s.id;
      },
      count: function (id, code, qty) {
        var a = load(), s = open(a, id);
        if (s.codes.indexOf(code) < 0) fail('not-in-scope');
        if (!isInt(qty) || qty < 0) fail('bad-qty');
        s.counted[code] = qty; save(a);
      },
      /* blind: no expected quantities and no differences */
      view: function (id) {
        var s = find(load(), id);
        if (!s.closedAt) return { id: s.id, scope: s.scope, closed: false, lines: s.codes.map(function (c) { return { code: c, counted: s.counted[c] === undefined ? null : s.counted[c] }; }) };
        return this.report(id);
      },
      differences: function (id) { return diffs(find(load(), id)); },
      /* reasons: { code: 'text' }. Every difference needs one; every code must be counted. All-or-nothing. */
      close: function (id, reasons) {
        var a = load(), s = open(a, id);
        reasons = reasons || {};
        if (s.codes.some(function (c) { return s.counted[c] === undefined; })) fail('uncounted');
        var d = diffs(s);
        d.forEach(function (x) { if (typeof reasons[x.code] !== 'string' || !reasons[x.code].trim()) fail('missing-reason'); });
        d.forEach(function (x) {
          s.reasons[x.code] = reasons[x.code].trim();
          // move the ledger to the counted figure (relative to now, so sales during the count are kept)
          var delta = x.counted - ledger.onHand(x.code);
          if (delta !== 0) ledger.append({ kind: 'adjustment', code: x.code, qty: delta, ref: s.id + ': ' + s.reasons[x.code] });
        });
        s.closedAt = now(); save(a);
        return this.report(id);
      },
      report: function (id) {
        var s = find(load(), id);
        return copy({ id: s.id, scope: s.scope, closed: !!s.closedAt, closedAt: s.closedAt,
          lines: s.codes.map(function (c) { return { code: c, expected: s.expected[c], counted: s.counted[c] === undefined ? null : s.counted[c], reason: s.reasons[c] || null }; }) });
      }
    };
  }

  var api = { createCounts: createCounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaStockCount = api;
})(typeof window !== 'undefined' ? window : globalThis);
