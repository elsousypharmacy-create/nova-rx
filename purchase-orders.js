/* NOVA Rx — N29 / BUY-05 local purchase order + receiving (GRN) with lot/expiry/cost.
   On-device only: no network, no supplier contact. Stock changes ONLY through the append-only ledger (stock-ledger.js, receive movements).
   A PO never changes state without an explicit human confirmation ({confirmed:true}). Works as <script> (window.NovaPurchaseOrders) and in Node. */
(function (root) {
  'use strict';
  var STATES = ['draft', 'sent', 'accepted', 'partial', 'received', 'cancelled'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }
  function money(n) { return Math.round(n * 100) / 100; }

  function createStore(storage, ledger, key, now) {
    key = key || 'nova.purchase.orders';
    now = now || function () { return new Date().toISOString(); };
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { fail('po-store-corrupt'); }
    }
    function save(a) { storage.setItem(key, JSON.stringify(a)); }
    function find(a, id) { for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; fail('po-not-found'); }
    function confirmed(c) { if (!c || c.confirmed !== true) fail('confirmation-required'); }
    function remaining(po, code) {
      for (var i = 0; i < po.lines.length; i++) if (po.lines[i].code === code) return po.lines[i].qty - po.lines[i].received;
      return null;
    }

    function transition(id, c, from, to, stamp) {
      confirmed(c);
      var a = load(), po = find(a, id);
      if (from.indexOf(po.state) < 0) fail('bad-transition');
      po.state = to; po.history.push({ at: now(), state: to, by: c.by || null }); if (stamp) po[stamp] = now();
      save(a); return copy(po);
    }

    return {
      /* draft: { supplier, lines:[{code, name?, qty, cost}] }  -> state 'draft' (nothing sent anywhere) */
      create: function (d) {
        if (!d || typeof d.supplier !== 'string' || !d.supplier) fail('bad-supplier');
        if (!Array.isArray(d.lines) || !d.lines.length) fail('no-lines');
        var seen = {}, lines = d.lines.map(function (l) {
          if (!l || typeof l.code !== 'string' || !l.code) fail('bad-code');
          if (seen[l.code]) fail('duplicate-line'); seen[l.code] = 1;
          if (!isInt(l.qty) || l.qty <= 0) fail('bad-qty');
          if (typeof l.cost !== 'number' || !isFinite(l.cost) || l.cost < 0) fail('bad-cost');
          return { code: l.code, name: l.name || '', qty: l.qty, cost: l.cost, received: 0 };
        });
        var a = load(), po = { id: 'PO-' + (a.length + 1), supplier: d.supplier, state: 'draft', createdAt: now(), lines: lines, grns: [], history: [{ at: now(), state: 'draft', by: null }] };
        a.push(po); save(a); return copy(po);
      },
      send: function (id, c) { return transition(id, c, ['draft'], 'sent', 'sentAt'); },
      accept: function (id, c) { return transition(id, c, ['sent'], 'accepted', 'acceptedAt'); },
      cancel: function (id, c) {
        confirmed(c);
        var a = load(), po = find(a, id);
        if (po.state === 'received' || po.state === 'cancelled') fail('bad-transition');
        if (po.grns.length) fail('has-receipts');   // received stock is in the ledger; reverse it by an adjustment, not by cancelling
        po.state = 'cancelled'; po.history.push({ at: now(), state: 'cancelled', by: c.by || null }); save(a); return copy(po);
      },
      /* GRN: { ref, invoice?: {qty:{code:n}}, lines:[{code, lot, expiry:'YYYY-MM-DD', qty, cost}] }
         Whole GRN is validated first; nothing is written on rejection. Returns { po, warnings }.
         Warnings (never block): over-receipt, unordered code, cost differs from PO, expiry already past / under 90 days, invoice qty differs from GRN qty or PO qty. */
      receive: function (id, grn, c) {
        confirmed(c);
        if (!grn || typeof grn.ref !== 'string' || !grn.ref) fail('missing-ref');
        if (!Array.isArray(grn.lines) || !grn.lines.length) fail('no-lines');
        var a = load(), po = find(a, id);
        if (po.state !== 'accepted' && po.state !== 'partial' && po.state !== 'sent') fail('bad-transition');
        for (var g = 0; g < po.grns.length; g++) if (po.grns[g].ref === grn.ref) fail('duplicate-grn');
        var keys = {};
        grn.lines.forEach(function (l) {
          if (!l || typeof l.code !== 'string' || !l.code) fail('bad-code');
          if (!l.lot || typeof l.lot !== 'string') fail('bad-lot');
          if (!validDate(l.expiry)) fail('bad-expiry');
          if (!isInt(l.qty) || l.qty <= 0) fail('bad-qty');
          if (typeof l.cost !== 'number' || !isFinite(l.cost) || l.cost < 0) fail('bad-cost');
          if (keys[l.code + '\u0000' + l.lot]) fail('duplicate-lot-line'); keys[l.code + '\u0000' + l.lot] = 1;
        });
        var warnings = [], today = now().slice(0, 10), soon = new Date(Date.parse(today) + 90 * 864e5).toISOString().slice(0, 10), got = {};
        grn.lines.forEach(function (l) {
          got[l.code] = (got[l.code] || 0) + l.qty;
          if (l.expiry <= today) warnings.push({ type: 'expired', code: l.code, lot: l.lot, expiry: l.expiry });
          else if (l.expiry < soon) warnings.push({ type: 'short-expiry', code: l.code, lot: l.lot, expiry: l.expiry });
        });
        Object.keys(got).forEach(function (code) {
          var rem = remaining(po, code);
          if (rem === null) warnings.push({ type: 'unordered', code: code, received: got[code] });
          else if (got[code] > rem) warnings.push({ type: 'over-receipt', code: code, ordered: rem + 0, received: got[code] });
        });
        grn.lines.forEach(function (l) {
          for (var i = 0; i < po.lines.length; i++) if (po.lines[i].code === l.code && money(po.lines[i].cost) !== money(l.cost)) warnings.push({ type: 'cost-differs', code: l.code, lot: l.lot, po: po.lines[i].cost, grn: l.cost });
        });
        if (grn.invoice && grn.invoice.qty) Object.keys(grn.invoice.qty).forEach(function (code) {
          var inv = grn.invoice.qty[code], rem = remaining(po, code);
          if (inv !== (got[code] || 0)) warnings.push({ type: 'invoice-vs-grn', code: code, invoice: inv, grn: got[code] || 0 });
          else if (rem !== null && inv !== rem && inv > rem) warnings.push({ type: 'invoice-vs-po', code: code, invoice: inv, po: rem });
        });
        // all valid: write through the ledger (a ledger error aborts before PO state is saved; replays are rejected there)
        grn.lines.forEach(function (l) { ledger.append({ kind: 'receive', code: l.code, qty: l.qty, ref: po.id + '/' + grn.ref, lot: l.lot, expiry: l.expiry, cost: l.cost }); });
        grn.lines.forEach(function (l) { for (var i = 0; i < po.lines.length; i++) if (po.lines[i].code === l.code) po.lines[i].received += l.qty; });
        po.grns.push({ ref: grn.ref, at: now(), by: c.by || null, lines: copy(grn.lines), warnings: warnings });
        var done = po.lines.every(function (l) { return l.received >= l.qty; });
        po.state = done ? 'received' : 'partial'; po.history.push({ at: now(), state: po.state, by: c.by || null });
        save(a); return { po: copy(po), warnings: warnings };
      },
      get: function (id) { return copy(find(load(), id)); },
      list: function () { return copy(load()); }
    };
  }

  var api = { STATES: STATES, createStore: createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaPurchaseOrders = api;
})(typeof window !== 'undefined' ? window : globalThis);
