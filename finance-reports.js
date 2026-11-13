/* NOVA Rx — FIN-05 local financial reports + period close (pure logic, no DOM, no network, frontend/local only).
   Reads the FIN-02 journal (NovaJournal) and derives, for one YYYY-MM period: trial balance (cumulative to period end),
   P&L (net sales after returns, COGS, gross/net margin), balance sheet (A = L + E, equity = cumulative profit) and a direct cash-flow view
   (cash + bank movement grouped by the business event; a reversal is grouped with the event it cancels).
   Close locks the period with a frozen snapshot (needs a balanced trial balance); reopen needs permission (opts.canReopen, default deny) and a reason.
   The lock is a client-side guard on this device (assertOpen/isLocked for callers that post to the journal), not a security boundary.
   Works as a <script> (window.NovaReports) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';
  var ASSETS = ['cash', 'bank', 'ar', 'inventory'], LIABS = ['ap'];

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function c(p) { return Math.round(p * 100); }
  function pounds(m) { return m / 100; }
  function periodOf(at) {
    var d = new Date(at);
    if (at == null || isNaN(d.getTime())) fail('bad-date');
    return d.toISOString().slice(0, 7);
  }
  function checkPeriod(p) { if (typeof p !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) fail('bad-period'); return p; }
  /* margin in percent with 2 decimals; null when there is no net sales (never NaN/Infinity) */
  function pct(num, den) { return den > 0 ? Math.round((num / den) * 10000) / 100 : null; }

  /* journal: an object with list() (NovaJournal createJournal result). */
  function createReports(journal, storage, key, opts) {
    key = key || 'nova.finance.periods';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var canReopen = opts.canReopen || function () { return false; };

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { periods: {}, log: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('periods-corrupt'); }
      if (!s || typeof s !== 'object' || !s.periods || typeof s.periods !== 'object' || !Array.isArray(s.log)) fail('periods-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('periods-write-failed'); } }

    /* entries with their period; minor-unit lines */
    function entries() {
      var list = journal.list(), byId = {};
      list.forEach(function (e) { byId[e.id] = e; });
      return list.map(function (e) {
        var orig = e.reverses && byId[e.reverses] ? byId[e.reverses].type : e.type;
        return { period: periodOf(e.at), group: orig, entry: e,
          lines: e.lines.map(function (l) { return { account: l.account, debit: c(l.debit), credit: c(l.credit) }; }) };
      });
    }
    function net(rows, account, dir) { // dir 1 = debit-positive, -1 = credit-positive
      var t = 0;
      rows.forEach(function (r) { r.lines.forEach(function (l) { if (l.account === account) t += dir * (l.debit - l.credit); }); });
      return t;
    }

    function compute(p) {
      var all = entries(), upto = all.filter(function (r) { return r.period <= p; }), inP = all.filter(function (r) { return r.period === p; });
      var accounts = Object.keys(require_accounts());

      // trial balance, cumulative to period end
      var rows = [], D = 0, C = 0;
      accounts.forEach(function (a) {
        var d = 0, cr = 0;
        upto.forEach(function (r) { r.lines.forEach(function (l) { if (l.account === a) { d += l.debit; cr += l.credit; } }); });
        rows.push({ account: a, debit: pounds(d), credit: pounds(cr) }); D += d; C += cr;
      });
      var trialBalance = { rows: rows, debit: pounds(D), credit: pounds(C), balanced: D === C };

      // P&L for the period only
      var sales = net(inP, 'sales', -1), returns = net(inP, 'salesReturns', 1), cogs = net(inP, 'cogs', 1);
      var netSales = sales - returns, grossProfit = netSales - cogs;
      var expenses = net(inP, 'expense', 1), reval = net(inP, 'revaluation', -1);
      var netProfit = grossProfit - expenses + reval;
      var pnl = { sales: pounds(sales), returns: pounds(returns), netSales: pounds(netSales), cogs: pounds(cogs), grossProfit: pounds(grossProfit),
        expenses: pounds(expenses), revaluation: pounds(reval), netProfit: pounds(netProfit),
        grossMarginPct: pct(grossProfit, netSales), netMarginPct: pct(netProfit, netSales) };

      // balance sheet, cumulative to period end
      var assets = {}, liabs = {}, tA = 0, tL = 0;
      ASSETS.forEach(function (a) { var v = net(upto, a, 1); assets[a] = pounds(v); tA += v; });
      LIABS.forEach(function (a) { var v = net(upto, a, -1); liabs[a] = pounds(v); tL += v; });
      var equity = net(upto, 'sales', -1) - net(upto, 'salesReturns', 1) - net(upto, 'cogs', 1) - net(upto, 'expense', 1) + net(upto, 'revaluation', -1);
      var balanceSheet = { assets: assets, totalAssets: pounds(tA), liabilities: liabs, totalLiabilities: pounds(tL),
        equity: pounds(equity), balanced: tA === tL + equity };

      // cash flow: cash + bank movement grouped by event type
      function cashMove(rs) { var g = {}, t = 0; rs.forEach(function (r) { var m = 0; r.lines.forEach(function (l) { if (l.account === 'cash' || l.account === 'bank') m += l.debit - l.credit; });
        if (m) { g[r.group] = (g[r.group] || 0) + m; t += m; } }); return { g: g, t: t }; }
      var before = all.filter(function (r) { return r.period < p; }), mv = cashMove(inP), opening = cashMove(before).t;
      var by = {}; Object.keys(mv.g).forEach(function (k) { if (mv.g[k]) by[k] = pounds(mv.g[k]); });
      var cashFlow = { opening: pounds(opening), byEvent: by, netChange: pounds(mv.t), closing: pounds(opening + mv.t),
        reconciled: opening + mv.t === c(assets.cash) + c(assets.bank) };

      return { period: p, entryCount: inP.length, trialBalance: trialBalance, pnl: pnl, balanceSheet: balanceSheet, cashFlow: cashFlow };
    }
    function require_accounts() { return opts.accounts || defaultAccounts(); }
    function defaultAccounts() { return { cash: 1, bank: 1, ar: 1, inventory: 1, ap: 1, sales: 1, salesReturns: 1, cogs: 1, expense: 1, revaluation: 1 }; }

    /* Live report for an open period; the frozen snapshot (with a drift flag) for a closed one. */
    function report(period) {
      checkPeriod(period);
      var s = load(), rec = s.periods[period];
      if (rec && rec.status === 'closed') {
        var snap = copy(rec.snapshot), live = compute(period);
        snap.status = 'closed'; snap.closedBy = rec.closedBy; snap.closedAt = rec.closedAt;
        snap.drift = live.entryCount !== snap.entryCount || JSON.stringify(live.pnl) !== JSON.stringify(snap.pnl);
        return snap;
      }
      var r = compute(period); r.status = 'open'; r.drift = false; return r;
    }

    function close(period, by) {
      checkPeriod(period);
      if (typeof by !== 'string' || !by.trim()) fail('closer-required');
      var s = load(), rec = s.periods[period];
      if (rec && rec.status === 'closed') fail('already-closed');
      var r = compute(period);
      if (!r.trialBalance.balanced || !r.balanceSheet.balanced || !r.cashFlow.reconciled) fail('not-balanced');
      var at = now();
      s.periods[period] = { status: 'closed', closedBy: by.trim(), closedAt: at, snapshot: r, reopened: rec ? rec.reopened : 0 };
      s.log.push({ period: period, action: 'close', by: by.trim(), at: at });
      save(s); return report(period);
    }

    function reopen(period, o) {
      checkPeriod(period); o = o || {};
      if (!canReopen()) fail('not-permitted');
      if (typeof o.by !== 'string' || !o.by.trim()) fail('reopener-required');
      if (typeof o.reason !== 'string' || !o.reason.trim()) fail('reason-required');
      var s = load(), rec = s.periods[period];
      if (!rec || rec.status !== 'closed') fail('not-closed');
      var at = now();
      s.periods[period] = { status: 'open', reopened: (rec.reopened || 0) + 1, lastReopenedBy: o.by.trim(), lastReopenedAt: at };
      s.log.push({ period: period, action: 'reopen', by: o.by.trim(), reason: o.reason.trim(), at: at });
      save(s); return { period: period, status: 'open' };
    }

    function status(period) { checkPeriod(period); var r = load().periods[period]; return r ? r.status : 'open'; }
    function isLocked(at) { return status(periodOf(at)) === 'closed'; }
    function assertOpen(at) { if (isLocked(at)) fail('period-closed'); return true; }
    function history() { return copy(load().log); }

    return { report: report, close: close, reopen: reopen, status: status, isLocked: isLocked, assertOpen: assertOpen, history: history };
  }

  var api = { createReports: createReports, periodOf: periodOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaReports = api;
})(typeof window !== 'undefined' ? window : this);
