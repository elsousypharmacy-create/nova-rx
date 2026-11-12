/* NOVA Rx — OFF-03 persistent offline outbox + mock sync endpoint (pure logic, no DOM, no real network).
   A finalized invoice is enqueued under its idempotency key (the invoice id) and is NEVER deleted: it goes
   pending -> synced, or pending -> review (price / balance / lot conflict) -> pending (resubmit) | resolved (kept local).
   Sync failures only schedule a retry with exponential backoff; nothing is dropped after any number of attempts.
   Works as a <script> (window.NovaOutbox) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  var TYPES = { price: 1, balance: 1, lot: 1 };

  /* opts: { now(): ms, baseMs: 2000, capMs: 3600000 } */
  function createOutbox(storage, key, opts) {
    key = key || 'nova.outbox';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var baseMs = opts.baseMs || 2000, capMs = opts.capMs || 3600000;
    var running = false;

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      var a;
      try { a = JSON.parse(raw); } catch (e) { fail('outbox-corrupt'); }
      if (!Array.isArray(a)) fail('outbox-corrupt');
      return a;
    }
    function save(a) {
      try { storage.setItem(key, JSON.stringify(a)); } catch (e) { fail('outbox-write-failed'); }
    }
    function find(a, k) { for (var i = 0; i < a.length; i++) if (a[i].key === k) return a[i]; return null; }
    function backoff(attempts) { return Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempts - 1))); }

    /* invoice: { id, number, total, lines: [{code, qty, price, lot?}] }. Same id twice returns the stored entry (no duplicate). */
    function enqueue(invoice) {
      if (!invoice || typeof invoice.id !== 'string' || !invoice.id) fail('missing-key');
      if (!Array.isArray(invoice.lines) || !invoice.lines.length) fail('no-lines');
      invoice.lines.forEach(function (l) {
        if (!l || typeof l.code !== 'string' || !l.code) fail('bad-code');
        if (!isInt(l.qty) || l.qty <= 0) fail('bad-qty');
        if (typeof l.price !== 'number' || !isFinite(l.price) || l.price < 0) fail('bad-price');
      });
      var a = load(), ex = find(a, invoice.id);
      if (ex) return copy(ex);
      var e = { key: invoice.id, payload: copy(invoice), status: 'pending', attempts: 0, nextAt: 0, queuedAt: now(), lastError: null, conflicts: [] };
      a.push(e);
      save(a);
      return copy(e);
    }

    /* endpoint.send({key, payload}) -> {ok:true} | {conflicts:[{type,code,...}]}; a throw / rejection = network failure.
       Handles each due entry once per call; a second concurrent call is a no-op. */
    function sync(endpoint) {
      if (running) return Promise.resolve({ skipped: true, synced: 0, review: 0, retry: 0 });
      running = true;
      var out = { skipped: false, synced: 0, review: 0, retry: 0 };
      var t0 = now();
      var due = load().filter(function (e) { return e.status === 'pending' && e.nextAt <= t0; }).map(function (e) { return e.key; });
      var chain = Promise.resolve();
      due.forEach(function (k) {
        chain = chain.then(function () {
          var cur = find(load(), k);
          if (!cur || cur.status !== 'pending') return;
          var res;
          return Promise.resolve().then(function () { return endpoint.send({ key: cur.key, payload: copy(cur.payload) }); })
            .then(function (r) { res = r; }, function (err) { res = { error: String(err && err.message || err) }; })
            .then(function () {
              var a = load(), e = find(a, k);
              e.attempts += 1;
              if (res && res.ok === true) { e.status = 'synced'; e.lastError = null; e.syncedAt = now(); out.synced++; }
              else if (res && Array.isArray(res.conflicts) && res.conflicts.length && res.conflicts.every(function (c) { return c && TYPES[c.type]; })) {
                e.status = 'review'; e.conflicts = copy(res.conflicts); e.lastError = null; out.review++;
              } else {
                e.lastError = (res && res.error) || 'bad-response';
                e.nextAt = now() + backoff(e.attempts);
                out.retry++;
              }
              save(a);
            });
        });
      });
      return chain.then(function () { running = false; return out; }, function (e) { running = false; throw e; });
    }

    /* action 'resubmit' puts it back in the queue (fresh retry, same key); 'keep-local' closes the review but keeps the invoice. */
    function resolve(k, r) {
      if (!r || (r.action !== 'resubmit' && r.action !== 'keep-local')) fail('bad-action');
      if (typeof r.by !== 'string' || !r.by) fail('missing-reviewer');
      var a = load(), e = find(a, k);
      if (!e) fail('not-found');
      if (e.status !== 'review') fail('not-in-review');
      e.resolution = { action: r.action, by: r.by, note: r.note || '', at: now() };
      if (r.action === 'resubmit') { e.status = 'pending'; e.nextAt = 0; e.attempts = 0; }
      else e.status = 'resolved';
      save(a);
      return copy(e);
    }

    function by(status) { return load().filter(function (e) { return e.status === status; }).map(copy); }
    return {
      enqueue: enqueue, sync: sync, resolve: resolve,
      all: function () { return load().map(copy); },
      pending: function () { return by('pending'); },
      needsReview: function () { return by('review'); },
      get: function (k) { var e = find(load(), k); return e ? copy(e) : null; }
    };
  }

  /* MOCK server for tests and the UI trial. Holds balances and prices in memory; never touches a network.
     Idempotent per key (a replay after a lost response returns the stored answer and does not decrement again).
     A sale is all-or-nothing: if any line conflicts, no balance moves. stock: {code: {qty, price, lots?: {lot: qty}}}.
     opts.failNext(n): next n calls throw (simulated network loss; the sale is NOT applied). opts.dropResponseNext: apply, then throw. */
  function createMockEndpoint(stock) {
    var seen = {}, st = copy(stock), failures = 0, dropResponses = 0, calls = 0;
    return {
      calls: function () { return calls; },
      failNext: function (n) { failures = n; },
      dropResponseNext: function (n) { dropResponses = n; },
      balance: function (code) { return st[code] ? st[code].qty : 0; },
      send: function (req) {
        calls++;
        if (failures > 0) { failures--; throw new Error('network-down'); }
        var res;
        if (Object.prototype.hasOwnProperty.call(seen, req.key)) res = seen[req.key];
        else {
          var conflicts = [];
          req.payload.lines.forEach(function (l) {
            var s = st[l.code];
            if (!s) { conflicts.push({ type: 'balance', code: l.code, wanted: l.qty, available: 0 }); return; }
            if (l.price !== s.price) conflicts.push({ type: 'price', code: l.code, sold: l.price, current: s.price });
            if (l.lot != null && (!s.lots || (s.lots[l.lot] || 0) < l.qty)) conflicts.push({ type: 'lot', code: l.code, lot: l.lot, wanted: l.qty, available: s.lots ? (s.lots[l.lot] || 0) : 0 });
            var total = req.payload.lines.filter(function (x) { return x.code === l.code; }).reduce(function (n, x) { return n + x.qty; }, 0);
            if (s.qty < total) conflicts.push({ type: 'balance', code: l.code, wanted: total, available: s.qty });
          });
          if (conflicts.length) res = { conflicts: conflicts };
          else {
            req.payload.lines.forEach(function (l) { st[l.code].qty -= l.qty; if (l.lot != null) st[l.code].lots[l.lot] -= l.qty; });
            res = { ok: true };
          }
          seen[req.key] = res;
        }
        if (dropResponses > 0) { dropResponses--; throw new Error('response-lost'); }
        return copy(res);
      }
    };
  }

  var api = { createOutbox: createOutbox, createMockEndpoint: createMockEndpoint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaOutbox = api;
})(typeof window !== 'undefined' ? window : this);
