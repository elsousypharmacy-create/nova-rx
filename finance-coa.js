/* NOVA Rx — FIN-01 local chart of accounts + opening balances (pure logic, no DOM, no network, frontend/local only).
   Accounts (code, type, optional parent), cost centers, branches, periods (YYYY-MM, open/closed),
   base currency + dated conversion rates, and opening balances: a draft with a source, balanced in base currency,
   approved by someone other than the preparer; approved openings are immutable (correct by a new period/adjustment, never edit).
   Amounts are pounds in the API, integer minor units (x100) internally. Works as <script> (window.NovaCoa) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  function isDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d; }
  function minor(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }

  function createCoa(storage, key, opts) {
    key = key || 'nova.coa';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { base: null, accounts: [], costCenters: [], branches: [], periods: [], rates: [], openings: [], seq: 0 };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('coa-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.accounts) || !Array.isArray(s.openings) || !Array.isArray(s.periods) || !Array.isArray(s.rates)) fail('coa-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('coa-write-failed'); } }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function find(list, f) { for (var i = 0; i < list.length; i++) if (f(list[i])) return list[i]; return null; }
    function mutate(fn) { var s = load(); var r = fn(s); save(s); return copy(r); }

    function setBaseCurrency(code) {
      code = str(code, 'bad-currency').toUpperCase();
      return mutate(function (s) {
        if (s.base && s.base !== code) fail('base-currency-locked');
        s.base = code; return { base: code };
      });
    }
    function addAccount(a) {
      a = a || {};
      var code = str(a.code, 'bad-account-code'), name = str(a.name, 'bad-account-name');
      if (TYPES.indexOf(a.type) < 0) fail('bad-account-type');
      return mutate(function (s) {
        if (find(s.accounts, function (x) { return x.code === code; })) fail('duplicate-account');
        if (a.parent != null) {
          var p = find(s.accounts, function (x) { return x.code === a.parent; });
          if (!p) fail('unknown-parent');
          if (p.type !== a.type) fail('parent-type-mismatch');
        }
        var r = { code: code, name: name, type: a.type, parent: a.parent == null ? null : a.parent, active: true };
        s.accounts.push(r); return r;
      });
    }
    function addSimple(listName, dupCode) {
      return function (o) {
        o = o || {};
        var id = str(o.id, 'bad-id'), name = str(o.name, 'bad-name');
        return mutate(function (s) {
          if (find(s[listName], function (x) { return x.id === id; })) fail(dupCode);
          var r = { id: id, name: name, active: true }; s[listName].push(r); return r;
        });
      };
    }
    function addPeriod(p) {
      p = p || {};
      var id = str(p.id, 'bad-id');
      if (!isDate(p.start) || !isDate(p.end) || p.end < p.start) fail('bad-period');
      return mutate(function (s) {
        if (find(s.periods, function (x) { return x.id === id; })) fail('duplicate-period');
        if (find(s.periods, function (x) { return p.start <= x.end && x.start <= p.end; })) fail('period-overlap');
        var r = { id: id, start: p.start, end: p.end, status: 'open' }; s.periods.push(r); return r;
      });
    }
    function closePeriod(id) {
      return mutate(function (s) {
        var p = find(s.periods, function (x) { return x.id === id; });
        if (!p) fail('unknown-period');
        p.status = 'closed'; return p;
      });
    }
    /* dated rate: 1 unit of `currency` = rate base units, effective from `from` (inclusive). Re-adding same (currency, from) is rejected. */
    function addRate(r) {
      r = r || {};
      var cur = str(r.currency, 'bad-currency').toUpperCase();
      if (!isDate(r.from)) fail('bad-date');
      if (typeof r.rate !== 'number' || !isFinite(r.rate) || r.rate <= 0) fail('bad-rate');
      return mutate(function (s) {
        if (!s.base) fail('no-base-currency');
        if (cur === s.base) fail('rate-for-base');
        if (find(s.rates, function (x) { return x.currency === cur && x.from === r.from; })) fail('duplicate-rate');
        var o = { currency: cur, from: r.from, rate: r.rate }; s.rates.push(o); return o;
      });
    }
    function rateFor(s, cur, date) {
      if (cur === s.base) return 1;
      var best = null;
      s.rates.forEach(function (x) { if (x.currency === cur && x.from <= date && (!best || x.from > best.from)) best = x; });
      if (!best) fail('no-rate');
      return best.rate;
    }
    function convert(amount, currency, date) {
      var s = load(); if (!s.base) fail('no-base-currency');
      if (!isDate(date)) fail('bad-date');
      return Math.round(minor(amount) * rateFor(s, String(currency).toUpperCase(), date)) / 100;
    }

    /* opening: {id, periodId, branchId, source, preparedBy, lines:[{account, debit, credit, currency?, costCenter?}]} */
    function draftOpening(o) {
      o = o || {};
      var id = str(o.id, 'bad-id'), source = str(o.source, 'missing-source'), by = str(o.preparedBy, 'missing-preparer');
      if (!Array.isArray(o.lines) || o.lines.length < 2) fail('bad-lines');
      return mutate(function (s) {
        if (!s.base) fail('no-base-currency');
        if (find(s.openings, function (x) { return x.id === id; })) fail('duplicate-opening');
        var per = find(s.periods, function (x) { return x.id === o.periodId; });
        if (!per) fail('unknown-period');
        if (per.status !== 'open') fail('period-closed');
        if (!find(s.branches, function (x) { return x.id === o.branchId && x.active; })) fail('unknown-branch');
        if (find(s.openings, function (x) { return x.periodId === per.id && x.branchId === o.branchId && x.status !== 'void'; })) fail('opening-exists');
        var dr = 0, cr = 0;
        var lines = o.lines.map(function (l) {
          l = l || {};
          var acc = find(s.accounts, function (x) { return x.code === l.account; });
          if (!acc || !acc.active) fail('unknown-account');
          if (acc.type === 'revenue' || acc.type === 'expense') fail('opening-account-type');
          if (l.costCenter != null && !find(s.costCenters, function (x) { return x.id === l.costCenter && x.active; })) fail('unknown-cost-center');
          var d = minor(l.debit || 0), c = minor(l.credit || 0);
          if ((d > 0) === (c > 0)) fail('line-one-side');
          var cur = l.currency ? String(l.currency).toUpperCase() : s.base, rate = rateFor(s, cur, per.start);
          var bd = Math.round(d * rate), bc = Math.round(c * rate);
          dr += bd; cr += bc;
          return { account: acc.code, costCenter: l.costCenter == null ? null : l.costCenter, currency: cur, debit: d / 100, credit: c / 100, rate: rate, baseDebit: bd / 100, baseCredit: bc / 100 };
        });
        if (dr !== cr) fail('unbalanced');
        var r = { id: id, periodId: per.id, branchId: o.branchId, source: source, preparedBy: by, preparedAt: now(), status: 'draft', approvedBy: null, approvedAt: null, base: s.base, total: dr / 100, lines: lines };
        s.openings.push(r); return r;
      });
    }
    function approveOpening(id, approver) {
      approver = str(approver, 'missing-approver');
      return mutate(function (s) {
        var o = find(s.openings, function (x) { return x.id === id; });
        if (!o) fail('unknown-opening');
        if (o.status !== 'draft') fail('not-draft');
        if (o.preparedBy === approver) fail('self-approval');
        var per = find(s.periods, function (x) { return x.id === o.periodId; });
        if (!per || per.status !== 'open') fail('period-closed');
        o.status = 'approved'; o.approvedBy = approver; o.approvedAt = now(); return o;
      });
    }
    function voidOpening(id) {
      return mutate(function (s) {
        var o = find(s.openings, function (x) { return x.id === id; });
        if (!o) fail('unknown-opening');
        if (o.status !== 'draft') fail('not-draft');
        o.status = 'void'; return o;
      });
    }
    /* base-currency balance per account from approved openings (optionally one branch) */
    function trialBalance(branchId) {
      var s = load(), out = {}, dr = 0, cr = 0;
      s.openings.forEach(function (o) {
        if (o.status !== 'approved' || (branchId && o.branchId !== branchId)) return;
        o.lines.forEach(function (l) {
          var a = out[l.account] || (out[l.account] = { debit: 0, credit: 0 });
          a.debit = Math.round((a.debit + l.baseDebit) * 100) / 100; a.credit = Math.round((a.credit + l.baseCredit) * 100) / 100;
          dr += Math.round(l.baseDebit * 100); cr += Math.round(l.baseCredit * 100);
        });
      });
      return { base: s.base, accounts: out, debit: dr / 100, credit: cr / 100, balanced: dr === cr };
    }
    function list(what) { var s = load(); if (!(what in s) || what === 'seq') fail('bad-list'); return copy(s[what]); }

    return {
      setBaseCurrency: setBaseCurrency, addAccount: addAccount,
      addCostCenter: addSimple('costCenters', 'duplicate-cost-center'), addBranch: addSimple('branches', 'duplicate-branch'),
      addPeriod: addPeriod, closePeriod: closePeriod, addRate: addRate, convert: convert,
      draftOpening: draftOpening, approveOpening: approveOpening, voidOpening: voidOpening,
      trialBalance: trialBalance, list: list
    };
  }

  var api = { createCoa: createCoa, ACCOUNT_TYPES: TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaCoa = api;
})(typeof window !== 'undefined' ? window : globalThis);
