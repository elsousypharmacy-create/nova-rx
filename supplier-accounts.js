/* NOVA Rx — FIN-04 local supplier accounts + expenses (pure logic, no DOM, no network, frontend/local only).
   Supplier account: terms (days), early-payment discount {pct, days}, invoices (payable) and payments (each may take the discount).
   Expense: needs document ref + category + approval (draft -> approved/rejected; pay only when approved; creator != approver).
   Mock bank register: local entries only (no live bank/supplier API). reconcile() matches payments/expenses against bank entries
   and supplier invoices against local purchasing records. Integer piastres internally; API in pounds.
   Works as a <script> (window.NovaSupplierAccounts) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function cents(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }
  function pounds(c) { return c / 100; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  var DAY = 86400000;

  function createSupplierAccounts(storage, key, opts) {
    key = key || 'nova.supplierAccounts';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var categories = opts.categories || ['rent', 'utilities', 'salaries', 'transport', 'maintenance', 'other'];

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { suppliers: {}, moves: [], expenses: [], bank: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('store-corrupt'); }
      if (!s || typeof s !== 'object' || !s.suppliers || !Array.isArray(s.moves) || !Array.isArray(s.expenses) || !Array.isArray(s.bank)) fail('store-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('store-write-failed'); } }
    function sup(s, id) { var x = s.suppliers[str(id, 'missing-supplier')]; if (!x) fail('unknown-supplier'); return x; }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function reversed(s, id) { return s.moves.some(function (m) { return m.type === 'reversal' && m.target === id; }); }
    function paidOn(s, invId) {
      var t = 0;
      s.moves.forEach(function (m) { if (m.type === 'payment' && !reversed(s, m.id)) m.allocations.forEach(function (a) { if (a.invoiceId === invId) t += a.cents + a.discount; }); });
      return t;
    }

    function setSupplier(id, def) {
      var s = load(); id = str(id, 'missing-supplier'); def = def || {};
      var td = def.termDays == null ? 30 : def.termDays;
      if (!(td >= 0) || Math.floor(td) !== td) fail('bad-terms');
      var d = def.discount || null;
      if (d && !(d.pct > 0 && d.pct < 100 && d.days >= 0)) fail('bad-discount');
      s.suppliers[id] = { id: id, name: def.name || id, termDays: td, discount: d ? { pct: d.pct, days: d.days } : null };
      save(s); return JSON.parse(JSON.stringify(s.suppliers[id]));
    }

    /* payable invoice; id = purchase/invoice id, idempotent. */
    function addInvoice(inv) {
      var s = load(); sup(s, inv && inv.supplierId);
      var id = str(inv.id, 'missing-key'), c = cents(inv.amount);
      if (find(s.moves, id)) return find(s.moves, id).id;
      var sp = s.suppliers[inv.supplierId], at = inv.at || now();
      s.moves.push({ id: id, type: 'invoice', supplierId: sp.id, cents: c, at: at, due: at + sp.termDays * DAY, ref: inv.ref || id });
      save(s); return id;
    }
    function openInvoices(s, sid) {
      return s.moves.filter(function (m) { return m.type === 'invoice' && m.supplierId === sid && !reversed(s, m.id); })
        .map(function (m) { return { id: m.id, at: m.at, due: m.due, cents: m.cents, open: m.cents - paidOn(s, m.id) }; })
        .filter(function (d) { return d.open > 0; }).sort(function (a, b) { return a.due - b.due || a.at - b.at; });
    }
    /* Pays invoices oldest-due first. discount applies on an invoice paid within discount.days of its date. */
    function pay(p) {
      var s = load(), sp = sup(s, p && p.supplierId), id = str(p.id, 'missing-key');
      if (find(s.moves, id)) return find(s.moves, id).id;
      var c = cents(p.amount), at = p.at || now(), left = c, allocs = [];
      openInvoices(s, sp.id).forEach(function (d) {
        if (left <= 0) return;
        var disc = 0;
        if (sp.discount && at - d.at <= sp.discount.days * DAY) {
          var full = Math.round(d.open * (1 - sp.discount.pct / 100));  /* cash needed to settle the rest early */
          if (left >= full) { disc = d.open - full; allocs.push({ invoiceId: d.id, cents: full, discount: disc }); left -= full; return; }
        }
        var take = Math.min(left, d.open); allocs.push({ invoiceId: d.id, cents: take, discount: 0 }); left -= take;
      });
      if (left > 0) fail('overpayment');
      s.moves.push({ id: id, type: 'payment', supplierId: sp.id, cents: c, at: at, allocations: allocs, ref: p.ref || id });
      save(s); return id;
    }
    function reverse(id, reason) {
      var s = load(), m = find(s.moves, str(id, 'missing-key'));
      if (!m || m.type === 'reversal') fail('unknown-move');
      if (reversed(s, id)) fail('already-reversed');
      if (m.type === 'invoice' && paidOn(s, id) > 0) fail('invoice-has-payments');
      s.moves.push({ id: 'rev-' + (s.moves.length + 1), type: 'reversal', target: id, supplierId: m.supplierId, at: now(), reason: reason || '' });
      save(s);
    }
    function balance(sid) { var s = load(); sup(s, sid); return pounds(openInvoices(s, sid).reduce(function (t, d) { return t + d.open; }, 0)); }
    function aging(sid) {
      var s = load(), b = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 }, t = now(); sup(s, sid);
      openInvoices(s, sid).forEach(function (d) {
        var late = Math.floor((t - d.due) / DAY);
        var k = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : 'd61_plus';
        b[k] += d.open;
      });
      Object.keys(b).forEach(function (k) { b[k] = pounds(b[k]); }); return b;
    }
    /* Discount still available if paid now: [{invoiceId, saves}] */
    function discountsAvailable(sid) {
      var s = load(), sp = sup(s, sid), t = now();
      if (!sp.discount) return [];
      return openInvoices(s, sid).filter(function (d) { return t - d.at <= sp.discount.days * DAY; })
        .map(function (d) { return { invoiceId: d.id, saves: pounds(d.open - Math.round(d.open * (1 - sp.discount.pct / 100))) }; });
    }

    /* ---- expenses: document + category + approval ---- */
    function addExpense(e) {
      var s = load(), id = str(e && e.id, 'missing-key');
      if (find(s.expenses, id)) return id;
      var c = cents(e.amount), doc = str(e.document, 'missing-document'), cat = str(e.category, 'missing-category'), by = str(e.createdBy, 'missing-user');
      if (categories.indexOf(cat) < 0) fail('bad-category');
      s.expenses.push({ id: id, cents: c, document: doc, category: cat, createdBy: by, at: now(), status: 'draft', note: e.note || '' });
      save(s); return id;
    }
    function decide(id, approver, ok, reason) {
      var s = load(), x = find(s.expenses, str(id, 'missing-key')); if (!x) fail('unknown-expense');
      approver = str(approver, 'missing-user');
      if (x.status !== 'draft') fail('not-draft');
      if (approver === x.createdBy) fail('self-approval');
      x.status = ok ? 'approved' : 'rejected'; x.decidedBy = approver; x.decidedAt = now(); x.reason = reason || '';
      save(s);
    }
    function approveExpense(id, approver) { decide(id, approver, true); }
    function rejectExpense(id, approver, reason) { decide(id, approver, false, reason); }
    function payExpense(id, at) {
      var s = load(), x = find(s.expenses, str(id, 'missing-key')); if (!x) fail('unknown-expense');
      if (x.status === 'paid') return;
      if (x.status !== 'approved') fail('not-approved');
      x.status = 'paid'; x.paidAt = at || now(); save(s);
    }
    function expenses(status) {
      return load().expenses.filter(function (x) { return !status || x.status === status; })
        .map(function (x) { var o = JSON.parse(JSON.stringify(x)); o.amount = pounds(x.cents); delete o.cents; return o; });
    }

    /* ---- mock bank register (local only) ---- */
    function addBankEntry(b) {
      var s = load(), id = str(b && b.id, 'missing-key');
      if (find(s.bank, id)) return id;
      s.bank.push({ id: id, cents: cents(b.amount), at: b.at || now(), memo: b.memo || '', ref: b.ref || null });
      save(s); return id;
    }
    /* purchases: local purchasing records [{id, supplierId, total}]. Bank entries match by ref (payment id / expense id) and amount. */
    function reconcile(purchases) {
      var s = load(), diffs = [], used = {};
      var outflows = [];
      s.moves.forEach(function (m) { if (m.type === 'payment' && !reversed(s, m.id)) outflows.push({ id: m.id, cents: m.cents, kind: 'payment' }); });
      s.expenses.forEach(function (x) { if (x.status === 'paid') outflows.push({ id: x.id, cents: x.cents, kind: 'expense' }); });
      outflows.forEach(function (o) {
        var b = s.bank.filter(function (e) { return e.ref === o.id && !used[e.id]; })[0];
        if (!b) return diffs.push({ type: 'missing-bank-entry', kind: o.kind, id: o.id, amount: pounds(o.cents) });
        used[b.id] = 1;
        if (b.cents !== o.cents) diffs.push({ type: 'bank-amount-mismatch', kind: o.kind, id: o.id, ledger: pounds(o.cents), bank: pounds(b.cents) });
      });
      s.bank.forEach(function (b) { if (!used[b.id]) diffs.push({ type: 'unmatched-bank-entry', id: b.id, amount: pounds(b.cents) }); });
      var byId = {}; (purchases || []).forEach(function (p) { byId[p.id] = p; });
      s.moves.forEach(function (m) {
        if (m.type !== 'invoice' || reversed(s, m.id)) return;
        var p = byId[m.id];
        if (!p) return diffs.push({ type: 'invoice-without-purchase', id: m.id, amount: pounds(m.cents) });
        if (p.supplierId !== m.supplierId) diffs.push({ type: 'supplier-mismatch', id: m.id, ledger: m.supplierId, purchase: p.supplierId });
        if (Math.round(p.total * 100) !== m.cents) diffs.push({ type: 'invoice-amount-mismatch', id: m.id, ledger: pounds(m.cents), purchase: p.total });
        delete byId[m.id];
      });
      Object.keys(byId).forEach(function (id) { diffs.push({ type: 'purchase-without-invoice', id: id, amount: byId[id].total }); });
      return { ok: diffs.length === 0, diffs: diffs };
    }

    return { setSupplier: setSupplier, addInvoice: addInvoice, pay: pay, reverse: reverse, balance: balance, aging: aging,
      discountsAvailable: discountsAvailable, addExpense: addExpense, approveExpense: approveExpense, rejectExpense: rejectExpense,
      payExpense: payExpense, expenses: expenses, addBankEntry: addBankEntry, reconcile: reconcile };
  }

  var api = { createSupplierAccounts: createSupplierAccounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaSupplierAccounts = api;
})(typeof window !== 'undefined' ? window : this);
