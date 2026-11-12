/* NOVA Rx — INV-01 on-device stock movement ledger (pure logic, no DOM, no network).
   Append-only: there is no update or delete. onHand is DERIVED from the movements, never stored.
   Works as a <script> (window.NovaStockLedger) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  var KINDS = { sale: -1, return: 1, receive: 1, adjustment: 0 };   // sign of qty; adjustment carries its own sign
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function createLedger(storage, key, now) {
    key = key || 'nova.stock.ledger';
    now = now || function () { return new Date().toISOString(); };
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { fail('ledger-corrupt'); }
    }
    return {
      /* qty: positive integer for sale/return/receive; non-zero signed integer for adjustment.
         ref is required (invoice no., PO no., reason). Same kind+ref+code twice is rejected (idempotent replay). */
      append: function (m) {
        if (!m || !Object.prototype.hasOwnProperty.call(KINDS, m.kind)) fail('bad-kind');
        if (typeof m.code !== 'string' || !m.code) fail('bad-code');
        if (typeof m.ref !== 'string' || !m.ref) fail('missing-ref');
        if (!isInt(m.qty) || m.qty === 0) fail('bad-qty');
        if (m.kind !== 'adjustment' && m.qty < 0) fail('bad-qty');
        var lot = m.lot == null ? null : String(m.lot);
        if (m.kind === 'receive' && m.lot != null) {   // N29: receiving may carry lot / expiry / unit cost
          if (!lot) fail('bad-lot');
          if (typeof m.expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.expiry) || isNaN(Date.parse(m.expiry))) fail('bad-expiry');
          if (typeof m.cost !== 'number' || !isFinite(m.cost) || m.cost < 0) fail('bad-cost');
        } else if (m.lot != null || m.expiry != null || m.cost != null) fail('lot-only-on-receive');
        var a = load();
        for (var i = 0; i < a.length; i++) if (a[i].kind === m.kind && a[i].ref === m.ref && a[i].code === m.code && (a[i].lot || null) === lot) fail('duplicate-movement');
        var delta = m.kind === 'adjustment' ? m.qty : KINDS[m.kind] * m.qty;
        var rec = { seq: a.length + 1, at: now(), kind: m.kind, code: m.code, qty: m.qty, delta: delta, ref: m.ref };
        if (lot) { rec.lot = lot; rec.expiry = m.expiry; rec.cost = m.cost; }
        a.push(rec);
        storage.setItem(key, JSON.stringify(a));
        return copy(rec);
      },
      movements: function (code) { return load().filter(function (r) { return !code || r.code === code; }); },
      /* receipts that carry a lot: [{code, lot, expiry, cost, qty, ref, seq}] (received quantity, not remaining) */
      lots: function (code) { return load().filter(function (r) { return r.lot && (!code || r.code === code); }); },
      onHand: function (code) { return load().reduce(function (s, r) { return r.code === code ? s + r.delta : s; }, 0); },
      balances: function () {
        var out = {};
        load().forEach(function (r) { out[r.code] = (out[r.code] || 0) + r.delta; });
        return out;
      }
    };
  }

  /* Daily ledger-vs-balance check. balances: { code: qty } as shown by any other store/screen.
     Returns { ok, day, mismatches: [{code, ledger, balance}] }; a code missing on one side counts as 0 there. */
  function checkDaily(ledger, balances, day) {
    var l = ledger.balances(), codes = {}, bad = [];
    Object.keys(l).forEach(function (c) { codes[c] = 1; });
    Object.keys(balances || {}).forEach(function (c) { codes[c] = 1; });
    Object.keys(codes).sort().forEach(function (c) {
      var lv = l[c] || 0, bv = (balances || {})[c] || 0;
      if (lv !== bv) bad.push({ code: c, ledger: lv, balance: bv });
    });
    return { ok: bad.length === 0, day: day || null, mismatches: bad };
  }

  var api = { KINDS: Object.keys(KINDS), createLedger: createLedger, checkDaily: checkDaily };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaStockLedger = api;
})(typeof window !== 'undefined' ? window : globalThis);
