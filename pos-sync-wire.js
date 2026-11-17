/* NOVA Rx - S1-03: wires a finished POS sale / return into the offline outbox (NovaOutbox) and the on-device stock ledger
   (NovaStockLedger). The wiring itself never fetches. S1-04: a scheduler runs NovaBackendClient.syncAll (push outbox, pull,
   apply other devices' sales) every SYNC_POLL_MS and on online/focus/visible, ONLY while the per-device flag novaBackend.enabled
   is 'true'; with the flag OFF there are zero network calls and the sale screen behaves exactly as before. Every call is wrapped by the caller in try/catch:
   a wiring error must never block a sale.
   S2-02: POS sales/returns in non-box units (strip, tablet) map to integer base units via deps.units. Unmapped invoices go to
   nova.sync.review and can be retried via retryReview(getSale).
   S2-05: the scheduler also runs o.extras (credit sync: flush() before syncAll, applyChanges(feed) after it).
   Works as <script> (window.novaSync) and in Node (module.exports). */
(function (root) {
  'use strict';
  var round2 = function (n) { return Math.round((n + Number.EPSILON) * 100) / 100; };
  var codeOf = function (l) { return String((l && (l.barcode || l.name)) || '').trim(); };
  var isBox = function (l) { return !l || !l.unit || l.unit === 'box'; };
  var ledgerCode = function (l) { var c = codeOf(l); return c && !isBox(l) ? c + '#' + String(l.unit) : c; };
  var REVIEW_KEY = 'nova.sync.review';
  var REVIEW_MSG = 'وحدة البيع غير معرّفة لهذا الصنف — اضبط التعبئة ثم أعد الإرسال';

  function create(deps) {
    var outbox = deps.outbox, ledger = deps.ledger, storage = deps.storage || null, units = deps.units || null;

    function mapLine(l, overrideQty) {
      var c = codeOf(l), q = Number(overrideQty !== undefined ? overrideQty : (l && l.qty)), p = Number(l && l.price);
      if (!c || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0) return null;
      var perBox = null, u = null;
      if (units) {
        u = typeof units.canonical === 'function' ? units.canonical((l && l.unit) || 'box') : ((l && l.unit) || 'box');
        if (!u) return null;
        perBox = typeof units.perBoxOf === 'function' ? units.perBoxOf(l) : null;
        if (!perBox || typeof perBox !== 'object') return null;
      } else {
        if (!isBox(l)) return null;
        u = 'box';
        perBox = { box: 1 };
      }
      var baseUnit = perBox.tablet ? 'tablet' : (perBox.strip ? 'strip' : 'box');
      var basePerBox = Number(perBox[baseUnit]);
      var factor = Number(perBox[u]);
      if (!Number.isSafeInteger(basePerBox) || basePerBox <= 0 || !isFinite(factor) || factor <= 0) return null;
      var baseQty = (q * basePerBox) / factor;
      if (!Number.isSafeInteger(baseQty) || baseQty <= 0) return null;
      var basePrice = Math.ceil(Math.round(q * p * 100) / baseQty) / 100;
      return { code: c, qty: baseQty, price: basePrice, unit: baseUnit, perBox: basePerBox };
    }

    function byCode(lines) {
      var m = Object.create(null), order = [];
      (lines || []).forEach(function (l) {
        var mapped = mapLine(l);
        var c = mapped ? mapped.code : ledgerCode(l);
        var q = mapped ? mapped.qty : Number(l && l.qty);
        if (!c || !Number.isInteger(q) || q <= 0) return;
        if (!(c in m)) { m[c] = 0; order.push(c); }
        m[c] += q;
      });
      return order.map(function (c) { return { code: c, qty: m[c] }; });
    }

    function invoicePayload(sale) {
      var lines = [], gross = 0, plain = true;
      (sale.lines || []).forEach(function (l) {
        var mapped = mapLine(l);
        if (!mapped) { plain = false; return; }
        lines.push(mapped);
        gross += mapped.qty * mapped.price;
      });
      if (!lines.length || !plain) return null;
      var total = Number(sale.total), p = { id: String(sale.id), number: String(sale.number || sale.id), at: sale.at, total: isFinite(total) ? total : round2(gross), lines: lines };
      var d = round2(gross - p.total);
      if (d > 0) p.discount = d;
      return p;
    }

    function readReview() {
      if (!storage || typeof storage.getItem !== 'function') return [];
      try {
        var a = JSON.parse(storage.getItem(REVIEW_KEY) || '[]');
        return Array.isArray(a) ? a : [];
      } catch (e) { return []; }
    }

    function writeReview(a) {
      if (!storage || typeof storage.setItem !== 'function') return;
      try { storage.setItem(REVIEW_KEY, JSON.stringify(a)); } catch (e) { /* cosmetic list only */ }
    }

    function buildReturnPayload(sale, ret) {
      var pMap = Object.create(null), pOrder = [], ok = true;
      (ret.lines || []).forEach(function (rl) {
        var l = sale.lines && sale.lines[rl.idx];
        var mapped = mapLine(l, rl && rl.qty);
        if (!mapped) { ok = false; return; }
        var c = mapped.code;
        if (!(c in pMap)) { pMap[c] = { code: c, qty: 0, price: mapped.price }; pOrder.push(c); }
        pMap[c].qty += mapped.qty;
      });
      if (!ok || !pOrder.length) return null;
      var retId = String(ret.id);
      return { id: 'ret:' + retId, op: 'return', clientReturnId: retId, saleInvoiceId: String(sale.id), lines: pOrder.map(function (c) { return pMap[c]; }) };
    }

    return {
      afterSale: function (sale) {
        if (!sale || !sale.id || !Array.isArray(sale.lines)) return { ok: false, error: 'bad-sale' };
        if (sale.source === 'SYNC') return { ok: true, movements: 0, queued: false, skipped: 'remote' };
        var out = { ok: true, movements: 0, queued: false }, ref = 'sale:' + String(sale.id);
        byCode(sale.lines).forEach(function (m) {
          try { ledger.append({ kind: 'sale', code: m.code, qty: m.qty, ref: ref }); out.movements++; }
          catch (e) { if (!e || e.code !== 'duplicate-movement') out.ok = false; }
        });
        var p = invoicePayload(sale);
        if (p) {
          try { outbox.enqueue(p); out.queued = true; } catch (e) { out.ok = false; out.error = e && e.code; }
        } else {
          out.skipped = 'unit-mapping';
          if (storage) {
            var a = readReview(), sid = String(sale.id);
            if (!a.some(function (x) { return x && x.id === sid; })) {
              a.push({ id: sid, number: String(sale.number || sale.id), reason: 'unit-mapping', message_ar: REVIEW_MSG, at: sale.at, returns: [] });
              writeReview(a);
            }
          }
        }
        return out;
      },
      afterReturn: function (sale, ret) {
        if (!sale || !ret || !ret.id || !Array.isArray(ret.lines)) return { ok: false, error: 'bad-return' };
        var out = { ok: true, movements: 0, queued: false }, retId = String(ret.id), ref = 'return:' + retId, m = Object.create(null), order = [];
        ret.lines.forEach(function (rl) {
          var l = sale.lines && sale.lines[rl.idx];
          var mapped = mapLine(l, rl && rl.qty);
          var c = mapped ? mapped.code : ledgerCode(l);
          var q = mapped ? mapped.qty : Number(rl && rl.qty);
          if (!c || !Number.isInteger(q) || q <= 0) return;
          if (!(c in m)) { m[c] = 0; order.push(c); }
          m[c] += q;
        });
        order.forEach(function (c) {
          try { ledger.append({ kind: 'return', code: c, qty: m[c], ref: ref }); out.movements++; }
          catch (e) { if (!e || e.code !== 'duplicate-movement') out.ok = false; }
        });
        if (!invoicePayload(sale)) {
          out.skipped = 'unit-mapping';
          if (storage) {
            var a = readReview(), sid = String(sale.id || '');
            var entry = a.filter(function (x) { return x && x.id === sid; })[0];
            if (!entry) {
              entry = { id: sid, number: String(sale.number || sid), reason: 'unit-mapping', message_ar: REVIEW_MSG, at: sale.at, returns: [] };
              a.push(entry);
            }
            if (!Array.isArray(entry.returns)) entry.returns = [];
            var rLines = ret.lines.map(function (rl) { return { idx: rl.idx, qty: rl.qty }; });
            if (!entry.returns.some(function (r) { return r && r.id === retId; })) {
              entry.returns.push({ id: retId, lines: rLines });
            }
            writeReview(a);
          }
          return out;
        }
        var payload = buildReturnPayload(sale, ret);
        if (!payload) { out.ok = false; out.error = 'empty-return-lines'; return out; }
        try {
          var eq = outbox.enqueue(payload);
          if (eq && eq.ok === false) { out.ok = false; out.error = eq.error || 'enqueue-failed'; }
          else out.queued = true;
        } catch (e) { out.ok = false; out.error = (e && (e.code || e.message)) || 'enqueue-failed'; }
        return out;
      },
      retryReview: function (getSale) {
        var list = readReview(), keep = [], queued = 0;
        if (typeof getSale !== 'function') return { queued: 0, still: list.length };
        list.forEach(function (entry) {
          if (!entry || !entry.id) return;
          var sale = getSale(entry.id);
          var p = sale ? invoicePayload(sale) : null;
          if (!p) { keep.push(entry); return; }
          var rets = Array.isArray(entry.returns) ? entry.returns : [];
          var retPayloads = [], allRetsOk = true;
          rets.forEach(function (r) {
            var rp = buildReturnPayload(sale, r);
            if (!rp) allRetsOk = false;
            else retPayloads.push(rp);
          });
          if (!allRetsOk) { keep.push(entry); return; }
          try {
            outbox.enqueue(p);
            retPayloads.forEach(function (rp) { outbox.enqueue(rp); });
            queued++;
          } catch (e) { keep.push(entry); }
        });
        writeReview(keep);
        return { queued: queued, still: keep.length };
      },
      applyChanges: function (changes) {
        var out = { applied: 0, skipped: 0 };
        (changes || []).forEach(function (c) {
          var d = c && c.data;
          if (!c || c.deleted || !d || !Array.isArray(d.items)) { out.skipped++; return; }
          if (c.entity === 'sale_return') {
            var retId = String(d.clientReturnId || d.returnId || c.id || '');
            if (!retId || !d.items.length) { out.skipped++; return; }
            var rref = 'return:' + retId, appended = 0, valid = 0;
            d.items.forEach(function (it) {
              var code = it && String(it.productId || ''), q = Number(it && it.qty);
              if (!code || !Number.isInteger(q) || q <= 0) return;
              valid++;
              try { ledger.append({ kind: 'return', code: code, qty: q, ref: rref }); appended++; }
              catch (e) { if (!e || e.code !== 'duplicate-movement') throw e; }
            });
            if (!valid || appended === 0) out.skipped++; else out.applied++;
            return;
          }
          if (c.entity !== 'sale') { out.skipped++; return; }
          var id = String(d.invoiceId || d.saleId || '');
          if (!id || !deps.hasSale || !deps.addSale || deps.hasSale(id)) { out.skipped++; return; }
          var lines = [], gross = 0, m = Object.create(null), order = [];
          d.items.forEach(function (it) {
            var q = Number(it && it.qty), p = Number(it && it.unitPriceMinor) / 100;
            if (!it || !it.productId || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0) return;
            var code = String(it.productId);
            var u = it.unit || 'box';
            var uf = it.perBox || 1;
            lines.push({ name: code, barcode: code, unit: u, unitFactor: uf, price: p, qty: q, discount: 0 });
            gross += q * p;
            if (!(code in m)) { m[code] = 0; order.push(code); }
            m[code] += q;
          });
          if (!lines.length) { out.skipped++; return; }
          var rec = { id: id, number: 'SYNC-' + id.slice(-6), at: c.changedAt || new Date().toISOString(), status: 'final', payment: 'cash', source: 'SYNC', remoteSaleId: d.saleId || null,
            lines: lines, discount: round2((Number(d.discountMinor) || 0) / 100), total: round2(gross - (Number(d.discountMinor) || 0) / 100) };
          if (!deps.addSale(rec)) { out.skipped++; return; }
          order.forEach(function (code) { try { ledger.append({ kind: 'sale', code: code, qty: m[code], ref: 'sale:' + id }); } catch (e) { /* duplicate = already counted */ } });
          out.applied++;
        });
        return out;
      },
      pending: function () {
        var revUnits = readReview().length;
        try {
          var a = outbox.all();
          return {
            pending: a.filter(function (e) { return e.status === 'pending'; }).length,
            review: a.filter(function (e) { return e.status === 'review'; }).length,
            reviewUnits: revUnits,
            stockWait: a.filter(function (e) { return e.status === 'pending' && e.lastError === 'SYNC_STOCK_CONFLICT'; }).length
          };
        } catch (e) { return { pending: 0, review: 0, reviewUnits: revUnits, stockWait: 0 }; }
      }
    };
  }

  function chip(api, doc, storage) {
    if (!doc || !doc.body) return;
    var on = false; try { on = storage.getItem('novaBackend.enabled') === 'true'; } catch (e) { on = false; }
    var el = doc.getElementById('novaSyncChip'), p = api.pending();
    if (!on || (!p.pending && !p.review && !p.reviewUnits)) { if (el) el.remove(); return; }
    if (!el) {
      el = doc.createElement('div'); el.id = 'novaSyncChip'; el.dir = 'rtl'; el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;bottom:8px;inset-inline-start:8px;z-index:50;background:#1f2937;color:#fff;border-radius:999px;padding:4px 12px;font-size:12px;opacity:.9;pointer-events:none';
      doc.body.appendChild(el);
    }
    el.textContent = p.review ? 'تحتاج مراجعة (' + p.review + ')' : (p.reviewUnits ? 'فواتير تحتاج ضبط الوحدة (' + p.reviewUnits + ')' : (p.stockWait ? 'فواتير تنتظر رصيد الصنف على الخادم (' + p.stockWait + ')' : 'في انتظار المزامنة (' + p.pending + ')'));
  }

  var SYNC_POLL_MS = 8000;
  function createScheduler(o) {
    var busy = false;
    function tick() {
      if (busy || !o.client.enabled()) return Promise.resolve({ skipped: true });
      if (o.isHidden && o.isHidden()) return Promise.resolve({ skipped: true, hidden: true });
      if (o.isOffline && o.isOffline()) return Promise.resolve({ skipped: true, offline: true });
      try {
        if (o.wire && typeof o.wire.retryReview === 'function') {
          var gs = o.getSale || function (id) { return root.novaSales && root.novaSales.list().filter(function (x) { return x.id === id; })[0]; };
          o.wire.retryReview(gs);
        }
      } catch (e) { /* never block sync tick */ }
      busy = true;
      var extras = typeof o.extras === 'function' ? (o.extras() || []) : (Array.isArray(o.extras) ? o.extras : []); // a function = resolved per tick (credit-ledger.js loads deferred)
      for (var i = 0; i < extras.length; i++) {
        try { if (extras[i] && extras[i].flush) extras[i].flush(); } catch (e) { /* one extra never blocks the others */ }
      }
      return o.client.syncAll().then(function (r) {
        var applied = { applied: 0, skipped: 0 };
        try {
          var f = o.client.feed();
          if (f && f.length) {
            applied = o.wire.applyChanges(f);
            for (var j = 0; j < extras.length; j++) {
              try { if (extras[j] && extras[j].applyChanges) extras[j].applyChanges(f); } catch (e) { /* idempotent: retried with the next feed */ }
            }
            try { o.storage.setItem('novaBackend.feed', '[]'); } catch (e) { /* retried next cycle; applyChanges is idempotent */ }
          }
        } catch (e) { applied = { applied: 0, skipped: 0, error: String(e && e.message || e) }; }
        finally { busy = false; }
        try { if (o.onDone) o.onDone(); } catch (e) { /* cosmetic */ }
        return { skipped: false, sync: r, applied: applied };
      }, function (e) { busy = false; return { skipped: false, error: String(e && e.message || e) }; });
    }
    return { tick: tick };
  }

  var api = { create: create, chip: chip, createScheduler: createScheduler, SYNC_POLL_MS: SYNC_POLL_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.NovaOutbox && root.NovaStockLedger) {
    var ls; try { ls = root.localStorage; } catch (e) { ls = null; }
    if (ls) {
      var outbox = root.NovaOutbox.createOutbox(ls, 'nova.outbox');
      var unitsDep = root.novaUnits ? {
        perBoxOf: function (l) { try { var v = root.novaUnits.validatePackaging(root.novaUnits.getPackaging(l)); return v.ok ? v.perBox : null; } catch (e) { return null; } },
        canonical: function (u) { return root.novaUnits.canonicalUnit(u || 'box'); }
      } : null;
      var getSaleFn = function (id) { return root.novaSales && root.novaSales.list().filter(function (x) { return x.id === id; })[0]; };
      var wire = create({ outbox: outbox, ledger: root.NovaStockLedger.createLedger(ls, 'nova.stock.ledger'), storage: ls, units: unitsDep,
        hasSale: function (id) { return !!(root.novaSales && root.novaSales.list().some(function (x) { return x.id === id; })); },
        addSale: function (rec) { return !!(root.novaSales && root.novaSales.add(rec)); } });
      var refresh = function () { try { chip(wire, root.document, ls); } catch (e) { /* cosmetic only */ } };
      var sched = null;
      if (root.NovaBackendClient && typeof root.fetch === 'function') {
        var client = root.NovaBackendClient.createBackendClient({ storage: ls, fetch: root.fetch.bind(root), outbox: outbox,
          getToken: function () { try { return root.sessionStorage.getItem('novaBackend.token'); } catch (e) { return null; } } });
        sched = createScheduler({ client: client, wire: wire, storage: ls, onDone: refresh, getSale: getSaleFn,
          extras: function () { return [root.novaCreditSync, root.novaReceiptSync, root.novaShiftSync, root.novaPoSync].filter(Boolean); },
          isHidden: function () { return !!(root.document && root.document.hidden); },
          isOffline: function () { return root.navigator && root.navigator.onLine === false; } });
        var go = function () { sched.tick(); };
        root.setInterval(go, SYNC_POLL_MS);
        root.addEventListener('online', go); root.addEventListener('focus', go);
        if (root.document) root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) go(); });
      }
      root.novaSync = {
        afterSale: function (s) { var r = wire.afterSale(s); refresh(); return r; },
        afterReturn: function (s, r) { var res = wire.afterReturn(s, r); refresh(); return res; },
        retryReview: function (gs) { var r = wire.retryReview(gs || getSaleFn); refresh(); return r; },
        pending: wire.pending, refresh: refresh, syncNow: function () { return sched ? sched.tick() : Promise.resolve({ skipped: true }); }
      };
      if (root.document && root.document.addEventListener) root.document.addEventListener('DOMContentLoaded', refresh);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
