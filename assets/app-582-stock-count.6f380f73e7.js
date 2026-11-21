/* #41 Stock count (الجرد) — blind, partial (shelf by shelf), while sales continue, phone-first. Lazy screen (app/548 loads it on the products page).
   Data (this device): localStorage 'nova-rx-stock-count-v1' = [{ id:'CNT-<ts>', startedAt, by, closedAt, lockedAt, plan, summary, products:[], lines:[] }] (last 50).
   - Blind: the expected quantity (expectedAtScan) is never rendered while counting. Opening the differences review LOCKS the counts
     (lockedAt), so the counter cannot see the expected numbers and then go back and edit.
   - Delta rule: applied delta = counted - expectedAtScan, where expectedAtScan = the lot's onHand at the moment the count was typed
     (refreshed on every setCount). Sales after that moment are already deducted by the app, so applying the same delta keeps them.
   - Close is idempotent and crash-safe: the first attempt freezes a plan in the session (shortages, surpluses, reasons); every retry
     replays the SAME plan. Shortages go through novaItemCard.adjust (idempotent by id '<session>-out'); surpluses go through
     novaStock.addLot with receiptRef 'COUNT-<session>/<line index>' (idempotent by ref). closedAt is written last.
   - Closing needs permission 'stock.adjust' (fails closed: a throw or a false result both deny). Counting is open to everyone. */
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-stock-count-v1';
  var MAX_SESSIONS = 50;
  var CARD_ID = 'novaStockCount';
  var OVERLAY_ID = 'novaStockCountOverlay';
  var STYLE_ID = 'novaStockCountStyle';
  var CANCEL_DLG_ID = 'novaStockCountCancelDlg';
  var ADJUST_REASON = 'فقد / سرقة';
  var OTHER_REASON = 'تانية';

  var REASON_OPTIONS = [
    { ar: 'فقد / سرقة', en: 'Loss / theft' },
    { ar: 'تالف أو كسر', en: 'Damaged / broken' },
    { ar: 'خطأ استلام سابق', en: 'Earlier receiving error' },
    { ar: OTHER_REASON, en: 'Other' }
  ];

  var STRINGS = {
    ar: {
      title: 'الجرد',
      startNew: 'ابدأ جرد جديد',
      continueCount: 'كمّل الجرد',
      toReview: 'مراجعة الفروق',
      openSession: 'جرد مفتوح من',
      reports: 'تقارير الجرد',
      noReports: 'مفيش جرد متقفل لسه',
      searchPh: 'اكتب اسم الصنف أو امسح الباركود',
      add: 'إضافة',
      lot: 'التشغيلة',
      expiry: 'الصلاحية',
      count: 'العدد',
      unknownLotBtn: 'تشغيلة مش موجودة',
      lotPh: 'رقم التشغيلة',
      expPh: 'الصلاحية شهر/سنة',
      progress: 'اتعدّ {n} صنف / {m} تشغيلة',
      saveLater: 'حفظ ومتابعة بعدين',
      finish: 'إنهاء الجرد',
      reviewTitle: 'مراجعة الفروق',
      item: 'الصنف',
      expected: 'المتوقع',
      counted: 'المعدود',
      diff: 'الفرق',
      reason: 'السبب',
      notePh: 'اكتب السبب',
      confirm: 'تأكيد التسوية',
      later: 'بعدين',
      close: 'إغلاق',
      itemsCount: 'الأصناف',
      costDiff: 'فرق التكلفة',
      summaryFmt: 'فرق التكلفة: {net} ج.م (نقص {short} / زيادة {surp})',
      errUncounted: 'لازم تعدّ كل التشغيلات اللي ضفتها قبل الإنهاء.',
      errEmpty: 'لسه ما ضفتش أصناف للجرد.',
      errReason: 'اختار سبب لكل فرق، ولو «تانية» اكتب السبب.',
      errNoPerm: 'محتاج صلاحية تعديل المخزون عشان تقفل الجرد.',
      errNotFound: 'الصنف مش موجود.',
      errBadUnknown: 'اكتب رقم التشغيلة وصلاحية صحيحة (شهر/سنة) والعدد.',
      errBadCount: 'العدد لازم يكون رقم صحيح من صفر وطالع.',
      errNoLots: 'الصنف ده مالوش تشغيلات بكمية في السيستم — ضيف «تشغيلة مش موجودة».',
      errNoSession: 'مفيش جرد مفتوح.',
      errLocked: 'العدد اتقفل للمراجعة — مش هينفع يتعدل.',
      errLotMissing: 'التشغيلة دي مش في الجرد.',
      errStock: 'المخزون ما اتحفظش — جرّب تاني.',
      errAdjust: 'تسوية النقص مش متاحة دلوقتي — جرّب تاني.',
      errSave: 'الجرد ما اتحفظش على الجهاز.',
      okSaved: 'التسوية اتسجلت والجرد اتقفل.',
      cancelCount: 'إلغاء الجرد',
      cancelTitle: 'إلغاء الجرد',
      cancelHint: 'مفيش أي حركة مخزون هتتعمل. اكتب سبب الإلغاء.',
      cancelReasonPh: 'سبب الإلغاء (مطلوب)',
      cancelConfirm: 'تأكيد الإلغاء',
      cancelBack: 'رجوع',
      cancelledBadge: 'ملغي',
      cancelledInfo: 'الجرد ده اتلغى — السبب: {reason}',
      cappedNote: 'اتخصم المتاح بس',
      errCancelReason: 'اكتب سبب إلغاء الجرد.',
      errNoPermCancel: 'محتاج صلاحية تعديل المخزون عشان تلغي الجرد.',
      errPartial: 'الجرد اتطبق جزء منه — كمّل الإغلاق',
      okCancelled: 'الجرد اتلغى.'
    },
    en: {
      title: 'Stock count',
      startNew: 'Start a new count',
      continueCount: 'Continue the count',
      toReview: 'Review differences',
      openSession: 'Count open since',
      reports: 'Count reports',
      noReports: 'No closed counts yet',
      searchPh: 'Type an item name or scan the barcode',
      add: 'Add',
      lot: 'Lot',
      expiry: 'Expiry',
      count: 'Count',
      unknownLotBtn: 'Lot not in the system',
      lotPh: 'Lot number',
      expPh: 'Expiry MM/YY',
      progress: 'Counted {n} items / {m} lots',
      saveLater: 'Save and continue later',
      finish: 'Finish the count',
      reviewTitle: 'Review differences',
      item: 'Item',
      expected: 'Expected',
      counted: 'Counted',
      diff: 'Diff',
      reason: 'Reason',
      notePh: 'Type the reason',
      confirm: 'Confirm adjustment',
      later: 'Later',
      close: 'Close',
      itemsCount: 'Items',
      costDiff: 'Cost diff',
      summaryFmt: 'Cost difference: {net} EGP (shortage {short} / surplus {surp})',
      errUncounted: 'Count every lot you added before finishing.',
      errEmpty: 'No items were added to this count yet.',
      errReason: 'Pick a reason for every difference; for "Other" type the reason.',
      errNoPerm: 'You need the stock adjustment permission to close the count.',
      errNotFound: 'Item not found.',
      errBadUnknown: 'Type the lot number, a valid expiry (MM/YY) and the count.',
      errBadCount: 'The count must be a whole number, zero or more.',
      errNoLots: 'This item has no lots with stock in the system — add a "Lot not in the system".',
      errNoSession: 'No open count.',
      errLocked: 'The counts are locked for review and cannot be edited.',
      errLotMissing: 'This lot is not in the count.',
      errStock: 'The stock was not saved — try again.',
      errAdjust: 'The shortage adjustment is not available right now — try again.',
      errSave: 'The count was not saved on this device.',
      okSaved: 'Adjustment recorded and the count is closed.',
      cancelCount: 'Cancel count',
      cancelTitle: 'Cancel the count',
      cancelHint: 'No stock movement will be made. Type the reason for cancelling.',
      cancelReasonPh: 'Cancellation reason (required)',
      cancelConfirm: 'Confirm cancel',
      cancelBack: 'Back',
      cancelledBadge: 'Cancelled',
      cancelledInfo: 'This count was cancelled - reason: {reason}',
      cappedNote: 'Only the available stock was deducted',
      errCancelReason: 'Type the reason for cancelling the count.',
      errNoPermCancel: 'You need the stock adjustment permission to cancel the count.',
      errPartial: 'Part of this count was already applied - finish closing it.',
      okCancelled: 'The count was cancelled.'
    }
  };

  function isEn() { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } }
  function t(key, vars) {
    var str = (STRINGS[isEn() ? 'en' : 'ar'][key]) || STRINGS.ar[key] || key;
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) str = str.split('{' + k + '}').join(String(vars[k]));
    return str;
  }
  function fail(key, vars) { var e = new Error(t(key, vars)); e.code = key; return e; }
  function toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success'); }
  function nowIso() { return new Date().toISOString(); }
  function r2(n) { return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100; }
  function clean(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }
  // Arabic-Indic / Persian digits from phone keyboards -> ASCII
  function digits(s) {
    return String(s == null ? '' : s).replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); }).trim();
  }
  function parseCount(v) {
    var s = digits(v);
    if (!/^\d+$/.test(s)) return null;
    return parseInt(s, 10);
  }

  function currentUserName() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        return (u && u.name) ? String(u.name) : '';
      }
    } catch (e) {}
    return '';
  }

  function loadSessions() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter(function (s) { return s && s.id && Array.isArray(s.lines); }) : [];
    } catch (e) { return []; }
  }
  function saveSessions(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS))); return true; }
    catch (e) { return false; }
  }
  function mustSave(list) { if (!saveSessions(list)) throw fail('errSave'); }
  function findSession(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function findOpenSession(list) { for (var i = 0; i < list.length; i++) if (!list[i].closedAt && !list[i].cancelledAt) return list[i]; return null; }
  function editable(list, id) {
    var s = findSession(list, id);
    if (!s || s.closedAt || s.cancelledAt) throw fail('errNoSession');
    if (s.lockedAt || s.plan) throw fail('errLocked');
    return s;
  }

  function keyOfProduct(p) {
    if (window.novaStock && typeof window.novaStock.keyOf === 'function') return window.novaStock.keyOf(p);
    return String((p && (p.key || p.barcode || p.name)) || '');
  }
  function findProductByKey(key) {
    var products = (window.NOVA_DEMO && window.NOVA_DEMO.products) || [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      if (keyOfProduct(p) === String(key) || String(p.barcode) === String(key) || String(p.id) === String(key)) return p;
    }
    return null;
  }
  function systemLots(key) {
    try { return (window.novaStock && typeof window.novaStock.lots === 'function') ? (window.novaStock.lots(key) || []) : []; }
    catch (e) { return []; }
  }
  function systemLot(key, lot, expiry) {
    var L = systemLots(key);
    for (var i = 0; i < L.length; i++) if (L[i].lot === lot && L[i].expiry === expiry) return L[i];
    return null;
  }
  function defaultCost(key) {
    var L = systemLots(key);
    for (var i = 0; i < L.length; i++) if (Number(L[i].cost) > 0) return Number(L[i].cost);
    return 0;
  }

  // 'MM/YY', 'MM/YYYY', 'MM-YY' or 'YYYY-MM-DD' -> 'YYYY-MM-DD' (last day of the month)
  function parseExpiry(input) {
    var s = digits(input);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isNaN(Date.parse(s + 'T00:00:00Z')) ? null : s;
    var m = /^(\d{1,2})\s*[\/\-.]\s*(\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    var mm = parseInt(m[1], 10), yy = parseInt(m[2], 10);
    if (mm < 1 || mm > 12) return null;
    if (yy < 100) yy += 2000;
    var last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return yy + '-' + (mm < 10 ? '0' : '') + mm + '-' + last;
  }
  function shortExpiry(iso) { var m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); return m ? m[2] + '/' + m[1].slice(2) : String(iso || ''); }
  function lineId(key, lot, expiry) { return key + '|' + lot + '|' + (expiry || ''); }

  function ensureProduct(sess, key, product) {
    if (!sess.products) sess.products = [];
    for (var i = 0; i < sess.products.length; i++) if (sess.products[i].key === key) return;
    sess.products.push({ key: key, code: product ? String(product.barcode || product.id || '') : '', name: product ? String(product.name || key) : key });
  }

  // ---- Core API ----

  function start() {
    var list = loadSessions();
    var open = findOpenSession(list);
    if (open) return open;
    var sess = { id: 'CNT-' + Date.now(), startedAt: nowIso(), by: currentUserName(), closedAt: null, lockedAt: null, plan: null, summary: null, products: [], lines: [] };
    list.unshift(sess);
    mustSave(list);
    refreshCard();
    return sess;
  }

  function addProduct(key, sessionId) {
    if (!sessionId) { var o = findOpenSession(loadSessions()); sessionId = o ? o.id : start().id; }
    var list = loadSessions();
    var sess = editable(list, sessionId);
    var product = findProductByKey(key);
    if (!product) throw fail('errNotFound');
    var pKey = keyOfProduct(product);
    ensureProduct(sess, pKey, product);
    var added = [];
    var L = systemLots(pKey);
    for (var i = 0; i < L.length; i++) {
      var l = L[i];
      if (!(Number(l.onHand) > 1e-7)) continue; // sold-out lots are not listed; a physical one is added as an unknown lot
      var lot = String(l.lot || ''), exp = String(l.expiry || ''), found = null;
      for (var j = 0; j < sess.lines.length; j++) {
        var ln = sess.lines[j];
        if (ln.key === pKey && ln.lot === lot && ln.expiry === exp) { found = ln; break; }
      }
      if (!found) {
        found = { key: pKey, code: String(product.barcode || product.id || ''), name: String(product.name || pKey), lot: lot, expiry: exp,
          cost: Number(l.cost) || 0, expectedAtScan: clean(l.onHand), counted: null, at: nowIso(), unknown: false };
        sess.lines.push(found);
      }
      added.push(found);
    }
    mustSave(list);
    return added;
  }

  function setCount(sessionId, key, lot, expiry, qty) {
    var list = loadSessions();
    var sess = editable(list, sessionId);
    var parsed = (qty === null || qty === undefined || digits(qty) === '') ? null : parseCount(qty);
    if (parsed === null && !(qty === null || qty === undefined || digits(qty) === '')) throw fail('errBadCount');
    var target = null;
    for (var i = 0; i < sess.lines.length; i++) {
      var ln = sess.lines[i];
      if (ln.key === key && ln.lot === String(lot) && (!expiry || ln.expiry === String(expiry))) { target = ln; break; }
    }
    if (!target) throw fail('errLotMissing');
    target.counted = parsed;
    target.at = nowIso();
    // the shelf was counted NOW: take the system quantity at this same moment (sales until now are already in it)
    var sl = systemLot(target.key, target.lot, target.expiry);
    target.expectedAtScan = sl ? clean(sl.onHand) : 0;
    mustSave(list);
    return { key: target.key, lot: target.lot, expiry: target.expiry, counted: target.counted };
  }

  function addUnknownLot(sessionId, key, lot, expiry, qty) {
    var list = loadSessions();
    var sess = editable(list, sessionId);
    var lotStr = digits(lot), expNorm = parseExpiry(expiry), parsed = parseCount(qty);
    if (!lotStr || !expNorm || parsed === null) throw fail('errBadUnknown');
    var product = findProductByKey(key);
    var pKey = product ? keyOfProduct(product) : String(key);
    ensureProduct(sess, pKey, product);
    var row = null;
    for (var i = 0; i < sess.lines.length; i++) {
      var ln = sess.lines[i];
      if (ln.key === pKey && ln.lot === lotStr && ln.expiry === expNorm) { row = ln; break; }
    }
    if (!row) {
      row = { key: pKey, code: product ? String(product.barcode || product.id || '') : '', name: product ? String(product.name || pKey) : pKey,
        lot: lotStr, expiry: expNorm, cost: defaultCost(pKey), expectedAtScan: 0, counted: null, at: nowIso(), unknown: true };
      sess.lines.push(row);
    }
    // a lot the system already knows (e.g. sold out to zero) keeps its system quantity as the expected one
    var sl = systemLot(pKey, lotStr, expNorm);
    if (sl) { row.unknown = false; row.cost = Number(sl.cost) || row.cost; }
    row.expectedAtScan = sl ? clean(sl.onHand) : 0;
    row.counted = parsed;
    row.at = nowIso();
    mustSave(list);
    return { key: row.key, lot: row.lot, expiry: row.expiry, counted: row.counted };
  }

  function diffRows(sess) {
    var out = [];
    for (var i = 0; i < sess.lines.length; i++) {
      var ln = sess.lines[i];
      var expected = clean(ln.expectedAtScan);
      var counted = (ln.counted === null || ln.counted === undefined) ? null : Number(ln.counted);
      var delta = counted === null ? null : clean(counted - expected);
      var cost = Number(ln.cost) || 0;
      out.push({ index: i, key: ln.key, code: ln.code, name: ln.name, lot: ln.lot, expiry: ln.expiry, cost: cost, expected: expected, counted: counted,
        delta: delta, costDelta: delta === null ? 0 : r2(delta * cost), unknown: !!ln.unknown, reason: ln.reason || '', reasonNote: ln.reasonNote || '' });
    }
    return out;
  }
  function differences(sessionId) {
    var sess = findSession(loadSessions(), sessionId);
    return sess ? diffRows(sess) : [];
  }

  function validateCounted(sess) {
    if (!sess.lines.length) throw fail('errEmpty');
    for (var i = 0; i < sess.lines.length; i++) if (sess.lines[i].counted === null || sess.lines[i].counted === undefined) throw fail('errUncounted');
  }

  // Locks the counts (blind count ends here). Called before the differences are shown.
  function lock(sessionId) {
    var list = loadSessions();
    var sess = findSession(list, sessionId);
    if (!sess || sess.closedAt || sess.cancelledAt) throw fail('errNoSession');
    if (!sess.lockedAt) { validateCounted(sess); sess.lockedAt = nowIso(); mustSave(list); }
    return true;
  }

  function resolveReason(reasons, d) {
    if (!reasons) return null;
    if (typeof reasons === 'string') return { reason: reasons, note: '' };
    var val = reasons[lineId(d.key, d.lot, d.expiry)] || reasons[d.key + '|' + d.lot] || reasons[d.lot] || reasons[d.key] || reasons['default'];
    if (!val) return null;
    if (typeof val === 'string') return { reason: val, note: '' };
    return { reason: String(val.reason || '').trim(), note: String(val.note || '').trim() };
  }

  function canAdjust() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') return true;
    try { return window.novaPerms.require('stock.adjust') !== false; } catch (e) { return false; }
  }

  // Builds the frozen plan (first close attempt only).
  function buildPlan(sess, reasons) {
    validateCounted(sess);
    var rows = diffRows(sess), out = [], ins = [], notes = [], byLine = {};
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i];
      // an open box (sold by strip) leaves a fraction: only whole boxes are moved (toward zero), the fraction stays as is
      var whole = d.delta < 0 ? Math.ceil(d.delta - 1e-7) : Math.floor(d.delta + 1e-7);
      if (Math.abs(d.delta) < 1e-7) continue;
      var r = resolveReason(reasons, d);
      if (!r || !r.reason || (r.reason === OTHER_REASON && !r.note)) throw fail('errReason');
      byLine[d.index] = r;
      if (whole < 0) {
        out.push({ index: d.index, key: d.key, code: d.code, name: d.name, lot: d.lot, expiry: d.expiry, qty: -whole, cost: d.cost });
        notes.push(d.lot + ': ' + r.reason + (r.note ? ' - ' + r.note : ''));
      } else if (whole > 0) {
        ins.push({ index: d.index, key: d.key, lot: d.lot, expiry: d.expiry, qty: whole, cost: d.cost, unknown: d.unknown });
      }
    }
    return { at: nowIso(), out: out, ins: ins, note: ('جرد ' + sess.id + ': ' + notes.join('؛ ')).slice(0, 200), reasons: byLine };
  }

  function savePlan(sessionId, plan) {
    var fresh = loadSessions(), fs = findSession(fresh, sessionId);
    if (!fs) throw fail('errSave');
    fs.plan = plan;
    mustSave(fresh);
  }
  // Caps every shortage line at what the lot holds right now (whole boxes). Only before the shortage was sent to the item card.
  function capPlan(sessionId, plan) {
    if (plan.outStarted || plan.outApplied) return;
    var capped = {}, any = false;
    for (var i = 0; i < plan.out.length; i++) {
      var o = plan.out[i], want = o.wanted != null ? o.wanted : o.qty;
      var sl = systemLot(o.key, o.lot, o.expiry);
      var avail = Math.max(0, Math.floor((sl ? Number(sl.onHand) || 0 : 0) + 1e-7));
      var q = Math.min(want, avail);
      if (q < want) { capped[o.index] = { wanted: want, applied: q }; any = true; }
      o.wanted = want; o.qty = q;
    }
    plan.capped = capped;
    if (any || plan.out.length) savePlan(sessionId, plan);
  }
  function partiallyApplied(sess) {
    var p = sess.plan;
    if (!p) return false;
    if (p.outApplied || p.outStarted) return true;
    for (var i = 0; i < (p.ins || []).length; i++) if (p.ins[i].done || p.ins[i].started) return true;
    return false;
  }
  // Cancels an open / locked count that did not move any stock. Manager only, reason required.
  function cancel(sessionId, reason) {
    var list = loadSessions(), sess = findSession(list, sessionId);
    if (!sess || sess.closedAt || sess.cancelledAt) throw fail('errNoSession');
    if (!canAdjust()) throw fail('errNoPermCancel');
    var why = String(reason == null ? '' : reason).trim();
    if (!why) throw fail('errCancelReason');
    if (inFlight[sessionId] || partiallyApplied(sess)) throw fail('errPartial');
    sess.cancelledAt = nowIso(); sess.cancelReason = why; sess.cancelledBy = currentUserName();
    mustSave(list);
    refreshCard();
    return { session: sess };
  }

  // review-row info: how much of a shortage can really be deducted (frozen in the plan once closing started)
  function capInfoFor(sess, d) {
    if (sess.plan && sess.plan.capped && sess.plan.capped[d.index]) return sess.plan.capped[d.index];
    if (sess.closedAt || sess.cancelledAt || sess.plan || d.delta === null || d.delta >= 0) return null;
    var want = -Math.ceil(d.delta - 1e-7);
    var sl = systemLot(d.key, d.lot, d.expiry);
    var avail = Math.max(0, Math.floor((sl ? Number(sl.onHand) || 0 : 0) + 1e-7));
    return want > avail ? { wanted: want, applied: avail } : null;
  }

  var inFlight = {};
  function close(sessionId, reasons) {
    if (inFlight[sessionId]) return inFlight[sessionId];
    var p = closeOnce(sessionId, reasons);
    inFlight[sessionId] = p;
    var done = function () { delete inFlight[sessionId]; };
    p.then(done, done);
    return p;
  }

  function closeOnce(sessionId, reasons) {
    var list = loadSessions();
    var sess = findSession(list, sessionId);
    if (!sess || sess.cancelledAt) return Promise.reject(fail('errNoSession'));
    if (sess.closedAt) return Promise.resolve({ session: sess, summary: sess.summary, alreadyClosed: true });
    if (!canAdjust()) { toast(t('errNoPerm'), 'error'); return Promise.reject(fail('errNoPerm')); }
    try {
      if (!sess.plan) {
        sess.plan = buildPlan(sess, reasons);
        if (!sess.lockedAt) sess.lockedAt = sess.plan.at;
        mustSave(list);
      }
    } catch (err) {
      toast(err.message, 'error');
      return Promise.reject(err);
    }
    var plan = sess.plan;
    var ready = (plan.out.length && window.novaLazy && typeof window.novaLazy.load === 'function') ? Promise.resolve(window.novaLazy.load()) : Promise.resolve();
    return ready.then(function () {
      capPlan(sess.id, plan); // sales during the review: never ask for more than the lot holds now
      var active = plan.out.filter(function (o) { return o.qty > 0; });
      if (!active.length || plan.outApplied) return null;
      if (!window.novaItemCard || typeof window.novaItemCard.adjust !== 'function') throw fail('errAdjust');
      var lines = active.map(function (o) { return { key: o.key, code: o.code, name: o.name, lot: o.lot, expiry: o.expiry, qty: o.qty, cost: o.cost }; });
      plan.outStarted = true; savePlan(sess.id, plan); // crash window: cancel is refused while this is set
      return Promise.resolve(window.novaItemCard.adjust({ id: sess.id + '-out', reason: ADJUST_REASON, note: plan.note, lines: lines })).then(function () {
        plan.outStarted = false; plan.outApplied = true; savePlan(sess.id, plan);
      }, function (err) {
        plan.outStarted = false; try { savePlan(sess.id, plan); } catch (e) { /* keep the original error */ }
        throw err;
      });
    }).then(function () {
      for (var i = 0; i < plan.ins.length; i++) {
        var pl = plan.ins[i], entry = { key: pl.key, lot: pl.lot, expiry: pl.expiry, qty: pl.qty };
        if (pl.done) continue;
        if (pl.unknown) entry.cost = pl.cost; // a known lot keeps its own cost
        pl.started = true; savePlan(sess.id, plan);
        var res = window.novaStock.addLot(entry, 'COUNT-' + sess.id + '/' + pl.index);
        if (!res || !res.ok) { pl.started = false; try { savePlan(sess.id, plan); } catch (e) { /* keep the original error */ } throw fail('errStock'); }
        pl.done = true; savePlan(sess.id, plan);
      }
      var fresh = loadSessions();
      var fs = findSession(fresh, sessionId);
      if (!fs) throw fail('errSave');
      if (fs.closedAt) return { session: fs, summary: fs.summary, alreadyClosed: true };
      var shortage = 0, surplus = 0;
      for (var a = 0; a < plan.out.length; a++) shortage += plan.out[a].qty * (Number(plan.out[a].cost) || 0);
      for (var b = 0; b < plan.ins.length; b++) surplus += plan.ins[b].qty * (Number(plan.ins[b].cost) || 0);
      for (var k in plan.reasons) if (Object.prototype.hasOwnProperty.call(plan.reasons, k) && fs.lines[k]) {
        fs.lines[k].reason = plan.reasons[k].reason;
        fs.lines[k].reasonNote = plan.reasons[k].note;
      }
      fs.summary = { shortageCost: r2(shortage), surplusCost: r2(surplus), netCost: r2(surplus - shortage) };
      fs.closedAt = nowIso();
      mustSave(fresh);
      refreshCard();
      toast(t('okSaved'), 'success');
      return { session: fs, summary: fs.summary };
    }).catch(function (err) {
      toast((err && err.message) ? err.message : String(err), 'error');
      throw err;
    });
  }

  function sessions() { return loadSessions(); }

  // ---- UI ----

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function button(cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function fmtDate(iso) { return String(iso || '').slice(0, 10); }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#novaStockCount,#novaStockCount *,#novaStockCountOverlay,#novaStockCountOverlay *{box-sizing:border-box}' +
      '#novaStockCount{margin-top:16px;padding:16px;background:#14181d;border:1px solid #343b44;border-radius:10px;color:#e6edf3;max-width:100%}' +
      '.nsc-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}' +
      '.nsc-title{margin:0;font-size:1.05rem;color:#79c9eb}' +
      '.nsc-actions{display:flex;flex-wrap:wrap;gap:8px}' +
      '.nsc-btn{min-height:44px;padding:8px 14px;font-size:.95rem;cursor:pointer}' +
      '.nsc-badge{display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid #79c9eb;color:#79c9eb;font-size:.85rem}' +
      '.nsc-reports{margin-top:14px;border-top:1px solid #343b44;padding-top:12px}' +
      '.nsc-report-item{width:100%;text-align:inherit;background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:8px;padding:10px 12px;margin-top:8px;min-height:44px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;cursor:pointer;font:inherit}' +
      '.nsc-report-item:hover{border-color:#79c9eb}' +
      '#novaStockCountOverlay{position:fixed;inset:0;z-index:9800;background:#14181d;color:#e6edf3;overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:12px}' +
      '.nsc-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #343b44;padding-bottom:10px}' +
      '.nsc-search-row{display:flex;gap:8px;width:100%}' +
      '.nsc-input,.nsc-select{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:8px;padding:8px 10px;min-height:44px;font-size:1rem;width:100%;min-width:0}' +
      '.nsc-input:focus,.nsc-select:focus{outline:none;border-color:#79c9eb}' +
      '.nsc-results,.nsc-list{display:flex;flex-direction:column;gap:8px}' +
      '.nsc-result-btn{text-align:inherit;background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:8px;padding:10px;min-height:44px;cursor:pointer;font:inherit}' +
      '.nsc-prod-card{border:1px solid #343b44;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}' +
      '.nsc-prod-name{font-weight:700;color:#79c9eb;font-size:1rem;word-break:break-word}' +
      '.nsc-lot-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 92px;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #343b44}' +
      '.nsc-lot-meta{font-size:.9rem;word-break:break-word}' +
      '.nsc-unknown-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding-top:8px;border-top:1px dashed #343b44}' +
      '.nsc-progress{font-size:.95rem;color:#79c9eb;font-weight:600}' +
      '.nsc-footer{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid #343b44}' +
      '.nsc-table-wrap{width:100%;overflow-x:auto}' +
      '.nsc-table{width:100%;border-collapse:collapse;font-size:.9rem}' +
      '.nsc-table th,.nsc-table td{border:1px solid #343b44;padding:8px 6px;text-align:inherit;vertical-align:top}' +
      '.nsc-table th{color:#79c9eb}' +
      '.nsc-summary{padding:12px;border:1px solid #79c9eb;border-radius:8px;font-weight:700;color:#79c9eb}' +
      '#novaStockCountCancelDlg{position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:14px;color:#e6edf3}' +
      '.nsc-dlg{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:420px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}' +
      '.nsc-capped{color:#fbbf24}' +
      '.nsc-diff-neg{color:#f87171;font-weight:700}.nsc-diff-pos{color:#4ade80;font-weight:700}';
    document.head.appendChild(s);
  }

  function closeOverlay() { var ov = document.getElementById(OVERLAY_ID); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  function overlayShell() {
    closeOverlay();
    injectStyles();
    var ov = el('div');
    ov.id = OVERLAY_ID;
    ov.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    ov.setAttribute('role', 'dialog');
    document.body.appendChild(ov);
    return ov;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function countProgress(sess) {
    var items = {}, n = 0, m = 0;
    for (var i = 0; i < sess.lines.length; i++) {
      var ln = sess.lines[i];
      if (ln.counted !== null && ln.counted !== undefined) { m++; if (!items[ln.key]) { items[ln.key] = 1; n++; } }
    }
    return { items: n, lots: m };
  }

  function openCountingOverlay(sessionId) {
    var sess0 = findSession(loadSessions(), sessionId);
    if (sess0 && sess0.lockedAt && !sess0.closedAt) { openReviewOverlay(sessionId, false); return; }
    var ov = overlayShell();
    var openUnknownFor = {};

    function render() {
      clear(ov);
      var sess = findSession(loadSessions(), sessionId);
      if (!sess || sess.closedAt) { closeOverlay(); refreshCard(); return; }

      var bar = el('div', 'nsc-bar');
      bar.appendChild(el('h2', 'nsc-title', t('title') + ' — ' + fmtDate(sess.startedAt)));
      var pc = countProgress(sess);
      var prog = el('div', 'nsc-progress', t('progress', { n: pc.items, m: pc.lots }));
      bar.appendChild(prog);
      ov.appendChild(bar);

      var searchRow = el('div', 'nsc-search-row');
      var search = el('input', 'nsc-input');
      search.type = 'search';
      search.placeholder = t('searchPh');
      search.setAttribute('enterkeyhint', 'search');
      search.setAttribute('aria-label', t('searchPh'));
      var addBtn = button('btn btn-primary nsc-btn', t('add'));
      searchRow.appendChild(search);
      searchRow.appendChild(addBtn);
      ov.appendChild(searchRow);
      var results = el('div', 'nsc-results');
      ov.appendChild(results);

      function addFrom(prod) {
        try {
          var rows = addProduct(keyOfProduct(prod), sess.id);
          if (!rows.length) openUnknownFor[keyOfProduct(prod)] = true;
          render();
          var s2 = ov.querySelector('input[type="search"]');
          if (s2) s2.focus();
        } catch (err) { toast(err.message, 'error'); }
      }
      function doSearch(autoFirst) {
        var q = search.value.trim();
        clear(results);
        if (!q) return;
        var hits = [];
        try { hits = (window.novaSearch && typeof window.novaSearch.search === 'function') ? (window.novaSearch.search(q, 8) || []) : []; } catch (e) { hits = []; }
        if (autoFirst) { if (hits.length) addFrom(hits[0]); else toast(t('errNotFound'), 'error'); return; }
        for (var h = 0; h < hits.length; h++) (function (p) {
          results.appendChild(button('nsc-result-btn', String(p.name || '') + (p.barcode ? ' · ' + p.barcode : ''), function () { addFrom(p); }));
        })(hits[h]);
      }
      search.addEventListener('input', function () { doSearch(false); });
      search.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSearch(true); } });
      addBtn.addEventListener('click', function () { doSearch(true); });

      // group by product (BLIND: expectedAtScan is never rendered or put in an attribute)
      var groups = {}, order = [], prods = sess.products || [];
      for (var p = 0; p < prods.length; p++) { groups[prods[p].key] = { key: prods[p].key, name: prods[p].name, lines: [] }; order.push(prods[p].key); }
      for (var li = 0; li < sess.lines.length; li++) {
        var ln = sess.lines[li];
        if (!groups[ln.key]) { groups[ln.key] = { key: ln.key, name: ln.name, lines: [] }; order.push(ln.key); }
        groups[ln.key].lines.push(ln);
      }
      var listWrap = el('div', 'nsc-list');
      for (var g = order.length - 1; g >= 0; g--) (function (grp) { // newest product first (the one just scanned)
        var card = el('div', 'nsc-prod-card');
        card.appendChild(el('div', 'nsc-prod-name', grp.name));
        if (!grp.lines.length) card.appendChild(el('div', 'nsc-lot-meta', t('errNoLots')));
        else {
          var hdr = el('div', 'nsc-lot-row');
          hdr.style.borderTop = 'none';
          hdr.appendChild(el('strong', 'nsc-lot-meta', t('lot')));
          hdr.appendChild(el('strong', 'nsc-lot-meta', t('expiry')));
          hdr.appendChild(el('strong', 'nsc-lot-meta', t('count')));
          card.appendChild(hdr);
        }
        for (var r = 0; r < grp.lines.length; r++) (function (line) {
          var row = el('div', 'nsc-lot-row');
          var lotCell = el('div', 'nsc-lot-meta', line.lot);
          lotCell.setAttribute('dir', 'ltr');
          row.appendChild(lotCell);
          var expCell = el('div', 'nsc-lot-meta', shortExpiry(line.expiry));
          expCell.setAttribute('dir', 'ltr');
          row.appendChild(expCell);
          var inp = el('input', 'nsc-input nsc-count');
          inp.type = 'text';
          inp.setAttribute('inputmode', 'numeric');
          inp.setAttribute('autocomplete', 'off');
          inp.setAttribute('aria-label', t('count') + ' ' + line.lot);
          inp.value = (line.counted === null || line.counted === undefined) ? '' : String(line.counted);
          inp.addEventListener('change', function () {
            try {
              setCount(sess.id, line.key, line.lot, line.expiry, inp.value === '' ? null : inp.value);
              var c = countProgress(findSession(loadSessions(), sess.id));
              prog.textContent = t('progress', { n: c.items, m: c.lots });
            } catch (err) { toast(err.message, 'error'); inp.value = ''; }
          });
          row.appendChild(inp);
          card.appendChild(row);
        })(grp.lines[r]);

        card.appendChild(button('btn btn-secondary nsc-btn', t('unknownLotBtn'), function () { openUnknownFor[grp.key] = !openUnknownFor[grp.key]; render(); }));
        if (openUnknownFor[grp.key]) {
          var form = el('div', 'nsc-unknown-form');
          var uLot = el('input', 'nsc-input'); uLot.placeholder = t('lotPh'); uLot.setAttribute('aria-label', t('lotPh')); uLot.setAttribute('dir', 'ltr');
          var uExp = el('input', 'nsc-input'); uExp.placeholder = t('expPh'); uExp.setAttribute('aria-label', t('expPh')); uExp.setAttribute('inputmode', 'numeric'); uExp.setAttribute('dir', 'ltr');
          var uQty = el('input', 'nsc-input'); uQty.placeholder = t('count'); uQty.setAttribute('aria-label', t('count')); uQty.setAttribute('inputmode', 'numeric');
          var uAdd = button('btn btn-primary nsc-btn', t('add'), function () {
            try { addUnknownLot(sess.id, grp.key, uLot.value, uExp.value, uQty.value); openUnknownFor[grp.key] = false; render(); }
            catch (err) { toast(err.message, 'error'); }
          });
          form.appendChild(uLot); form.appendChild(uExp); form.appendChild(uQty); form.appendChild(uAdd);
          card.appendChild(form);
        }
        listWrap.appendChild(card);
      })(groups[order[g]]);
      ov.appendChild(listWrap);

      var footer = el('div', 'nsc-footer');
      footer.appendChild(button('btn btn-secondary nsc-btn', t('saveLater'), function () { closeOverlay(); refreshCard(); }));
      footer.appendChild(button('btn btn-primary nsc-btn', t('finish'), function () {
        try {
          lock(sess.id);
          openReviewOverlay(sess.id, false);
        } catch (err) { toast(err.message, 'error'); }
      }));
      ov.appendChild(footer);
    }
    render();
  }

  // In-app dialog (no window.confirm): asks for the cancel reason, then cancels.
  function askCancel(sessionId) {
    var old = document.getElementById(CANCEL_DLG_ID); if (old && old.parentNode) old.parentNode.removeChild(old);
    injectStyles();
    var back = el('div'); back.id = CANCEL_DLG_ID;
    back.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var box = el('div', 'nsc-dlg'); box.setAttribute('role', 'alertdialog');
    box.appendChild(el('h3', 'nsc-title', t('cancelTitle')));
    box.appendChild(el('div', 'nsc-lot-meta', t('cancelHint')));
    var inp = el('textarea', 'nsc-input nsc-cancel-reason'); inp.rows = 3; inp.placeholder = t('cancelReasonPh'); inp.setAttribute('aria-label', t('cancelReasonPh'));
    box.appendChild(inp);
    var msg = el('div', 'nsc-diff-neg nsc-dlg-msg');
    box.appendChild(msg);
    var row = el('div', 'nsc-footer');
    function shut() { if (back.parentNode) back.parentNode.removeChild(back); }
    row.appendChild(button('btn btn-secondary nsc-btn nsc-dlg-back', t('cancelBack'), shut));
    row.appendChild(button('btn btn-danger nsc-btn nsc-dlg-ok', t('cancelConfirm'), function () {
      try { cancel(sessionId, inp.value); } catch (err) { msg.textContent = err.message; toast(err.message, 'error'); return; }
      shut(); closeOverlay(); refreshCard(); toast(t('okCancelled'), 'success');
    }));
    box.appendChild(row);
    back.appendChild(box);
    document.body.appendChild(back);
    inp.focus();
  }

  function openReviewOverlay(sessionId, readOnly) {
    var sess = findSession(loadSessions(), sessionId);
    if (!sess) { closeOverlay(); return; }
    if (!readOnly && !sess.lockedAt) { try { lock(sessionId); } catch (err) { toast(err.message, 'error'); return; } }
    var ov = overlayShell();
    var diffs = differences(sessionId);
    var bar = el('div', 'nsc-bar');
    bar.appendChild(el('h2', 'nsc-title', t('reviewTitle') + ' — ' + fmtDate(sess.startedAt)));
    ov.appendChild(bar);

    var wrap = el('div', 'nsc-table-wrap');
    var table = el('table', 'nsc-table');
    var thead = el('thead'), hr = el('tr');
    var cols = [t('item'), t('lot'), t('expected'), t('counted'), t('diff'), t('reason')];
    for (var c = 0; c < cols.length; c++) hr.appendChild(el('th', null, cols[c]));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody'), inputs = {};
    for (var i = 0; i < diffs.length; i++) (function (d) {
      var tr = el('tr');
      tr.appendChild(el('td', null, d.name));
      var lotTd = el('td', null, d.lot + ' · ' + shortExpiry(d.expiry)); lotTd.setAttribute('dir', 'ltr');
      tr.appendChild(lotTd);
      tr.appendChild(el('td', null, String(d.expected)));
      tr.appendChild(el('td', null, d.counted === null ? '—' : String(d.counted)));
      var zero = d.delta === null || Math.abs(d.delta) < 1e-7;
      var dTd = el('td', zero ? null : (d.delta < 0 ? 'nsc-diff-neg' : 'nsc-diff-pos'), d.delta === null ? '—' : (d.delta > 0 ? '+' : '') + String(d.delta));
      dTd.setAttribute('dir', 'ltr');
      tr.appendChild(dTd);
      var rTd = el('td');
      if (zero) rTd.textContent = '—';
      else if (readOnly || sess.plan) rTd.textContent = (d.reason || (sess.plan && sess.plan.reasons[d.index] && sess.plan.reasons[d.index].reason) || '') + (d.reasonNote ? ' — ' + d.reasonNote : '');
      else {
        var sel = el('select', 'nsc-select');
        sel.setAttribute('aria-label', t('reason'));
        var o0 = el('option', null, t('reason')); o0.value = ''; sel.appendChild(o0);
        for (var r = 0; r < REASON_OPTIONS.length; r++) { var o = el('option', null, isEn() ? REASON_OPTIONS[r].en : REASON_OPTIONS[r].ar); o.value = REASON_OPTIONS[r].ar; sel.appendChild(o); }
        var note = el('input', 'nsc-input'); note.placeholder = t('notePh'); note.setAttribute('aria-label', t('notePh')); note.style.marginTop = '6px';
        rTd.appendChild(sel); rTd.appendChild(note);
        inputs[lineId(d.key, d.lot, d.expiry)] = { sel: sel, note: note };
      }
      var ci = zero ? null : capInfoFor(sess, d);
      if (ci) { var cn = el('div', 'nsc-lot-meta nsc-capped', t('cappedNote') + ' (' + ci.applied + '/' + ci.wanted + ')'); cn.style.marginTop = '6px'; rTd.appendChild(cn); }
      tr.appendChild(rTd);
      tbody.appendChild(tr);
    })(diffs[i]);
    table.appendChild(tbody);
    wrap.appendChild(table);
    ov.appendChild(wrap);

    if (readOnly && sess.summary) {
      ov.appendChild(el('div', 'nsc-summary', t('summaryFmt', { net: r2(sess.summary.netCost), short: r2(sess.summary.shortageCost), surp: r2(sess.summary.surplusCost) })));
    }
    if (sess.cancelledAt) ov.appendChild(el('div', 'nsc-summary nsc-cancelled', t('cancelledInfo', { reason: sess.cancelReason || '' })));
    var footer = el('div', 'nsc-footer');
    if (readOnly) footer.appendChild(button('btn btn-secondary nsc-btn', t('close'), closeOverlay));
    else {
      footer.appendChild(button('btn btn-secondary nsc-btn', t('later'), function () { closeOverlay(); refreshCard(); }));
      footer.appendChild(button('btn btn-danger nsc-btn nsc-cancel-btn', t('cancelCount'), function () { askCancel(sess.id); }));
      var confirmBtn = button('btn btn-primary nsc-btn', t('confirm'), function () {
        var map = {};
        for (var k in inputs) if (Object.prototype.hasOwnProperty.call(inputs, k)) map[k] = { reason: inputs[k].sel.value, note: inputs[k].note.value.trim() };
        confirmBtn.disabled = true;
        close(sess.id, map).then(function (res) { openReviewOverlay(res.session.id, true); }, function () { confirmBtn.disabled = false; });
      });
      footer.appendChild(confirmBtn);
    }
    ov.appendChild(footer);
  }

  function buildCard(card) {
    clear(card);
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var list = loadSessions(), open = findOpenSession(list);
    var head = el('div', 'nsc-head');
    head.appendChild(el('h3', 'nsc-title', t('title')));
    if (open) head.appendChild(el('span', 'nsc-badge', t('openSession') + ' ' + fmtDate(open.startedAt)));
    var actions = el('div', 'nsc-actions');
    if (open) actions.appendChild(button('btn btn-primary nsc-btn', open.lockedAt ? t('toReview') : t('continueCount'), function () { openCountingOverlay(open.id); }));
    else actions.appendChild(button('btn btn-primary nsc-btn', t('startNew'), function () {
      try { openCountingOverlay(start().id); } catch (err) { toast(err.message, 'error'); }
    }));
    if (open) actions.appendChild(button('btn btn-danger nsc-btn nsc-cancel-btn', t('cancelCount'), function () { askCancel(open.id); }));
    head.appendChild(actions);
    card.appendChild(head);

    var rep = el('div', 'nsc-reports');
    rep.appendChild(el('strong', null, t('reports')));
    var closed = list.filter(function (s) { return !!s.closedAt || !!s.cancelledAt; });
    if (!closed.length) { var e = el('div', 'nsc-lot-meta', t('noReports')); e.style.marginTop = '6px'; rep.appendChild(e); }
    closed.forEach(function (cs) {
      var b = button('nsc-report-item', null, function () { openReviewOverlay(cs.id, true); });
      b.appendChild(el('span', null, fmtDate(cs.closedAt || cs.cancelledAt) + (cs.by ? ' · ' + cs.by : '') + (cs.cancelledAt ? ' · ' + t('cancelledBadge') : '')));
      if (cs.cancelledAt) { b.appendChild(el('span', 'nsc-lot-meta', cs.cancelReason || '')); rep.appendChild(b); return; }
      b.appendChild(el('span', null, t('itemsCount') + ': ' + countProgress(cs).items + ' · ' + t('costDiff') + ': ' + r2(cs.summary ? cs.summary.netCost : 0)));
      rep.appendChild(b);
    });
    card.appendChild(rep);
  }

  function productsActive() {
    return (document.body && document.body.dataset.activePage === 'products') || !!document.querySelector('.nova-tab.active[data-page="products"]');
  }
  function mountCard() {
    var pv = document.getElementById('novaPageView');
    if (!pv || pv.hidden || !productsActive() || document.getElementById(CARD_ID)) return;
    injectStyles();
    var card = el('section');
    card.id = CARD_ID;
    buildCard(card);
    pv.appendChild(card);
  }
  function refreshCard() { var c = document.getElementById(CARD_ID); if (c) buildCard(c); else mountCard(); }

  function watch() {
    var pv = document.getElementById('novaPageView');
    if (!pv) return;
    mountCard();
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () { if (!document.getElementById(CARD_ID)) mountCard(); }).observe(pv, { childList: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  window.novaStockCount = {
    start: start, addProduct: addProduct, setCount: setCount, addUnknownLot: addUnknownLot,
    differences: differences, lock: lock, close: close, cancel: cancel, sessions: sessions
  };
})();
