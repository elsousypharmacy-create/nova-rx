/* NOVA Rx — CRM-05 customer service history (no DOM, no network, no backend).
   - createIndex(customers): normalized (Arabic-aware) search index built ONCE; search() is a bounded scan with a result limit, so the sale screen never waits on it.
   - history(): one customer's timeline from visits + invoices + cases, newest first.
   - Cases: complaint / return, persisted in caller-supplied storage; a return is tied to an invoice and can never exceed what is still unreturned.
   - retention()/averageOrder(): a VISIT (a person came in; may have 0..n invoices) and an INVOICE (money document) are separate counts: AOV = net invoice money / invoices; retention uses distinct visit ids.
   Money is integer cents. Works as <script> (window.NovaCustomerService) and in Node (module.exports). */
(function (root) {
  'use strict';
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); })
      .replace(/\s+/g, ' ').trim();
  }
  function createIndex(customers) {
    var rows = (customers || []).map(function (c) { return { c: c, k: norm((c.name || '') + ' ' + (c.phone || '') + ' ' + (c.id || '')) }; });
    return {
      size: rows.length,
      search: function (q, limit) {
        var terms = norm(q).split(' ').filter(Boolean), max = limit || 20, out = [];
        if (!terms.length) return out;
        for (var i = 0; i < rows.length && out.length < max; i++) {
          var ok = true; for (var j = 0; j < terms.length; j++) if (rows[i].k.indexOf(terms[j]) < 0) { ok = false; break; }
          if (ok) out.push(rows[i].c);
        }
        return out;
      }
    };
  }
  function history(customerId, d) {
    var ev = [];
    (d.visits || []).forEach(function (v) { if (v.customerId === customerId) ev.push({ type: 'visit', at: v.at, id: v.id }); });
    (d.invoices || []).forEach(function (i) { if (i.customerId === customerId) ev.push({ type: 'invoice', at: i.at, id: i.id, visitId: i.visitId || null, netCents: i.netCents }); });
    (d.cases || []).forEach(function (c) { if (c.customerId === customerId) ev.push({ type: c.type, at: c.at, id: c.id, invoiceId: c.invoiceId || null, status: c.status }); });
    return ev.sort(function (a, b) { return b.at - a.at; });
  }
  /* Visits are counted by distinct id: two invoices in one visit = 1 visit; a visit with no invoice still counts. An invoice with no visitId is NOT promoted to a visit. */
  function visitsOf(visits, from, to) {
    var seen = {}, n = 0;
    (visits || []).forEach(function (v) { if (v.at >= from && v.at < to && !seen[v.id]) { seen[v.id] = 1; n++; } });
    return n;
  }
  function netCents(inv, returnedByInvoice) { return inv.netCents - (returnedByInvoice[inv.id] || 0); }
  function returnedMap(cases) {
    var m = {};
    (cases || []).forEach(function (c) { if (c.type === 'return' && c.status !== 'rejected' && c.invoiceId) m[c.invoiceId] = (m[c.invoiceId] || 0) + c.amountCents; });
    return m;
  }
  function averageOrder(d, from, to) {
    var rm = returnedMap(d.cases), n = 0, sum = 0;
    (d.invoices || []).forEach(function (i) { if (i.at >= from && i.at < to) { n++; sum += netCents(i, rm); } });
    return { invoices: n, visits: visitsOf(d.visits, from, to), netCents: sum, averageCents: n ? Math.round(sum / n) : 0 };
  }
  /* Retention: of customers with a visit in the previous window, the share who visited again in the current window. */
  function retention(d, prevFrom, curFrom, curTo) {
    var prev = {}, cur = {}, base = 0, kept = 0;
    (d.visits || []).forEach(function (v) {
      if (v.at >= prevFrom && v.at < curFrom) prev[v.customerId] = 1;
      else if (v.at >= curFrom && v.at < curTo) cur[v.customerId] = 1;
    });
    Object.keys(prev).forEach(function (id) { base++; if (cur[id]) kept++; });
    return { base: base, retained: kept, rate: base ? kept / base : 0 };
  }
  /* opts: { now(): ms, invoices(): [{id,netCents}] lookup for return validation } */
  function createCases(storage, key, o) {
    o = o || {}; var KEYN = key || 'nova.cases', now = o.now || Date.now;
    function load() { var r = storage.getItem(KEYN); if (!r) return []; try { var a = JSON.parse(r); if (Array.isArray(a)) return a; } catch (e) {} fail('cases-corrupt'); }
    function save(a) { try { storage.setItem(KEYN, JSON.stringify(a)); } catch (e) { fail('cases-write-failed'); } }
    function open(c) {
      if (!c || !c.id || !c.customerId) fail('missing-fields');
      if (c.type !== 'complaint' && c.type !== 'return') fail('bad-type');
      var a = load(), ex = a.filter(function (x) { return x.id === c.id; })[0]; if (ex) return ex;
      var rec = { id: c.id, customerId: c.customerId, type: c.type, at: now(), status: 'open', note: String(c.note || '') };
      if (c.type === 'return') {
        var inv = (o.invoices ? o.invoices() : []).filter(function (i) { return i.id === c.invoiceId; })[0];
        if (!inv) fail('unknown-invoice');
        if (inv.customerId && inv.customerId !== c.customerId) fail('invoice-customer-mismatch');
        var amt = c.amountCents; if (!(amt > 0) || Math.floor(amt) !== amt) fail('bad-amount');
        if (amt > inv.netCents - (returnedMap(a)[inv.id] || 0)) fail('return-exceeds-invoice');
        rec.invoiceId = inv.id; rec.amountCents = amt;
      } else if (c.invoiceId) rec.invoiceId = c.invoiceId;
      a.push(rec); save(a); return rec;
    }
    function resolve(id, status, note) {
      if (['resolved', 'rejected'].indexOf(status) < 0) fail('bad-status');
      var a = load(), r = a.filter(function (x) { return x.id === id; })[0]; if (!r) fail('unknown-case');
      if (r.status !== 'open') return r;
      r.status = status; r.resolvedAt = now(); if (note) r.resolution = String(note); save(a); return r;
    }
    return { open: open, resolve: resolve, list: load };
  }
  var api = { norm: norm, createIndex: createIndex, history: history, averageOrder: averageOrder, retention: retention, createCases: createCases };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaCustomerService = api;
})(typeof window !== 'undefined' ? window : globalThis);
