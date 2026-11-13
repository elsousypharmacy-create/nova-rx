/* NOVA Rx — MSG-04 prescription-to-order review (pure local logic + RTL render; no network, no WhatsApp, no paid AI).
   Flow: private image ref -> MOCK extract (deterministic text parse) -> pharmacist review -> item/alternative match
   -> quote -> customer approval. reserve/pay is allowed ONLY when canReserve(id) is true: approved, with the approved
   total equal to the current quote. Any edit after quoting invalidates the quote and the approval.
   The image itself is never stored here, only an opaque private reference. Works as <script> (window.NovaRxOrderReview) and in Node. */
(function (root) {
  'use strict';
  function err(code) { var e = new Error(code); e.code = code; return e; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function money(n) { return Math.round(n * 100) / 100; }
  var STATUS_AR = { uploaded: 'تم رفع الوصفة', extracted: 'بانتظار مراجعة الصيدلي', reviewed: 'تمت المراجعة', matched: 'تمت المطابقة', quoted: 'بانتظار موافقة العميل', approved: 'وافق العميل', rejected: 'رفض العميل' };

  function create(storage, key, opts) {
    var now = (opts && opts.now) || Date.now;
    function all() { try { var d = JSON.parse(storage.getItem(key)); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; } }
    function save(d) { storage.setItem(key, JSON.stringify(d)); }
    function get(id) { var r = all()[id]; if (!r) throw err('not-found'); return r; }
    function put(r) { var d = all(); d[r.id] = r; save(d); return r; }
    function need(r, statuses) { if (statuses.indexOf(r.status) < 0) throw err('bad-state'); }
    function invalidate(r) { r.quote = null; r.approval = null; }

    function submitImage(x) {
      x = x || {};
      if (!x.id || typeof x.id !== 'string') throw err('id-required');
      if (!/^image\/(jpeg|png|webp)$/.test(String(x.mime))) throw err('bad-image-type');
      if (!x.imageRef || typeof x.imageRef !== 'string' || /^data:/i.test(x.imageRef)) throw err('private-image-ref-required');
      if (all()[x.id]) throw err('duplicate');
      return put({ id: x.id, customer: String(x.customer || ''), imageRef: x.imageRef, status: 'uploaded', items: [], quote: null, approval: null, createdAt: now(), log: [] });
    }
    // MOCK extraction: one item per line "name x qty"; replace with a real reader later. Never a final answer.
    function mockExtract(id, text) {
      var r = get(id); need(r, ['uploaded', 'extracted']);
      r.items = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
        var m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(l);
        return { name: (m ? m[1] : l).trim(), qty: m ? Number(m[2]) : 1, sku: null, price: null, alternativeOf: null };
      });
      r.mock = true; r.status = 'extracted'; invalidate(r); return put(r);
    }
    function pharmacistReview(id, x) {
      x = x || {}; var r = get(id); need(r, ['extracted', 'reviewed', 'matched', 'quoted', 'approved', 'rejected']);
      if (!x.pharmacist || typeof x.pharmacist !== 'string') throw err('pharmacist-required');
      if (!Array.isArray(x.items) || !x.items.length) throw err('items-required');
      r.items = x.items.map(function (i) {
        var q = Number(i.qty);
        if (!i.name || !(q >= 1) || Math.floor(q) !== q) throw err('bad-item');
        return { name: String(i.name), qty: q, sku: null, price: null, alternativeOf: null };
      });
      r.reviewedBy = x.pharmacist; r.mock = false; r.status = 'reviewed'; invalidate(r); return put(r);
    }
    // catalog: [{sku,name,price,stock,ingredient}]. Exact name match first; alternatives share the ingredient and are in stock.
    function matchItems(id, catalog) {
      var r = get(id); need(r, ['reviewed', 'matched', 'quoted']);
      catalog = catalog || [];
      r.items.forEach(function (i) {
        var hit = catalog.filter(function (c) { return norm(c.name) === norm(i.name.replace(/^\[بديل\]\s*/, '')); })[0];
        i.sku = hit ? hit.sku : null; i.price = hit ? Number(hit.price) : null; i.chosenAlt = null; i.outOfStock = null;
        i.alternatives = (hit && hit.stock > 0 ? [] : catalog.filter(function (c) {
          return hit && c.ingredient && c.ingredient === hit.ingredient && c.sku !== hit.sku && c.stock > 0;
        })).map(function (c) { return { sku: c.sku, name: c.name, price: Number(c.price) }; });
        if (hit && !(hit.stock > 0)) { i.sku = null; i.price = null; i.outOfStock = hit.sku; }
      });
      r.status = 'matched'; invalidate(r); return put(r);
    }
    // The pharmacist picks an in-stock alternative for an unavailable item.
    function chooseAlternative(id, index, sku) {
      var r = get(id); need(r, ['matched', 'quoted']); var i = r.items[index];
      var a = i && (i.alternatives || []).filter(function (x) { return x.sku === sku; })[0];
      if (!a) throw err('bad-alternative');
      i.chosenAlt = a.sku; i.sku = a.sku; i.price = a.price; i.alternativeOf = i.outOfStock || null; r.status = 'matched'; invalidate(r); return put(r);
    }
    function makeQuote(id) {
      var r = get(id); need(r, ['matched', 'quoted']);
      if (r.items.some(function (i) { return !i.sku || !(i.price >= 0); })) throw err('unmatched-items');
      var lines = r.items.map(function (i) { return { sku: i.sku, name: i.name, qty: i.qty, price: i.price, alternativeOf: i.alternativeOf }; });
      var total = money(lines.reduce(function (s, l) { return s + l.qty * l.price; }, 0));
      r.quote = { lines: lines, total: total, at: now() }; r.approval = null; r.status = 'quoted'; return put(r);
    }
    function customerApprove(id, x) {
      x = x || {}; var r = get(id); need(r, ['quoted']);
      if (!r.quote) throw err('no-quote');
      if (money(Number(x.approvedTotal)) !== r.quote.total) throw err('quote-mismatch');
      r.approval = { total: r.quote.total, at: now() }; r.status = 'approved'; return put(r);
    }
    function customerReject(id) { var r = get(id); need(r, ['quoted']); r.status = 'rejected'; r.approval = null; return put(r); }
    function canReserve(id) {
      var r = all()[id];
      return !!(r && r.status === 'approved' && r.quote && r.approval && r.approval.total === r.quote.total);
    }
    function render(id) {
      var r = get(id);
      var h = '<section dir="rtl" lang="ar" class="rx-review"><h3>مراجعة الوصفة ' + esc(r.id) + '</h3><p>الحالة: ' + esc(STATUS_AR[r.status]) + '</p>';
      if (r.mock) h += '<p class="warn">قراءة تجريبية — يجب أن يراجعها الصيدلي قبل أي إجراء.</p>';
      h += '<ul>' + r.items.map(function (i) {
        return '<li>' + esc(i.name) + ' × ' + esc(i.qty) + (i.sku ? ' — ' + esc(i.price) + ' ج.م' : '') + (i.outOfStock && !i.chosenAlt ? ' (غير متوفر)' : '') + (i.alternativeOf ? ' (بديل)' : '') + '</li>';
      }).join('') + '</ul>';
      if (r.quote) h += '<p>الإجمالي: ' + esc(r.quote.total) + ' ج.م</p>';
      h += canReserve(id) ? '<p>جاهز للحجز والدفع.</p>' : '<p>لا حجز ولا دفع قبل موافقة العميل.</p>';
      return h + '</section>';
    }
    return { submitImage: submitImage, mockExtract: mockExtract, pharmacistReview: pharmacistReview, matchItems: matchItems, chooseAlternative: chooseAlternative, makeQuote: makeQuote, customerApprove: customerApprove, customerReject: customerReject, canReserve: canReserve, get: get, render: render };
  }
  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaRxOrderReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
