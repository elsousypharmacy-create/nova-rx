/* NOVA Rx — emergency sales core (pure logic, no DOM, no network).
   Works as a <script> (window.NovaEmergency) and in Node (module.exports). */
(function (root) {
  'use strict';

  var STATUS = { PENDING: 'pending', SYNCED: 'synced', REVIEW: 'needs-review' };
  var TEMP_LABEL = 'فاتورة مؤقتة — لم تُرحّل للنظام';
  var EMERGENCY_WARNING = 'وضع الطوارئ: فاتورة مؤقتة محفوظة على هذا الجهاز فقط. لم يتم تحصيلها مركزيًا ولا تُحتسب في النظام قبل المزامنة.';
  var DEVICE_KEY = 'novaEmergencyDeviceId', DEFAULT_UNIT = 'علبة';
  var SNAP_KEY = 'novaEmergencySnapshot', DEFAULT_SOURCE = 'STOCK LIVE';
  var MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024; // 4 MB localStorage cap
  var MAX_SNAPSHOT_ITEMS = 20000;
  var STALE_MS = 6 * 3600 * 1000;      // older than 6 h: stale warning
  var OLD_MS = 24 * 3600 * 1000;       // older than 24 h: strong warning

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }

  /* Same normalisation idea as the pharmacy stock search (Apps Script normalizeArabic). */
  function normalizeAr(s) {
    return String(s == null ? '' : s)
      .replace(/[ـً-ْ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/ء/g, '').replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
      .replace(/[^ء-يa-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* Search key: same idea as the pharmacy's stockKey_ (alef dropped so بنادول = بانادول). */
  function keyOf(s) { return normalizeAr(s).replace(/ا/g, ''); }

  /* ---------- snapshot (read-only copy of STOCK LIVE columns) ---------- */
  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  }

  /* Accepts JSON (array or {items, exportedAt, source}) or CSV with headers code,namear,nameen,price,stock,units. */
  function parseSnapshot(text, opts) {
    opts = opts || {};
    var maxBytes = opts.maxBytes || MAX_SNAPSHOT_BYTES, maxItems = opts.maxItems || MAX_SNAPSHOT_ITEMS;
    var rawText = String(text || '');
    if (rawText.length > maxBytes) return { ok: false, code: 'snapshot-too-large', error: 'حجم الملف يتجاوز الحد المسموح للتخزين المحلي' };
    var raw, exportedAt = opts.exportedAt || null, fileSource = null, t = rawText.replace(/^﻿/, '').trim();
    if (!t) return { ok: false, error: 'الملف فاضي' };
    try {
      if (t[0] === '[' || t[0] === '{') {
        var j = JSON.parse(t);
        raw = Array.isArray(j) ? j : j.items;
        if (!Array.isArray(j) && j) {
          if (j.exportedAt && !exportedAt) exportedAt = j.exportedAt;
          if (j.source) fileSource = String(j.source).trim();
        }
      } else {
        var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); });
        var hdr = splitCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
        raw = lines.slice(1).map(function (l) {
          var c = splitCsvLine(l), o = {};
          hdr.forEach(function (h, i) { o[h] = c[i]; });
          return o;
        });
      }
    } catch (e) { return { ok: false, error: 'تعذر قراءة الملف' }; }
    if (!Array.isArray(raw)) return { ok: false, error: 'شكل الملف غير مدعوم' };
    if (raw.length > maxItems) return { ok: false, code: 'too-many-items', error: 'عدد الأصناف يتجاوز الحد المسموح (' + maxItems + ' صنف)' };
    var items = [], skipped = 0;
    raw.forEach(function (r) {
      var code = String(r.code == null ? '' : r.code).replace(/[^\d]/g, '');
      var gtin = String(r.gtin == null ? '' : r.gtin).replace(/[^\d]/g, '');
      var name = String(r.namear || r.name || r.nameen || '').trim();
      var price = num(r.price);
      if ((!code && !gtin) || !name) { skipped++; return; }
      var it = { code: code, gtin: gtin, name: name, nameEn: String(r.nameen || '').trim(),
                 price: isFinite(price) && price > 0 ? round2(price) : null,
                 stock: isFinite(num(r.stock)) ? num(r.stock) : null,
                 units: isFinite(num(r.units)) && num(r.units) >= 1 ? num(r.units) : 1 };
      it.key = keyOf(it.name + ' ' + it.nameEn);
      items.push(it);
    });
    if (!items.length) return { ok: false, error: 'لا توجد أصناف صالحة (لازم code و namear و price)' };
    if (!items.some(function (i) { return i.price != null; })) return { ok: false, error: 'الملف لا يحتوي أسعارًا (عمود price)' };
    var ts = exportedAt ? Date.parse(exportedAt) : NaN;
    var source = String(opts.source || fileSource || DEFAULT_SOURCE).trim() || DEFAULT_SOURCE;
    return { ok: true, items: items, skipped: skipped, source: source, exportedAt: isFinite(ts) ? new Date(ts).toISOString() : null };
  }

  function freshness(sourceTs, now) {
    now = now == null ? Date.now() : now;
    var t = sourceTs ? Date.parse(sourceTs) : NaN;
    if (!isFinite(t)) return { level: 'unknown', stale: true, ageMs: null, label: 'وقت تحديث الأسعار غير معروف — راجع الأسعار قبل البيع' };
    var age = now - t, h = Math.floor(age / 3600000);
    if (age >= OLD_MS) return { level: 'old', stale: true, ageMs: age, label: 'أسعار قديمة (آخر تحديث من ' + Math.floor(age / 86400000 || 1) + ' يوم أو أكثر)' };
    if (age >= STALE_MS) return { level: 'stale', stale: true, ageMs: age, label: 'أسعار متأخرة (آخر تحديث من ' + h + ' ساعة)' };
    return { level: 'ok', stale: false, ageMs: age, label: 'آخر تحديث للأسعار قبل ' + (h < 1 ? 'أقل من ساعة' : h + ' ساعة') };
  }

  /* Never present a stale stock balance as currently available. */
  function stockDisplay(item, sourceTs, now) {
    var ts = sourceTs && typeof sourceTs === 'object' ? sourceTs.exportedAt : sourceTs;
    var f = freshness(ts, now);
    if (!item || item.stock == null || !isFinite(Number(item.stock))) {
      return { availableNow: false, stale: f.stale, stock: null, label: '' };
    }
    if (f.stale) {
      return { availableNow: false, stale: true, stock: null, label: 'الرصيد غير متاح حاليًا (بيانات قديمة — راجع الرف)' };
    }
    var n = Number(item.stock);
    return { availableNow: false, stale: false, stock: n, label: 'رصيد اللقطة وقت التصدير (غير مؤكد حاليًا): ' + n };
  }

  /* Persist and load a dated, source-stamped price snapshot with size limits. */
  function saveSnapshot(storage, parsed, opts) {
    opts = opts || {};
    var key = opts.key || SNAP_KEY;
    var maxBytes = opts.maxBytes || MAX_SNAPSHOT_BYTES, maxItems = opts.maxItems || MAX_SNAPSHOT_ITEMS;
    var now = opts.now == null ? Date.now() : opts.now;
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
      return { ok: false, code: 'empty-snapshot', error: 'لا توجد أصناف للحفظ' };
    }
    if (parsed.items.length > maxItems) {
      return { ok: false, code: 'too-many-items', error: 'عدد الأصناف يتجاوز الحد المسموح (' + maxItems + ' صنف)' };
    }
    var source = String(opts.source || parsed.source || DEFAULT_SOURCE).trim() || DEFAULT_SOURCE;
    var ts = parsed.exportedAt ? Date.parse(parsed.exportedAt) : NaN;
    var exportedAt = isFinite(ts) ? new Date(ts).toISOString() : null;
    var savedAt = new Date(now).toISOString();
    var slim = parsed.items.map(function (i) {
      return { code: i.code, gtin: i.gtin, name: i.name, nameEn: i.nameEn || '', price: i.price, stock: i.stock, units: i.units || 1 };
    });
    var record = { source: source, exportedAt: exportedAt, savedAt: savedAt, importedAt: savedAt, items: slim };
    var raw = JSON.stringify(record);
    if (raw.length > maxBytes) {
      return { ok: false, code: 'snapshot-too-large', error: 'حجم اللقطة يتجاوز الحد المسموح للتخزين المحلي' };
    }
    try {
      storage.setItem(key, raw);
    } catch (e) {
      return { ok: false, code: 'storage-error', error: 'تعذر حفظ اللقطة على هذا الجهاز' };
    }
    var hydrated = slim.map(function (i) {
      var copy = { code: i.code, gtin: i.gtin, name: i.name, nameEn: i.nameEn, price: i.price, stock: i.stock, units: i.units };
      copy.key = keyOf(copy.name + ' ' + copy.nameEn);
      return copy;
    });
    return { ok: true, bytes: raw.length, snapshot: { source: source, exportedAt: exportedAt, savedAt: savedAt, importedAt: savedAt, items: hydrated } };
  }

  function loadSnapshot(storage, key) {
    key = key || SNAP_KEY;
    try {
      var s = JSON.parse(storage.getItem(key) || 'null');
      if (!s || !Array.isArray(s.items) || !s.items.length) return null;
      s.items.forEach(function (i) { i.key = keyOf(i.name + ' ' + (i.nameEn || '')); });
      s.source = String(s.source || DEFAULT_SOURCE).trim() || DEFAULT_SOURCE;
      s.exportedAt = s.exportedAt || null;
      s.savedAt = s.savedAt || s.importedAt || null;
      s.importedAt = s.importedAt || s.savedAt || null;
      return s;
    } catch (e) { return null; }
  }

  function searchItems(items, query, limit) {
    limit = limit || 25;
    var q = String(query || '').trim();
    if (q.length < 2) return [];
    var digits = q.replace(/[^\d]/g, '');
    if (digits.length >= 6 && digits.length === q.replace(/\s/g, '').length) {
      var exact = items.filter(function (i) { return i.code === digits || i.gtin === digits || i.code === digits.replace(/^0+/, ''); });
      if (exact.length) return exact.slice(0, limit);
    }
    var words = keyOf(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    var scored = [];
    for (var n = 0; n < items.length; n++) {
      var it = items[n], k = it.key, ok = true, s = 0;
      for (var w = 0; w < words.length; w++) {
        var p = k.indexOf(words[w]);
        if (p < 0) { ok = false; break; }
        s += p === 0 || k.charAt(p - 1) === ' ' ? 0 : 1;
      }
      if (ok) scored.push({ it: it, s: s + k.length / 1000 });
    }
    scored.sort(function (a, b) { return a.s - b.s; });
    return scored.slice(0, limit).map(function (x) { return x.it; });
  }

  /* ---------- basket ---------- */
  function emptyBasket() { return { lines: [], discount: 0, discountBy: '', discountReason: '' }; }

  function addLine(basket, item, qty) {
    if (!item || item.price == null) throw new Error('no-price');
    qty = Math.floor(qty || 1);
    if (!(qty >= 1)) qty = 1;
    var k = item.code || item.gtin, ex = basket.lines.filter(function (l) { return l.code === k; })[0];
    if (ex) ex.qty = Math.min(999, ex.qty + qty);
    else basket.lines.push({ code: k, name: item.name, unitPrice: item.price, unit: DEFAULT_UNIT, qty: Math.min(999, qty) });
    return basket;
  }
  function setQty(basket, code, qty) {
    var l = basket.lines.filter(function (x) { return x.code === code; })[0];
    if (!l) return basket;
    qty = Math.floor(qty);
    if (!(qty >= 1)) qty = 1;
    l.qty = Math.min(999, qty); return basket;
  }
  function removeLine(basket, code) { basket.lines = basket.lines.filter(function (l) { return l.code !== code; }); return basket; }

  function totals(basket) {
    var sub = 0;
    basket.lines.forEach(function (l) { sub += round2(l.unitPrice * l.qty); });
    sub = round2(sub);
    var d = Number(basket.discount) || 0;
    if (d < 0) d = 0;
    if (d > sub) d = sub;
    return { subtotal: sub, discount: round2(d), total: round2(sub - d) };
  }
  /* A discount only counts when someone authorises it by name. */
  function discountProblem(basket) {
    var d = Number(basket.discount) || 0;
    if (!d) return null;
    if (d < 0) return 'الخصم لا يكون سالبًا';
    if (!String(basket.discountBy || '').trim()) return 'الخصم يحتاج اسم من اعتمده';
    if (d > totals({ lines: basket.lines, discount: 0 }).subtotal) return 'الخصم أكبر من الإجمالي';
    return null;
  }

  /* ---------- temporary invoice ---------- */
  function uuid4(rand) {
    var b = []; for (var i = 0; i < 16; i++) b.push(Math.floor((rand ? rand() : Math.random()) * 256));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = b.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function readableRef(id, now) {
    var d = new Date(now);
    var ymd = d.getUTCFullYear().toString().slice(2) + ('0' + (d.getUTCMonth() + 1)).slice(-2) + ('0' + d.getUTCDate()).slice(-2);
    return 'EMG-' + ymd + '-' + id.replace(/-/g, '').slice(0, 5).toUpperCase();
  }

  /* Stable per-device id, created once and kept in local storage (in-memory fallback if storage fails). */
  function getDeviceId(storage, rand) {
    var id = null;
    try { id = storage.getItem(DEVICE_KEY); } catch (e) {}
    if (!id) { id = 'DEV-' + uuid4(rand).slice(0, 8).toUpperCase(); try { storage.setItem(DEVICE_KEY, id); } catch (e) {} }
    return id;
  }

  function createInvoice(opts) {
    var b = opts.basket, staff = String(opts.staff || '').trim(), now = opts.now == null ? Date.now() : opts.now;
    if (!staff) throw new Error('staff-required');
    var deviceId = String(opts.deviceId || '').trim();
    if (!deviceId) throw new Error('device-required');
    if (!b.lines.length) throw new Error('empty-basket');
    var dp = discountProblem(b); if (dp) throw new Error(dp);
    var t = totals(b), id = opts.id || uuid4();
    var inv = {
      id: id, ref: readableRef(id, now), kind: 'temporary-invoice', label: TEMP_LABEL,
      emergencyMode: true, warning: EMERGENCY_WARNING, deviceId: deviceId, centralCollection: false,
      createdAt: new Date(now).toISOString(), createdBy: staff,
      priceSource: { type: 'snapshot', source: String(opts.source || DEFAULT_SOURCE).trim() || DEFAULT_SOURCE, exportedAt: opts.sourceExportedAt || null },
      customer: opts.customer ? String(opts.customer).trim() : '',
      lines: b.lines.map(function (l) { return Object.freeze({ code: l.code, name: l.name, qty: l.qty, unit: l.unit || DEFAULT_UNIT, unitPrice: l.unitPrice, lineTotal: round2(l.unitPrice * l.qty) }); }),
      subtotal: t.subtotal, discount: t.discount,
      discountBy: t.discount ? String(b.discountBy).trim() : '', discountReason: t.discount ? String(b.discountReason || '').trim() : '',
      total: t.total, status: STATUS.PENDING, audit: [{ at: new Date(now).toISOString(), by: staff, action: 'created' }]
    };
    Object.freeze(inv.lines);
    return inv;
  }

  /* ---------- queue (pending / synced / needs-review), storage = localStorage-like ---------- */
  function createQueue(storage, key) {
    key = key || 'novaEmergencyQueue';
    function read() { try { var v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function write(a) { storage.setItem(key, JSON.stringify(a)); }
    return {
      list: read,
      get: function (id) { return read().filter(function (i) { return i.id === id; })[0] || null; },
      add: function (inv) {
        var a = read();
        if (a.some(function (i) { return i.id === inv.id; })) return false;   // never store the same invoice twice
        a.push(JSON.parse(JSON.stringify(inv))); write(a); return true;
      },
      /* Human-reviewed status change. 'synced' is terminal and idempotent: a second call changes nothing. */
      mark: function (id, status, by, note, now) {
        if (!by || !String(by).trim()) throw new Error('reviewer-required');
        if ([STATUS.PENDING, STATUS.SYNCED, STATUS.REVIEW].indexOf(status) < 0) throw new Error('bad-status');
        var a = read(), i = a.filter(function (x) { return x.id === id; })[0];
        if (!i) throw new Error('not-found');
        if (i.status === STATUS.SYNCED) return { changed: false, duplicate: true, invoice: i };
        i.status = status;
        i.audit.push({ at: new Date(now == null ? Date.now() : now).toISOString(), by: String(by).trim(), action: status, note: note || '' });
        write(a); return { changed: true, duplicate: false, invoice: i };
      },
      counts: function () {
        var c = { pending: 0, synced: 0, 'needs-review': 0 };
        read().forEach(function (i) { c[i.status] = (c[i.status] || 0) + 1; }); return c;
      },
      /* Export for the owner-approved import into the main POS. Pending and needs-review only; stable externalId. */
      exportForImport: function () {
        return JSON.stringify({ format: 'nova-emergency-v1', exportedAt: new Date().toISOString(),
          invoices: read().filter(function (i) { return i.status !== STATUS.SYNCED; }).map(function (i) {
            return { externalId: i.id, ref: i.ref, createdAt: i.createdAt, createdBy: i.createdBy, lines: i.lines, discount: i.discount,
                     discountBy: i.discountBy, total: i.total, status: i.status };
          }) }, null, 2);
      }
    };
  }

  /* Compare a temporary invoice with the current snapshot; never changes anything. */
  function detectConflicts(inv, items) {
    var by = {}; items.forEach(function (i) { by[i.code || i.gtin] = i; });
    var out = [];
    inv.lines.forEach(function (l) {
      var cur = by[l.code];
      if (!cur) out.push({ code: l.code, type: 'missing', name: l.name });
      else {
        if (cur.price != null && Math.abs(cur.price - l.unitPrice) > 0.005) out.push({ code: l.code, type: 'price-changed', name: l.name, was: l.unitPrice, now: cur.price });
        if (cur.stock != null && cur.stock < l.qty) out.push({ code: l.code, type: 'stock-low', name: l.name, qty: l.qty, stock: cur.stock });
      }
    });
    return out;
  }

  /* ---------- draft autosave ---------- */
  var DRAFT_KEY = 'novaEmergencyDraft';
  function saveDraft(storage, draft) { try { storage.setItem(DRAFT_KEY, JSON.stringify(draft)); return true; } catch (e) { return false; } }
  function loadDraft(storage) { try { var d = JSON.parse(storage.getItem(DRAFT_KEY) || 'null'); return d && d.basket && Array.isArray(d.basket.lines) ? d : null; } catch (e) { return null; } }
  function clearDraft(storage) { try { storage.removeItem(DRAFT_KEY); } catch (e) {} }

  /* ---------- PDF: pages are JPEG images (the browser shapes the Arabic); this only packs them ---------- */
  function buildPdf(pages) {
    var enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    var chunks = [], offsets = [], len = 0;
    function push(x) { var u = typeof x === 'string' ? enc(x) : x; chunks.push(u); len += u.length; }
    function obj(n, body) { offsets[n] = len; push(n + ' 0 obj\n'); push(body); push('\nendobj\n'); }
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var nPages = pages.length, kids = [];
    // objects: 1 catalog, 2 pages, then per page: page, content, image
    for (var p = 0; p < nPages; p++) kids.push((3 + p * 3) + ' 0 R');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPages + ' >>');
    pages.forEach(function (pg, i) {
      var base = 3 + i * 3, W = pg.pdfW || 595, H = pg.pdfH || Math.round(W * pg.h / pg.w);
      obj(base, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (base + 2) + ' 0 R >> >> /Contents ' + (base + 1) + ' 0 R >>');
      var c = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      obj(base + 1, '<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream');
      offsets[base + 2] = len;
      push((base + 2) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpeg.length + ' >>\nstream\n');
      push(pg.jpeg); push('\nendstream\nendobj\n');
    });
    var total = 3 + nPages * 3, xref = len;
    push('xref\n0 ' + total + '\n0000000000 65535 f \n');
    for (var n = 1; n < total; n++) push(('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n');
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(len), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }

  /* Split lines into pages (first page has the header, so fewer rows). */
  function paginate(lines, firstCap, otherCap) {
    firstCap = firstCap || 12; otherCap = otherCap || 18;
    var pages = [], i = 0;
    pages.push(lines.slice(0, firstCap)); i = firstCap;
    while (i < lines.length) { pages.push(lines.slice(i, i + otherCap)); i += otherCap; }
    return pages;
  }

  var api = { STATUS: STATUS, TEMP_LABEL: TEMP_LABEL, EMERGENCY_WARNING: EMERGENCY_WARNING, SNAP_KEY: SNAP_KEY, DEFAULT_SOURCE: DEFAULT_SOURCE,
    MAX_SNAPSHOT_BYTES: MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_ITEMS: MAX_SNAPSHOT_ITEMS, getDeviceId: getDeviceId, STALE_MS: STALE_MS, OLD_MS: OLD_MS, round2: round2, normalizeAr: normalizeAr, keyOf: keyOf,
    parseSnapshot: parseSnapshot, freshness: freshness, stockDisplay: stockDisplay, saveSnapshot: saveSnapshot, loadSnapshot: loadSnapshot,
    searchItems: searchItems, emptyBasket: emptyBasket, addLine: addLine,
    setQty: setQty, removeLine: removeLine, totals: totals, discountProblem: discountProblem, uuid4: uuid4, createInvoice: createInvoice,
    createQueue: createQueue, detectConflicts: detectConflicts, saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
    buildPdf: buildPdf, paginate: paginate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaEmergency = api;
})(typeof window !== 'undefined' ? window : globalThis);
