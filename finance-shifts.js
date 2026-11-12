/* NOVA Rx — FIN-03 local cash drawer + shifts (pure logic, no DOM, no network, frontend/local only).
   Shift: open (float) -> sales/drop/payout/cash counts -> close with counted cash -> variance (counted - expected).
   Non-zero variance leaves the shift 'pending-approval' until someone other than the closer approves it; then 'closed'.
   Closed (and pending) shifts are immutable. Reconcile cash / mock-card / bank against external statement totals.
   Amounts are pounds in the API, integer minor units (x100) internally. Works as <script> (window.NovaShifts) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var METHODS = ['cash', 'card', 'bank'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  function minor(n, allowZero) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || (!allowZero && n === 0)) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }

  function createShifts(storage, key, opts) {
    key = key || 'nova.shifts';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { shifts: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('shifts-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.shifts)) fail('shifts-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('shifts-write-failed'); } }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function get(s, id) {
      for (var i = 0; i < s.shifts.length; i++) if (s.shifts[i].id === id) return s.shifts[i];
      fail('unknown-shift');
    }
    function editable(sh) { if (sh.status !== 'open') fail('shift-not-open'); return sh; }
    function sum(sh, type, method) {
      var t = 0;
      sh.events.forEach(function (e) { if (e.type === type && (!method || e.method === method)) t += e.amount; });
      return t;
    }
    function expectedCash(sh) { return sh.float + sum(sh, 'sale', 'cash') - sum(sh, 'drop') - sum(sh, 'payout'); }
    function view(sh) {
      var r = copy(sh);
      r.expectedCash = expectedCash(sh);
      r.totals = { cash: sum(sh, 'sale', 'cash'), card: sum(sh, 'sale', 'card'), bank: sum(sh, 'sale', 'bank') };
      return r;
    }
    function mutate(id, fn) { var s = load(); var sh = get(s, id); fn(sh, s); save(s); return view(sh); }

    function open(o) {
      o = o || {};
      var id = str(o.id, 'bad-shift-id'), drawer = str(o.drawerId, 'bad-drawer'), cashier = str(o.cashier, 'bad-cashier');
      var fl = minor(o.float, true);
      var s = load();
      s.shifts.forEach(function (x) {
        if (x.id === id) fail('duplicate-shift');
        if (x.drawerId === drawer && x.status === 'open') fail('drawer-already-open');
      });
      var sh = { id: id, drawerId: drawer, cashier: cashier, float: fl, openedAt: now(), status: 'open', events: [], counts: [], closing: null, approval: null };
      s.shifts.push(sh); save(s); return view(sh);
    }
    function sale(id, o) {
      o = o || {};
      if (METHODS.indexOf(o.method) < 0) fail('bad-method');
      var amt = minor(o.amount);
      return mutate(id, function (sh) { editable(sh).events.push({ type: 'sale', method: o.method, amount: amt, ref: o.ref || null, at: now() }); });
    }
    function drop(id, o) {
      o = o || {}; var amt = minor(o.amount), by = str(o.by, 'bad-actor');
      return mutate(id, function (sh) {
        editable(sh);
        if (amt > expectedCash(sh)) fail('insufficient-cash');
        sh.events.push({ type: 'drop', amount: amt, by: by, at: now() });
      });
    }
    function payout(id, o) {
      o = o || {}; var amt = minor(o.amount), by = str(o.by, 'bad-actor'), reason = str(o.reason, 'reason-required');
      return mutate(id, function (sh) {
        editable(sh);
        if (amt > expectedCash(sh)) fail('insufficient-cash');
        sh.events.push({ type: 'payout', amount: amt, by: by, reason: reason, at: now() });
      });
    }
    function count(id, o) {
      o = o || {}; var amt = minor(o.counted, true), by = str(o.by, 'bad-actor');
      return mutate(id, function (sh) { editable(sh).counts.push({ counted: amt, by: by, at: now() }); });
    }
    function close(id, o) {
      o = o || {}; var by = str(o.by, 'bad-actor'), counted = minor(o.counted, true);
      return mutate(id, function (sh) {
        editable(sh);
        var exp = expectedCash(sh), variance = counted - exp;
        sh.counts.push({ counted: counted, by: by, at: now(), final: true });
        sh.closing = { by: by, at: now(), counted: counted, expected: exp, variance: variance };
        sh.status = variance === 0 ? 'closed' : 'pending-approval';
      });
    }
    function approveVariance(id, o) {
      o = o || {}; var by = str(o.by, 'bad-actor'), note = str(o.note, 'note-required');
      return mutate(id, function (sh) {
        if (sh.status !== 'pending-approval') fail('no-variance-pending');
        if (by === sh.closing.by || by === sh.cashier) fail('approver-must-differ');
        sh.approval = { by: by, note: note, at: now() };
        sh.status = 'closed';
      });
    }
    /* statements: { card, bank } in pounds, as reported by the card processor (mock) and bank. Cash comes from the count. */
    function reconcile(id, st) {
      var s = load(), sh = get(s, id);
      if (sh.status !== 'closed') fail('shift-not-closed');
      st = st || {};
      var v = view(sh), out = { shiftId: id, cash: { expected: v.closing.expected, counted: v.closing.counted, diff: v.closing.variance } };
      ['card', 'bank'].forEach(function (m) {
        var stm = minor(st[m], true);
        out[m] = { expected: v.totals[m], statement: stm, diff: stm - v.totals[m] };
      });
      out.matched = out.cash.diff === 0 && out.card.diff === 0 && out.bank.diff === 0;
      return out;
    }
    function getShift(id) { return view(get(load(), id)); }
    function list() { return load().shifts.map(view); }

    return { open: open, sale: sale, drop: drop, payout: payout, count: count, close: close, approveVariance: approveVariance, reconcile: reconcile, get: getShift, list: list };
  }

  var api = { createShifts: createShifts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaShifts = api;
})(typeof window !== 'undefined' ? window : globalThis);
