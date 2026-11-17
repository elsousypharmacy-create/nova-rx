/* NOVA Rx - S1-03: wires a finished POS sale / return into the offline outbox (NovaOutbox) and the on-device stock ledger
   (NovaStockLedger). The wiring itself never fetches. S1-04: a scheduler runs NovaBackendClient.syncAll (push outbox, pull,
   apply other devices' sales) every SYNC_POLL_MS and on online/focus/visible, ONLY while the per-device flag novaBackend.enabled
   is 'true'; with the flag OFF there are zero network calls and the sale screen behaves exactly as before. Every call is wrapped by the caller in try/catch:
   a wiring error must never block a sale.
   Sale line -> outbox line: code = barcode || name, qty = line qty (integers only), price = unit price (major units).
   Invoice discount sent = max(0, gross - total) so the server total equals the POS total.
   Returns / cancels append local stock movements only (kind 'return'); the outbox payload is invoice-shaped and the server
   would apply it as a sale, so server-side returns are a separate step (not enqueued here).
   Works as <script> (window.novaSync) and in Node (module.exports). */
(function (root) {
  'use strict';
  var round2 = function (n) { return Math.round((n + Number.EPSILON) * 100) / 100; };
  var codeOf = function (l) { return String((l && (l.barcode || l.name)) || '').trim(); };
  /* Stock is counted per sold unit: a strip is not a box. A non-box unit gets its own ledger code ("<code>#<unit>") so on-hand never mixes units. */
  var isBox = function (l) { return !l || !l.unit || l.unit === 'box'; };
  var ledgerCode = function (l) { var c = codeOf(l); return c && !isBox(l) ? c + '#' + String(l.unit) : c; };

  function create(deps) {
    var outbox = deps.outbox, ledger = deps.ledger, storage = deps.storage || null;

    /* qty per ledger code (a repeated product in one invoice is one movement). Prototype-free map: a product named "toString" is just a product. */
    function byCode(lines) {
      var m = Object.create(null), order = [];
      (lines || []).forEach(function (l) {
        var c = ledgerCode(l), q = Number(l && l.qty);
        if (!c || !Number.isInteger(q) || q <= 0) return;
        if (!(c in m)) { m[c] = 0; order.push(c); }
        m[c] += q;
      });
      return order.map(function (c) { return { code: c, qty: m[c] }; });
    }

    /* The server counts whole boxes (productId = code). Only an invoice made entirely of valid whole-box lines is queued; anything else
       (other unit, fractional or invalid line) would deduct the wrong stock or a wrong total, so it is skipped and listed in nova.sync.skipped. */
    function invoicePayload(sale) {
      var lines = [], gross = 0, plain = true;
      (sale.lines || []).forEach(function (l) {
        var c = codeOf(l), q = Number(l && l.qty), p = Number(l && l.price);
        if (!c || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0 || !isBox(l)) { plain = false; return; }
        lines.push({ code: c, qty: q, price: p }); gross += q * p;
      });
      if (!lines.length || !plain) return null;
      var total = Number(sale.total), p = { id: String(sale.id), number: String(sale.number || sale.id), at: sale.at, total: isFinite(total) ? total : round2(gross), lines: lines };
      var d = round2(gross - p.total);
      if (d > 0) p.discount = d;
      return p;
    }

    return {
      /* sale: the saved POS record. Idempotent (outbox by invoice id, ledger by kind+ref+code). */
      afterSale: function (sale) {
        if (!sale || !sale.id || !Array.isArray(sale.lines)) return { ok: false, error: 'bad-sale' };
        if (sale.source === 'SYNC') return { ok: true, movements: 0, queued: false, skipped: 'remote' }; // pulled from another device: applyChanges already moved stock; never push it back
        var out = { ok: true, movements: 0, queued: false }, ref = 'sale:' + String(sale.id); // the id is stable, the printed number may change
        byCode(sale.lines).forEach(function (m) {
          try { ledger.append({ kind: 'sale', code: m.code, qty: m.qty, ref: ref }); out.movements++; }
          catch (e) { if (!e || e.code !== 'duplicate-movement') out.ok = false; }
        });
        var p = invoicePayload(sale);
        if (p) { try { outbox.enqueue(p); out.queued = true; } catch (e) { out.ok = false; out.error = e && e.code; } }
        else if (storage) { // not sendable as whole boxes: keep a local list so it is visible, never silently dropped
          out.skipped = 'unit-mapping';
          try { var k = 'nova.sync.skipped', a = JSON.parse(storage.getItem(k) || '[]'); if (!Array.isArray(a)) a = []; if (!a.some(function (x) { return x && x.id === String(sale.id); })) { a.push({ id: String(sale.id), number: String(sale.number || sale.id), reason: 'unit-mapping', at: sale.at }); storage.setItem(k, JSON.stringify(a)); } } catch (e) { /* cosmetic list only */ }
        }
        return out;
      },
      /* ret: the saved return record { id, saleId, lines:[{idx, qty}] }. Local stock movement, and (S2-01) when the sale itself was
         sendable, an explicit 'return' op is queued after it: { id:'ret:<id>', op:'return', clientReturnId, saleInvoiceId, lines }. */
      afterReturn: function (sale, ret) {
        if (!sale || !ret || !ret.id || !Array.isArray(ret.lines)) return { ok: false, error: 'bad-return' };
        var out = { ok: true, movements: 0, queued: false }, retId = String(ret.id), ref = 'return:' + retId, m = Object.create(null), order = [];
        ret.lines.forEach(function (rl) {
          var l = sale.lines && sale.lines[rl.idx], c = ledgerCode(l), q = Number(rl.qty);
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
          if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
            try {
              var raw = storage.getItem('nova.sync.skipped'), list = raw ? JSON.parse(raw) : [];
              if (!Array.isArray(list)) list = [];
              list.push({ id: 'ret:' + retId, saleId: String(sale.id || ''), reason: 'unit-mapping', at: new Date().toISOString() });
              storage.setItem('nova.sync.skipped', JSON.stringify(list));
            } catch (e) { /* cosmetic list only */ }
          }
          return out;
        }
        var pMap = Object.create(null), pOrder = [];
        ret.lines.forEach(function (rl) {
          var l = sale.lines && sale.lines[rl.idx], c = codeOf(l), q = Number(rl.qty), p = l ? Number(l.price) : NaN;
          if (!c || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0) return;
          if (!(c in pMap)) { pMap[c] = { code: c, qty: 0, price: p }; pOrder.push(c); }
          pMap[c].qty += q;
        });
        var pLines = pOrder.map(function (c) { return pMap[c]; });
        if (!pLines.length) { out.ok = false; out.error = 'empty-return-lines'; return out; }
        var payload = { id: 'ret:' + retId, op: 'return', clientReturnId: retId, saleInvoiceId: String(sale.id), lines: pLines };
        try {
          var eq = outbox.enqueue(payload);
          if (eq && eq.ok === false) { out.ok = false; out.error = eq.error || 'enqueue-failed'; }
          else out.queued = true;
        } catch (e) { out.ok = false; out.error = (e && (e.code || e.message)) || 'enqueue-failed'; }
        return out;
      },
      /* S1-04: apply /sync/pull changes from OTHER devices. entity 'sale' data = { saleId, invoiceId, items:[{productId, qty, unitPriceMinor}], discountMinor }.
         Idempotent: a sale already on this device (our own, or applied before) is skipped; stock moves under ref 'sale:<invoiceId>', the same ref
         the selling device used, so a replay never double-counts. deps.hasSale(id) / deps.addSale(record) are the device's local sales list. */
      applyChanges: function (changes) {
        var out = { applied: 0, skipped: 0 };
        (changes || []).forEach(function (c) {
          var d = c && c.data;
          if (!c || c.deleted || !d || !Array.isArray(d.items)) { out.skipped++; return; }
          if (c.entity === 'sale_return') { // S2-01: ref 'return:<clientReturnId>' = the originating device's ref, so it is applied exactly once per device
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
          var lines = [], gross = 0;
          d.items.forEach(function (it) {
            var q = Number(it && it.qty), p = Number(it && it.unitPriceMinor) / 100;
            if (!it || !it.productId || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0) return;
            lines.push({ name: String(it.productId), barcode: String(it.productId), unit: 'box', unitFactor: 1, price: p, qty: q, discount: 0 }); gross += q * p;
          });
          if (!lines.length) { out.skipped++; return; }
          var rec = { id: id, number: 'SYNC-' + id.slice(-6), at: c.changedAt || new Date().toISOString(), status: 'final', payment: 'cash', source: 'SYNC', remoteSaleId: d.saleId || null,
            lines: lines, discount: round2((Number(d.discountMinor) || 0) / 100), total: round2(gross - (Number(d.discountMinor) || 0) / 100) };
          if (!deps.addSale(rec)) { out.skipped++; return; }
          byCode(lines).forEach(function (m) { try { ledger.append({ kind: 'sale', code: m.code, qty: m.qty, ref: 'sale:' + id }); } catch (e) { /* duplicate = already counted */ } });
          out.applied++;
        });
        return out;
      },
      pending: function () {
        try { var a = outbox.all(); return { pending: a.filter(function (e) { return e.status === 'pending'; }).length, review: a.filter(function (e) { return e.status === 'review'; }).length }; }
        catch (e) { return { pending: 0, review: 0 }; }
      }
    };
  }

  /* Pending chip: only when the per-device backend flag is ON (otherwise sync is off and a permanent "waiting" chip would mislead). */
  function chip(api, doc, storage) {
    if (!doc || !doc.body) return;
    var on = false; try { on = storage.getItem('novaBackend.enabled') === 'true'; } catch (e) { on = false; }
    var el = doc.getElementById('novaSyncChip'), p = api.pending();
    if (!on || (!p.pending && !p.review)) { if (el) el.remove(); return; }
    if (!el) {
      el = doc.createElement('div'); el.id = 'novaSyncChip'; el.dir = 'rtl'; el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;bottom:8px;inset-inline-start:8px;z-index:50;background:#1f2937;color:#fff;border-radius:999px;padding:4px 12px;font-size:12px;opacity:.9;pointer-events:none';
      doc.body.appendChild(el);
    }
    el.textContent = p.review ? 'تحتاج مراجعة (' + p.review + ')' : 'في انتظار المزامنة (' + p.pending + ')';
  }

  /* S1-04: one sync cycle = NovaBackendClient.syncAll() (push due outbox entries, then pull) + apply the pulled changes, then clear the feed.
     The client itself makes ZERO calls while novaBackend.enabled is not 'true'; we also skip hidden tabs and offline devices. */
  var SYNC_POLL_MS = 8000;
  function createScheduler(o) {
    var busy = false;
    function tick() {
      if (busy || !o.client.enabled()) return Promise.resolve({ skipped: true });
      if (o.isHidden && o.isHidden()) return Promise.resolve({ skipped: true, hidden: true });
      if (o.isOffline && o.isOffline()) return Promise.resolve({ skipped: true, offline: true });
      busy = true;
      return o.client.syncAll().then(function (r) {
        var applied = { applied: 0, skipped: 0 };
        try { // a throw here must never leave busy=true (that would stop syncing until reload); the feed is kept and retried next cycle
          var f = o.client.feed();
          if (f && f.length) { applied = o.wire.applyChanges(f); try { o.storage.setItem('novaBackend.feed', '[]'); } catch (e) { /* retried next cycle; applyChanges is idempotent */ } }
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
      var wire = create({ outbox: outbox, ledger: root.NovaStockLedger.createLedger(ls, 'nova.stock.ledger'), storage: ls,
        hasSale: function (id) { return !!(root.novaSales && root.novaSales.list().some(function (x) { return x.id === id; })); },
        addSale: function (rec) { return !!(root.novaSales && root.novaSales.add(rec)); } });
      var refresh = function () { try { chip(wire, root.document, ls); } catch (e) { /* cosmetic only */ } };
      var sched = null;
      if (root.NovaBackendClient && typeof root.fetch === 'function') {
        var client = root.NovaBackendClient.createBackendClient({ storage: ls, fetch: root.fetch.bind(root), outbox: outbox,
          getToken: function () { try { return root.sessionStorage.getItem('novaBackend.token'); } catch (e) { return null; } } });
        sched = createScheduler({ client: client, wire: wire, storage: ls, onDone: refresh,
          isHidden: function () { return !!(root.document && root.document.hidden); },
          isOffline: function () { return root.navigator && root.navigator.onLine === false; } });
        var go = function () { sched.tick(); };
        root.setInterval(go, SYNC_POLL_MS);
        root.addEventListener('online', go); root.addEventListener('focus', go);
        if (root.document) root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) go(); });
      }
      root.novaSync = {
        afterSale: function (s) { var r = wire.afterSale(s); refresh(); return r; },
        afterReturn: function (s, r) { return wire.afterReturn(s, r); },
        pending: wire.pending, refresh: refresh, syncNow: function () { return sched ? sched.tick() : Promise.resolve({ skipped: true }); }
      };
      if (root.document && root.document.addEventListener) root.document.addEventListener('DOMContentLoaded', refresh);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
