/* NOVA Rx - S1-03: wires a finished POS sale / return into the offline outbox (NovaOutbox) and the on-device stock ledger
   (NovaStockLedger). Pure logic (no DOM except the optional pending chip, no network): it never fetches. The outbox is only
   SENT by NovaBackendClient.syncAll when the per-device flag novaBackend.enabled is on (S1-04), so with the flag OFF there
   are zero network calls and the sale screen behaves exactly as before. Every call is wrapped by the caller in try/catch:
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

  function create(deps) {
    var outbox = deps.outbox, ledger = deps.ledger;

    /* qty per code (a repeated product in one invoice is one movement) */
    function byCode(lines) {
      var m = {}, order = [];
      (lines || []).forEach(function (l) {
        var c = codeOf(l), q = Number(l && l.qty);
        if (!c || !Number.isInteger(q) || q <= 0) return;
        if (!(c in m)) { m[c] = 0; order.push(c); }
        m[c] += q;
      });
      return order.map(function (c) { return { code: c, qty: m[c] }; });
    }

    function invoicePayload(sale) {
      var lines = [], gross = 0;
      (sale.lines || []).forEach(function (l) {
        var c = codeOf(l), q = Number(l.qty), p = Number(l.price);
        if (!c || !Number.isInteger(q) || q <= 0 || !isFinite(p) || p < 0) return;
        lines.push({ code: c, qty: q, price: p }); gross += q * p;
      });
      if (!lines.length) return null;
      var total = Number(sale.total), p = { id: String(sale.id), number: String(sale.number || sale.id), at: sale.at, total: isFinite(total) ? total : round2(gross), lines: lines };
      var d = round2(gross - p.total);
      if (d > 0) p.discount = d;
      return p;
    }

    return {
      /* sale: the saved POS record. Idempotent (outbox by invoice id, ledger by kind+ref+code). */
      afterSale: function (sale) {
        if (!sale || !sale.id || !Array.isArray(sale.lines)) return { ok: false, error: 'bad-sale' };
        var out = { ok: true, movements: 0, queued: false }, ref = 'sale:' + String(sale.number || sale.id);
        byCode(sale.lines).forEach(function (m) {
          try { ledger.append({ kind: 'sale', code: m.code, qty: m.qty, ref: ref }); out.movements++; }
          catch (e) { if (!e || e.code !== 'duplicate-movement') out.ok = false; }
        });
        var p = invoicePayload(sale);
        if (p) { try { outbox.enqueue(p); out.queued = true; } catch (e) { out.ok = false; out.error = e && e.code; } }
        return out;
      },
      /* ret: the saved return record { id, saleId, lines:[{idx, qty}] }. Local stock only. */
      afterReturn: function (sale, ret) {
        if (!sale || !ret || !ret.id || !Array.isArray(ret.lines)) return { ok: false, error: 'bad-return' };
        var out = { ok: true, movements: 0 }, ref = 'return:' + String(ret.id), m = {}, order = [];
        ret.lines.forEach(function (rl) {
          var l = sale.lines && sale.lines[rl.idx], c = codeOf(l), q = Number(rl.qty);
          if (!c || !Number.isInteger(q) || q <= 0) return;
          if (!(c in m)) { m[c] = 0; order.push(c); }
          m[c] += q;
        });
        order.forEach(function (c) {
          try { ledger.append({ kind: 'return', code: c, qty: m[c], ref: ref }); out.movements++; }
          catch (e) { if (!e || e.code !== 'duplicate-movement') out.ok = false; }
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

  var api = { create: create, chip: chip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.NovaOutbox && root.NovaStockLedger) {
    var ls; try { ls = root.localStorage; } catch (e) { ls = null; }
    if (ls) {
      var wire = create({ outbox: root.NovaOutbox.createOutbox(ls, 'nova.outbox'), ledger: root.NovaStockLedger.createLedger(ls, 'nova.stock.ledger') });
      var refresh = function () { try { chip(wire, root.document, ls); } catch (e) { /* cosmetic only */ } };
      root.novaSync = {
        afterSale: function (s) { var r = wire.afterSale(s); refresh(); return r; },
        afterReturn: function (s, r) { return wire.afterReturn(s, r); },
        pending: wire.pending, refresh: refresh
      };
      if (root.document && root.document.addEventListener) root.document.addEventListener('DOMContentLoaded', refresh);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
