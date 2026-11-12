/* NOVA Rx — FIN-02 local double-entry journal (pure logic, no DOM, no network, frontend/local only).
   Every business event posts ONE balanced entry (sum of debits = sum of credits, integer piastres internally; API takes pounds).
   Entries are append-only: nothing is edited or deleted, a mistake is cancelled by reverse() which posts the mirror entry.
   Idempotent: the entry id is `<type>:<event id>`; posting the same event again returns the stored entry, never a second one.
   Costing rule (see docs/finance/FIN-02.md): moving weighted average per product. The caller supplies cogs (qty x average cost) on
   sales/returns; weightedAverage() computes the new average on receipt. Changing a stored cost (revalue) needs a reason AND an approver.
   Works as a <script> (window.NovaJournal) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  var ACCOUNTS = {
    cash: 'Cash', bank: 'Bank / card', ar: 'Accounts receivable (credit customers)', inventory: 'Inventory',
    ap: 'Accounts payable (suppliers)', sales: 'Sales revenue', salesReturns: 'Sales returns', cogs: 'Cost of goods sold',
    expense: 'Operating expenses', revaluation: 'Inventory revaluation'
  };

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  /* pounds -> piastres; 0 allowed only when zeroOk. Rejects NaN, negatives and sub-piastre values. */
  function cents(n, zeroOk) {
    if (n == null && zeroOk) return 0;
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || (n === 0 && !zeroOk)) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }
  function pounds(c) { return c / 100; }

  /* Moving weighted average cost after a receipt. Quantities are numbers, values in pounds. */
  function weightedAverage(qtyOnHand, avgCost, qtyIn, costIn) {
    var q = qtyOnHand + qtyIn;
    if (!(qtyIn > 0) || !(q > 0) || qtyOnHand < 0 || avgCost < 0 || costIn < 0) fail('bad-cost-input');
    return Math.round(((qtyOnHand * avgCost + qtyIn * costIn) / q) * 10000) / 10000;
  }

  function createJournal(storage, key, opts) {
    key = key || 'nova.journal';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { entries: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('journal-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.entries)) fail('journal-corrupt');
      return s;
    }
    function save(s) {
      try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('journal-write-failed'); }
    }
    function find(s, id) { for (var i = 0; i < s.entries.length; i++) if (s.entries[i].id === id) return s.entries[i]; return null; }
    function reversalOf(s, id) { for (var i = 0; i < s.entries.length; i++) if (s.entries[i].reverses === id) return s.entries[i]; return null; }
    function view(e) {
      var o = copy(e);
      o.lines = e.lines.map(function (l) { return { account: l.account, debit: pounds(l.debit), credit: pounds(l.credit) }; });
      return o;
    }

    /* lines: [{account, debit, credit}] in piastres; zero lines are dropped; must balance and be non-empty. */
    function commit(s, id, type, ref, lines, extra) {
      lines = lines.filter(function (l) { return l.debit || l.credit; });
      var d = 0, c = 0;
      lines.forEach(function (l) { if (!ACCOUNTS[l.account]) fail('unknown-account'); d += l.debit; c += l.credit; });
      if (!lines.length || d !== c) fail('unbalanced');
      var e = { id: id, type: type, ref: ref, at: extra && extra.at != null ? extra.at : now(), lines: lines };
      if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'at') e[k] = extra[k]; });
      s.entries.push(e); save(s); return view(e);
    }
    function dr(account, c) { return { account: account, debit: c, credit: 0 }; }
    function cr(account, c) { return { account: account, debit: 0, credit: c }; }
    function eventId(o) { if (!o || typeof o.id !== 'string' || !o.id) fail('missing-key'); return o.id; }
    /* idempotent entry point: returns the stored entry when this event was already posted */
    function once(type, o, build) {
      var ref = eventId(o), id = type + ':' + ref, s = load(), ex = find(s, id);
      if (ex) return view(ex);
      return commit(s, id, type, ref, build(), { at: o.at });
    }

    /* Sale: total = cash + card + credit. cogs (optional) = cost of the goods sold at the current average cost. */
    function sale(o) {
      return once('sale', o, function () {
        var cash = cents(o.cash, true), card = cents(o.card, true), cre = cents(o.credit, true), tot = cents(o.total), cogs = cents(o.cogs, true);
        if (cash + card + cre !== tot) fail('tender-mismatch');
        return [dr('cash', cash), dr('bank', card), dr('ar', cre), cr('sales', tot), dr('cogs', cogs), cr('inventory', cogs)];
      });
    }
    /* Purchase received: total = paid (cash) + owed to the supplier. */
    function purchase(o) {
      return once('purchase', o, function () {
        var tot = cents(o.total), paid = cents(o.paid, true);
        if (paid > tot) fail('tender-mismatch');
        return [dr('inventory', tot), cr('cash', paid), cr('ap', tot - paid)];
      });
    }
    /* Customer return of a sale: refund = cash back + credit note against the customer's balance; cogs goods back into stock. */
    function saleReturn(o) {
      return once('return', o, function () {
        var tot = cents(o.total), cash = cents(o.cash, true), cre = cents(o.credit, true), cogs = cents(o.cogs, true);
        if (cash + cre !== tot) fail('tender-mismatch');
        return [dr('salesReturns', tot), cr('cash', cash), cr('ar', cre), dr('inventory', cogs), cr('cogs', cogs)];
      });
    }
    /* Collection of a credit balance from a customer. */
    function collection(o) {
      return once('collection', o, function () {
        var amt = cents(o.amount);
        return [dr(o.method === 'card' ? 'bank' : 'cash', amt), cr('ar', amt)];
      });
    }
    /* Operating expense paid in cash or left owing (paid < amount). */
    function expense(o) {
      return once('expense', o, function () {
        var amt = cents(o.amount), paid = o.paid == null ? amt : cents(o.paid, true);
        if (paid > amt) fail('tender-mismatch');
        return [dr('expense', amt), cr('cash', paid), cr('ap', amt - paid)];
      });
    }

    /* Mirror entry that cancels one earlier entry. Idempotent; a reversal cannot itself be reversed (post the event again instead). */
    function reverse(entryId, reason) {
      var s = load(), e = find(s, entryId);
      if (!e) fail('unknown-entry');
      if (e.reverses) fail('cannot-reverse-reversal');
      var ex = reversalOf(s, entryId);
      if (ex) return view(ex);
      if (!reason || typeof reason !== 'string') fail('reason-required');
      var lines = e.lines.map(function (l) { return { account: l.account, debit: l.credit, credit: l.debit }; });
      return commit(s, 'reversal:' + entryId, 'reversal', e.ref, lines, { reverses: entryId, reason: reason });
    }

    /* Gated revaluation: stock value is changed only with a reason and a named approver, as its own visible entry.
       delta > 0 raises inventory value, delta < 0 lowers it. Past entries are never rewritten. */
    function revalue(o) {
      eventId(o);
      if (!o.reason || typeof o.reason !== 'string') fail('reason-required');
      if (!o.approvedBy || typeof o.approvedBy !== 'string') fail('revaluation-not-approved');
      if (typeof o.delta !== 'number' || !isFinite(o.delta) || o.delta === 0) fail('bad-amount');
      var c = cents(Math.abs(o.delta)), up = o.delta > 0;
      var id = 'revaluation:' + o.id, s = load(), ex = find(s, id);
      if (ex) return view(ex);
      return commit(s, id, 'revaluation', o.id, up ? [dr('inventory', c), cr('revaluation', c)] : [dr('revaluation', c), cr('inventory', c)],
        { at: o.at, reason: o.reason, approvedBy: o.approvedBy });
    }

    function list() { return load().entries.map(view); }
    function get(id) { var e = find(load(), id); return e ? view(e) : null; }
    function balances(s) {
      var b = {};
      Object.keys(ACCOUNTS).forEach(function (a) { b[a] = { debit: 0, credit: 0 }; });
      s.entries.forEach(function (e) { e.lines.forEach(function (l) { b[l.account].debit += l.debit; b[l.account].credit += l.credit; }); });
      return b;
    }
    /* Balance of one account, debit-positive (assets, expenses) — credit-natured accounts come out negative. */
    function balance(account) {
      if (!ACCOUNTS[account]) fail('unknown-account');
      var b = balances(load())[account]; return pounds(b.debit - b.credit);
    }
    function trialBalance() {
      var b = balances(load()), rows = [], d = 0, c = 0;
      Object.keys(b).forEach(function (a) { rows.push({ account: a, debit: pounds(b[a].debit), credit: pounds(b[a].credit) }); d += b[a].debit; c += b[a].credit; });
      return { rows: rows, debit: pounds(d), credit: pounds(c), balanced: d === c };
    }
    /* Read-only integrity check: every entry balances, every reversal mirrors its target, ids are unique. */
    function verify() {
      var s = load(), problems = [], seen = {};
      s.entries.forEach(function (e) {
        if (seen[e.id]) problems.push({ type: 'duplicate-id', id: e.id }); seen[e.id] = 1;
        var d = 0, c = 0; e.lines.forEach(function (l) { d += l.debit; c += l.credit; });
        if (d !== c) problems.push({ type: 'unbalanced', id: e.id });
        if (e.reverses) {
          var t = find(s, e.reverses);
          if (!t) problems.push({ type: 'orphan-reversal', id: e.id });
          else if (JSON.stringify(t.lines.map(function (l) { return [l.account, l.credit, l.debit]; })) !== JSON.stringify(e.lines.map(function (l) { return [l.account, l.debit, l.credit]; })))
            problems.push({ type: 'reversal-mismatch', id: e.id });
        }
      });
      return { ok: problems.length === 0, problems: problems };
    }

    return { sale: sale, purchase: purchase, saleReturn: saleReturn, collection: collection, expense: expense, reverse: reverse,
      revalue: revalue, list: list, get: get, balance: balance, trialBalance: trialBalance, verify: verify };
  }

  var api = { createJournal: createJournal, weightedAverage: weightedAverage, ACCOUNTS: ACCOUNTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaJournal = api;
})(typeof window !== 'undefined' ? window : this);
