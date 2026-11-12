/* NOVA Rx — CRM-02 local credit (آجل) ledger (pure logic, no DOM, no network, frontend/local only).
   Append-only movements per customer, amounts in integer piastres internally (API takes/returns pounds):
     opening (opening balance) | charge (credit sale, id = sale id, idempotent) | collection (partial/full, FIFO over open charges, receipt no.)
     | reversal (cancels one earlier movement; nothing is ever deleted or edited).
   Credit limit per customer, due dates, aging buckets, and reconcile() against the local sales ledger (novaSales.list()).
   Works as a <script> (window.NovaCredit) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function cents(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }
  function pounds(c) { return c / 100; }
  var DAY = 86400000;

  /* opts: { now(): ms, defaultTermDays: 30 } */
  function createCreditLedger(storage, key, opts) {
    key = key || 'nova.credit';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var termDays = opts.defaultTermDays == null ? 30 : opts.defaultTermDays;

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { limits: {}, moves: [], receiptSeq: 0 };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('ledger-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.moves) || !s.limits) fail('ledger-corrupt');
      return s;
    }
    function save(s) {
      try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('ledger-write-failed'); }
    }
    function cust(id) { if (typeof id !== 'string' || !id) fail('missing-customer'); return id; }
    function byId(s, id) { for (var i = 0; i < s.moves.length; i++) if (s.moves[i].id === id) return s.moves[i]; return null; }
    function reversed(s, id) { return s.moves.some(function (m) { return m.type === 'reversal' && m.target === id; }); }
    function liveAlloc(s, chargeId) {
      var t = 0;
      s.moves.forEach(function (m) {
        if (m.type !== 'collection' || reversed(s, m.id)) return;
        m.allocations.forEach(function (a) { if (a.chargeId === chargeId) t += a.cents; });
      });
      return t;
    }
    /* open debts of one customer, oldest due first: [{id, due, at, cents (original), open (remaining)}] */
    function openDebts(s, c) {
      return s.moves.filter(function (m) { return m.customerId === c && (m.type === 'charge' || m.type === 'opening') && !reversed(s, m.id); })
        .map(function (m) { return { id: m.id, at: m.at, due: m.due, cents: m.cents, open: m.cents - liveAlloc(s, m.id), ref: m.ref }; })
        .filter(function (d) { return d.open > 0; })
        .sort(function (a, b) { return a.due - b.due || a.at - b.at; });
    }
    function balanceC(s, c) { return openDebts(s, c).reduce(function (t, d) { return t + d.open; }, 0); }
    function nextId(s, p) { return p + '-' + (s.moves.length + 1); }

    function setLimit(customerId, limit) {
      var s = load(); cust(customerId);
      if (limit === null) delete s.limits[customerId];
      else { if (typeof limit !== 'number' || !isFinite(limit) || limit < 0) fail('bad-limit'); s.limits[customerId] = Math.round(limit * 100); }
      save(s);
    }
    function limitOf(customerId) { var l = load().limits[customerId]; return l == null ? null : pounds(l); }

    /* Opening balance carried over from the paper book. One per customer (a second one is a mistake: reverse the first). */
    function openingBalance(customerId, amount, o) {
      o = o || {}; cust(customerId); var c = cents(amount), s = load(), at = o.at == null ? now() : o.at;
      var dup = s.moves.some(function (m) { return m.type === 'opening' && m.customerId === customerId && !reversed(s, m.id); });
      if (dup) fail('opening-exists');
      var m = { id: nextId(s, 'op'), type: 'opening', customerId: customerId, cents: c, at: at, due: o.due == null ? at : o.due, note: o.note || '' };
      s.moves.push(m); save(s); return copy(m);
    }

    /* Credit sale. id = the sale id (idempotent: same id returns the stored charge). Refuses past the limit unless o.override. */
    function charge(o) {
      if (!o || typeof o.id !== 'string' || !o.id) fail('missing-key');
      cust(o.customerId); var c = cents(o.amount), s = load(), ex = byId(s, 'ch-' + o.id);
      if (ex) return copy(ex);
      var lim = s.limits[o.customerId];
      if (lim != null && !o.override && balanceC(s, o.customerId) + c > lim) fail('over-limit');
      var at = o.at == null ? now() : o.at;
      var m = { id: 'ch-' + o.id, type: 'charge', ref: o.id, customerId: o.customerId, cents: c, at: at, due: o.due == null ? at + termDays * DAY : o.due, override: !!o.override };
      s.moves.push(m); save(s); return copy(m);
    }

    /* Collection (partial or full), allocated to the oldest due debts first. Cannot exceed the balance. Returns the receipt. */
    function collect(o) {
      if (!o || typeof o.id !== 'string' || !o.id) fail('missing-key');
      cust(o.customerId); var c = cents(o.amount), s = load(), ex = byId(s, 'co-' + o.id);
      if (ex) return receipt(ex);
      var debts = openDebts(s, o.customerId), bal = debts.reduce(function (t, d) { return t + d.open; }, 0);
      if (c > bal) fail('exceeds-balance');
      var left = c, allocs = [];
      debts.forEach(function (d) { if (left <= 0) return; var a = Math.min(left, d.open); allocs.push({ chargeId: d.id, cents: a }); left -= a; });
      s.receiptSeq += 1;
      var m = { id: 'co-' + o.id, type: 'collection', customerId: o.customerId, cents: c, at: o.at == null ? now() : o.at, allocations: allocs,
        receiptNo: 'RC-' + String(s.receiptSeq).padStart(6, '0'), method: o.method || 'cash' };
      s.moves.push(m); save(s); return receipt(m, bal - c);
    }
    function receipt(m, after) {
      if (after == null) { var s = load(); after = balanceC(s, m.customerId); }
      return { receiptNo: m.receiptNo, customerId: m.customerId, amount: pounds(m.cents), at: m.at, method: m.method, id: m.id,
        allocations: m.allocations.map(function (a) { return { chargeId: a.chargeId, amount: pounds(a.cents) }; }), balanceAfter: pounds(after) };
    }

    /* Reversal of one earlier movement. A charge/opening with live collections against it must have those reversed first. Idempotent. */
    function reverse(moveId, reason) {
      var s = load(), m = byId(s, moveId);
      if (!m) fail('unknown-movement');
      if (m.type === 'reversal') fail('cannot-reverse-reversal');
      if (reversed(s, moveId)) return copy(s.moves.filter(function (r) { return r.type === 'reversal' && r.target === moveId; })[0]);
      if (!reason || typeof reason !== 'string') fail('reason-required');
      if ((m.type === 'charge' || m.type === 'opening') && liveAlloc(s, moveId) > 0) fail('has-collections');
      var r = { id: nextId(s, 'rv'), type: 'reversal', target: moveId, customerId: m.customerId, cents: m.cents, at: now(), reason: reason };
      s.moves.push(r); save(s); return copy(r);
    }

    function balance(customerId) { return pounds(balanceC(load(), cust(customerId))); }

    /* Aging at asOf: current (not yet due) | d1_30 | d31_60 | d61_90 | d90_plus (days past due). */
    function aging(customerId, asOf) {
      var s = load(), t = asOf == null ? now() : asOf, b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
      openDebts(s, cust(customerId)).forEach(function (d) {
        var days = Math.floor((t - d.due) / DAY);
        var k = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
        b[k] += d.open;
      });
      var out = { total: 0 };
      Object.keys(b).forEach(function (k) { out[k] = pounds(b[k]); out.total += b[k]; });
      out.total = pounds(out.total); return out;
    }

    function statement(customerId) {
      var s = load(); cust(customerId);
      return s.moves.filter(function (m) { return m.customerId === customerId; }).map(function (m) {
        var o = copy(m); o.amount = pounds(m.cents); delete o.cents; o.reversed = m.type !== 'reversal' && reversed(s, m.id); return o;
      });
    }
    function customers() {
      var s = load(), seen = {};
      s.moves.forEach(function (m) { seen[m.customerId] = 1; });
      return Object.keys(seen).map(function (c) { return { customerId: c, balance: pounds(balanceC(s, c)) }; });
    }
    function totalOutstanding() { return customers().reduce(function (t, c) { return Math.round((t + c.balance) * 100) / 100; }, 0); }

    /* Reconcile with the local sales ledger. sales: novaSales.list() rows { id, customerId, credit, ... }.
       Every credit sale must have exactly one live charge of the same amount; every live charge must have a sale; and the
       sum of customer balances must equal charges + openings - collections. Never changes anything. */
    function reconcile(sales) {
      var s = load(), diffs = [], bySale = {};
      (sales || []).forEach(function (x) {
        var cr = Math.round((Number(x && x.credit) || 0) * 100);
        if (x && x.id && cr > 0) bySale[x.id] = { cents: cr, customerId: x.customerId };
      });
      Object.keys(bySale).forEach(function (id) {
        var m = byId(s, 'ch-' + id);
        if (!m || reversed(s, m.id)) diffs.push({ type: 'missing-charge', saleId: id, expected: pounds(bySale[id].cents) });
        else if (m.cents !== bySale[id].cents) diffs.push({ type: 'amount-mismatch', saleId: id, expected: pounds(bySale[id].cents), ledger: pounds(m.cents) });
        else if (bySale[id].customerId && m.customerId !== bySale[id].customerId) diffs.push({ type: 'customer-mismatch', saleId: id });
      });
      s.moves.forEach(function (m) {
        if (m.type === 'charge' && !reversed(s, m.id) && !bySale[m.ref]) diffs.push({ type: 'orphan-charge', saleId: m.ref, ledger: pounds(m.cents) });
      });
      var live = function (t) { return s.moves.filter(function (m) { return m.type === t && !reversed(s, m.id); }).reduce(function (n, m) { return n + m.cents; }, 0); };
      var expected = live('charge') + live('opening') - live('collection');
      var actual = customers().reduce(function (n, c) { return n + Math.round(c.balance * 100); }, 0);
      if (expected !== actual) diffs.push({ type: 'balance-mismatch', expected: pounds(expected), ledger: pounds(actual) });
      return { ok: diffs.length === 0, diffs: diffs };
    }

    return { setLimit: setLimit, limitOf: limitOf, openingBalance: openingBalance, charge: charge, collect: collect, reverse: reverse,
      balance: balance, aging: aging, statement: statement, customers: customers, totalOutstanding: totalOutstanding, reconcile: reconcile };
  }

  var api = { createCreditLedger: createCreditLedger };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaCredit = api;
})(typeof window !== 'undefined' ? window : this);
