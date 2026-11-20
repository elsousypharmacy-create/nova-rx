/* NOVA Rx — SLOG-01 (#124) «سجل العمليات الحساسة»: read-only timeline of cancellations, returns, big discounts, receipt corrections,
   adjustments, supplier returns, credit-limit changes, cash-outs, expenses and shift differences. Reviewed Gemini Neon draft, integrated by Claude; lazy. */
(function () {
  'use strict';

  var SECTION_ID = 'novaSensitiveLogSection';
  var STYLE_ID = 'novaSensitiveLogStyles';
  var PRINT_HOST_ID = 'novaSensitiveLogPrintHost';
  var PRINT_BODY_CLASS = 'nova-sensitive-log-printing';
  var MAX_ROWS = 300;
  var LARGE_DISCOUNT_PCT = 20;
  var PRINT_TIMEOUT_MS = 60000;

  var TYPES = [
    { key: 'cancel', label: 'إلغاء فاتورة' },
    { key: 'return', label: 'مرتجع مبيعات' },
    { key: 'discount', label: 'خصم على صنف' },
    { key: 'receipt_correction', label: 'تعديل استلام' },
    { key: 'stock_adjust', label: 'تسوية مخزون' },
    { key: 'supplier_return', label: 'مرتجع مورد' },
    { key: 'credit_limit', label: 'تغيير حد ائتمان' },
    { key: 'cash_out', label: 'صرف / دفعة مورد' },
    { key: 'expense', label: 'مصروف' },
    { key: 'shift_diff', label: 'فرق تقفيل شيفت' }
  ];

  var TYPE_LABELS = {};
  for (var ti = 0; ti < TYPES.length; ti++) {
    TYPE_LABELS[TYPES[ti].key] = TYPES[ti].label;
  }

  var EXPENSE_STATUS_AR = {
    draft: 'مسودة',
    approved: 'معتمد',
    rejected: 'مرفوض',
    paid: 'مدفوع'
  };

  var observerAttached = false;
  var activePrintCleanup = null;

  /* ---------- Safe Helpers ---------- */

  function readStorageJson(key) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) {
        return null;
      }
      var raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function safeArray(val) {
    return Array.isArray(val) ? val : [];
  }

  function safeNum(val) {
    if (val === null || val === undefined || val === '') {
      return null;
    }
    var n = Number(val);
    return isFinite(n) ? n : null;
  }

  function parseTime(val) {
    if (val === null || val === undefined || val === '') {
      return null;
    }
    if (typeof val === 'number') {
      return isFinite(val) && val > 0 ? val : null;
    }
    if (typeof val === 'string') {
      var trimmed = val.trim();
      if (!trimmed) {
        return null;
      }
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        var asNum = Number(trimmed);
        return isFinite(asNum) && asNum > 0 ? asNum : null;
      }
      var parsed = Date.parse(trimmed);
      return isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function personName(val) {
    if (!val) {
      return '';
    }
    if (typeof val === 'string') {
      return val.trim();
    }
    if (typeof val === 'object') {
      if (typeof val.name === 'string' && val.name.trim()) {
        return val.name.trim();
      }
      if (typeof val.username === 'string' && val.username.trim()) {
        return val.username.trim();
      }
      if (typeof val.id === 'string' && val.id.trim()) {
        return val.id.trim();
      }
    }
    return '';
  }

  function pad2(n) {
    return n < 10 ? '0' + String(n) : String(n);
  }

  function fmtDateInput(ms) {
    var d = new Date(ms);
    return String(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function fmtDateTime(ms) {
    if (!ms || !isFinite(ms)) {
      return '—';
    }
    var d = new Date(ms);
    if (isNaN(d.getTime())) {
      return '—';
    }
    return (
      String(d.getFullYear()) + '-' +
      pad2(d.getMonth() + 1) + '-' +
      pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' +
      pad2(d.getMinutes())
    );
  }

  function fmtNumber(n, decimals) {
    if (n === null || n === undefined || !isFinite(n)) {
      return '—';
    }
    var dec = typeof decimals === 'number' ? decimals : 2;
    var fixed = Number(n).toFixed(dec);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (dec > 0 && parts[1]) {
      var frac = parts[1].replace(/0+$/, '');
      return frac ? parts[0] + '.' + frac : parts[0];
    }
    return parts[0];
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) {
      return '—';
    }
    return fmtNumber(n, 2) + ' ج.م';
  }

  function parseDateInputStart(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return null;
    }
    var p = str.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function parseDateInputEnd(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return null;
    }
    var p = str.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 23, 59, 59, 999);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function normalizeText(s) {
    return String(s || '').trim().toLowerCase();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  /* ---------- Data Extraction (READ-ONLY) ---------- */

  function getSalesList() {
    try {
      if (window.novaSales && typeof window.novaSales.list === 'function') {
        return safeArray(window.novaSales.list());
      }
    } catch (e) {
      return [];
    }
    return [];
  }

  function getReturnsList() {
    try {
      if (window.novaSales && typeof window.novaSales.returns === 'function') {
        return safeArray(window.novaSales.returns());
      }
    } catch (e) {
      return [];
    }
    return [];
  }

  function makeRow(opts) {
    return {
      id: String(opts.id || ''),
      at: opts.at || 0,
      type: opts.type,
      typeLabel: TYPE_LABELS[opts.type] || opts.type,
      who: opts.who || '',
      approver: opts.approver || '',
      details: opts.details || '',
      amount: opts.amount !== undefined ? opts.amount : null,
      badge: opts.badge || '',
      flags: safeArray(opts.flags)
    };
  }

  function collectReturnsAndCancellations(out) {
    var returns = getReturnsList();
    for (var i = 0; i < returns.length; i++) {
      var r = returns[i];
      if (!r || typeof r !== 'object') {
        continue;
      }
      var isCancel = r.kind === 'cancel';
      var at = parseTime(r.at);
      var who = personName(r.by);
      var approver = personName(r.approvedBy) || personName(r.approverId);
      var amount = safeNum(r.amount);
      var parts = [];
      if (r.saleId) {
        parts.push('فاتورة: ' + String(r.saleId));
      }
      if (Array.isArray(r.lines) && r.lines.length) {
        var totalQty = 0;
        for (var li = 0; li < r.lines.length; li++) {
          var q = safeNum(r.lines[li] && r.lines[li].qty);
          if (q !== null) {
            totalQty += q;
          }
        }
        parts.push('أصناف: ' + String(r.lines.length) + (totalQty ? ' (كمية ' + fmtNumber(totalQty, 2) + ')' : ''));
      }
      if (r.reason) {
        parts.push('السبب: ' + String(r.reason));
      }
      if (r.role) {
        parts.push('الصلاحية: ' + String(r.role));
      }
      out.push(makeRow({
        id: (isCancel ? 'cancel-' : 'return-') + String(r.id || i),
        at: at || 0,
        type: isCancel ? 'cancel' : 'return',
        who: who,
        approver: approver,
        details: parts.join(' | ') || (isCancel ? 'إلغاء فاتورة' : 'مرتجع مبيعات'),
        amount: amount
      }));
    }
  }

  function collectSaleDiscounts(out) {
    var sales = getSalesList();
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      if (!s || typeof s !== 'object' || !Array.isArray(s.lines)) {
        continue;
      }
      var at = parseTime(s.at);
      var invNo = s.no !== undefined && s.no !== null && String(s.no).trim() ? String(s.no) : String(s.id || '');
      var who = personName(s.by);
      for (var li = 0; li < s.lines.length; li++) {
        var line = s.lines[li];
        if (!line || typeof line !== 'object') {
          continue;
        }
        var disc = safeNum(line.discount);
        if (disc === null || disc <= 0) {
          continue;
        }
        var qty = safeNum(line.qty);
        var price = safeNum(line.price);
        var lineVal = (qty !== null && price !== null) ? qty * price : 0;
        var pct = lineVal > 0 ? (disc / lineVal) * 100 : null;
        var isLarge = pct !== null && pct >= LARGE_DISCOUNT_PCT;
        var parts = [];
        if (invNo) {
          parts.push('فاتورة #' + invNo);
        }
        if (line.name) {
          parts.push('الصنف: ' + String(line.name));
        }
        parts.push('خصم: ' + fmtMoney(disc) + (pct !== null ? ' (' + fmtNumber(pct, 1) + '%)' : ''));
        out.push(makeRow({
          id: 'disc-' + String(s.id || i) + '-' + String(li),
          at: at || 0,
          type: 'discount',
          who: who,
          details: parts.join(' | '),
          amount: disc,
          badge: isLarge ? 'خصم كبير' : '',
          flags: isLarge ? ['large_discount'] : []
        }));
      }
    }
  }

  function collectReceiptCorrections(out) {
    var receipts = safeArray(readStorageJson('nova-rx-receipts-v1'));
    for (var i = 0; i < receipts.length; i++) {
      var rec = receipts[i];
      if (!rec || typeof rec !== 'object' || !Array.isArray(rec.corrections)) {
        continue;
      }
      var lines = safeArray(rec.lines);
      for (var ci = 0; ci < rec.corrections.length; ci++) {
        var corr = rec.corrections[ci];
        if (!corr || typeof corr !== 'object') {
          continue;
        }
        var at = parseTime(corr.at) || parseTime(rec.at);
        var who = personName(corr.by) || personName(rec.by);
        var parts = [];
        if (rec.supplier) {
          parts.push('مورد: ' + String(rec.supplier));
        }
        if (rec.invoice) {
          parts.push('فاتورة: ' + String(rec.invoice));
        }
        if (corr.reason) {
          parts.push('السبب: ' + String(corr.reason));
        }
        var changes = safeArray(corr.changes);
        var changeTexts = [];
        for (var chIdx = 0; chIdx < changes.length; chIdx++) {
          var ch = changes[chIdx];
          if (!ch || typeof ch !== 'object') {
            continue;
          }
          var lineObj = (typeof ch.index === 'number' && lines[ch.index]) ? lines[ch.index] : null;
          var lineLabel = lineObj && lineObj.name ? String(lineObj.name) + ': ' : '';
          var beforeStr = ch.before !== undefined && ch.before !== null ? String(ch.before) : '—';
          var afterStr = ch.after !== undefined && ch.after !== null ? String(ch.after) : '—';
          changeTexts.push(lineLabel + beforeStr + ' → ' + afterStr);
        }
        if (changeTexts.length) {
          parts.push(changeTexts.join('، '));
        }
        out.push(makeRow({
          id: 'rcorr-' + String(rec.id || i) + '-' + String(corr.id || ci),
          at: at || 0,
          type: 'receipt_correction',
          who: who,
          details: parts.join(' | ') || 'تعديل على إذن استلام',
          amount: null
        }));
      }
    }
  }

  function collectStockAdjustments(out) {
    var list = safeArray(readStorageJson('nova-rx-stock-adjust-v1'));
    for (var i = 0; i < list.length; i++) {
      var adj = list[i];
      if (!adj || typeof adj !== 'object') {
        continue;
      }
      var at = parseTime(adj.at);
      var who = personName(adj.by);
      var amount = safeNum(adj.total);
      var lines = safeArray(adj.lines);
      var qtySum = 0;
      var lineNames = [];
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        if (!ln || typeof ln !== 'object') {
          continue;
        }
        var q = safeNum(ln.qty);
        if (q !== null) {
          qtySum += q;
        }
        if (ln.name && lineNames.length < 3) {
          lineNames.push(String(ln.name) + (q !== null ? ' (' + fmtNumber(q, 2) + ')' : ''));
        }
      }
      var parts = [];
      if (adj.reason) {
        parts.push('السبب: ' + String(adj.reason));
      }
      if (lines.length) {
        parts.push('الكمية: ' + fmtNumber(qtySum, 2) + (lineNames.length ? ' — ' + lineNames.join('، ') : ''));
      }
      if (adj.note) {
        parts.push('ملاحظة: ' + String(adj.note));
      }
      out.push(makeRow({
        id: 'adj-' + String(adj.id || i),
        at: at || 0,
        type: 'stock_adjust',
        who: who,
        details: parts.join(' | ') || 'تسوية مخزون',
        amount: amount
      }));
    }
  }

  function collectSupplierReturns(out) {
    var list = safeArray(readStorageJson('nova-rx-supplier-returns-v1'));
    for (var i = 0; i < list.length; i++) {
      var sr = list[i];
      if (!sr || typeof sr !== 'object') {
        continue;
      }
      var at = parseTime(sr.at);
      var who = personName(sr.by);
      var amount = safeNum(sr.total);
      var lines = safeArray(sr.lines);
      var qtySum = 0;
      for (var li = 0; li < lines.length; li++) {
        var q = safeNum(lines[li] && lines[li].qty);
        if (q !== null) {
          qtySum += q;
        }
      }
      var parts = [];
      if (sr.supplier) {
        parts.push('مورد: ' + String(sr.supplier));
      }
      if (sr.reason) {
        parts.push('السبب: ' + String(sr.reason));
      }
      if (lines.length) {
        parts.push('أصناف: ' + String(lines.length) + ' (كمية ' + fmtNumber(qtySum, 2) + ')');
      }
      out.push(makeRow({
        id: 'sret-' + String(sr.id || i),
        at: at || 0,
        type: 'supplier_return',
        who: who,
        details: parts.join(' | ') || 'مرتجع لمورد',
        amount: amount
      }));
    }
  }

  function collectCreditLimitChanges(out) {
    var list = safeArray(readStorageJson('nova-rx-credit-limit-log-v1'));
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') {
        continue;
      }
      var at = parseTime(item.at);
      var who = personName(item.by);
      var fromVal = safeNum(item.from);
      var toVal = safeNum(item.to);
      var parts = [];
      if (item.customerId) {
        parts.push('عميل: ' + String(item.customerId));
      }
      parts.push(
        (fromVal !== null ? fmtMoney(fromVal) : String(item.from || '—')) +
        ' → ' +
        (toVal !== null ? fmtMoney(toVal) : String(item.to || '—'))
      );
      out.push(makeRow({
        id: 'climit-' + String(i) + '-' + String(at || 0),
        at: at || 0,
        type: 'credit_limit',
        who: who,
        details: parts.join(' | '),
        amount: toVal
      }));
    }
  }

  function collectCashOutsAndSupplierAccounts(out) {
    var cashOuts = safeArray(readStorageJson('nova-rx-cash-out-v1'));
    for (var i = 0; i < cashOuts.length; i++) {
      var c = cashOuts[i];
      if (!c || typeof c !== 'object') {
        continue;
      }
      var at = parseTime(c.at);
      var who = personName(c.by);
      var amount = safeNum(c.amount);
      var details = c.note ? 'صرف من الدرج: ' + String(c.note) : 'صرف من الدرج';
      out.push(makeRow({
        id: 'cashout-' + String(c.id || i),
        at: at || 0,
        type: 'cash_out',
        who: who,
        details: details,
        amount: amount
      }));
    }

    var sa = readStorageJson('nova.supplierAccounts');
    if (!sa || typeof sa !== 'object') {
      return;
    }
    var suppliersMap = (sa.suppliers && typeof sa.suppliers === 'object') ? sa.suppliers : {};

    var moves = safeArray(sa.moves);
    for (var mi = 0; mi < moves.length; mi++) {
      var m = moves[mi];
      if (!m || typeof m !== 'object') {
        continue;
      }
      if (m.type !== 'payment' && m.type !== 'reversal') {
        continue;
      }
      var mat = parseTime(m.at);
      var cents = safeNum(m.cents);
      var mAmount = cents !== null ? cents / 100 : null;
      var supObj = m.supplierId && suppliersMap[m.supplierId] ? suppliersMap[m.supplierId] : null;
      var supName = supObj && supObj.name ? String(supObj.name) : (m.supplierId ? String(m.supplierId) : '');
      var mParts = [];
      mParts.push(m.type === 'reversal' ? 'عكس حركة مورد' : 'دفعة مورد');
      if (supName) {
        mParts.push(supName);
      }
      if (m.ref) {
        mParts.push('مرجع: ' + String(m.ref));
      }
      if (m.reason) {
        mParts.push('السبب: ' + String(m.reason));
      }
      out.push(makeRow({
        id: 'smove-' + String(m.id || mi),
        at: mat || 0,
        type: 'cash_out',
        who: personName(m.by),
        details: mParts.join(' | '),
        amount: mAmount
      }));
    }

    var expenses = safeArray(sa.expenses);
    for (var ei = 0; ei < expenses.length; ei++) {
      var ex = expenses[ei];
      if (!ex || typeof ex !== 'object') {
        continue;
      }
      var eat = parseTime(ex.at);
      var eAmt = safeNum(ex.amount);
      if (eAmt === null) {
        var eCents = safeNum(ex.cents);
        if (eCents !== null) {
          eAmt = eCents / 100;
        }
      }
      var statusLabel = EXPENSE_STATUS_AR[ex.status] || (ex.status ? String(ex.status) : '');
      var eParts = [];
      if (ex.category) {
        eParts.push('بند: ' + String(ex.category));
      }
      if (ex.document) {
        eParts.push('مستند: ' + String(ex.document));
      }
      if (statusLabel) {
        eParts.push('الحالة: ' + statusLabel);
      }
      out.push(makeRow({
        id: 'exp-' + String(ex.id || ei),
        at: eat || 0,
        type: 'expense',
        who: personName(ex.createdBy),
        approver: personName(ex.approvedBy),
        details: eParts.join(' | ') || 'مصروف',
        amount: eAmt
      }));
    }
  }

  function collectShiftDiffs(out) {
    var list = safeArray(readStorageJson('nova-rx-shift-closings-v1'));
    for (var i = 0; i < list.length; i++) {
      var sh = list[i];
      if (!sh || typeof sh !== 'object') {
        continue;
      }
      var expected = safeNum(sh.expected);
      var counted = safeNum(sh.counted);
      var diff = safeNum(sh.diff);
      if (diff === null && expected !== null && counted !== null) {
        diff = counted - expected;
      }
      if (diff === null || Math.abs(diff) < 0.005) {
        continue;
      }
      var at = parseTime(sh.at);
      var who = personName(sh.by);
      var parts = [];
      parts.push(diff < 0 ? 'عجز بالدرج' : 'زيادة بالدرج');
      if (expected !== null) {
        parts.push('متوقع: ' + fmtMoney(expected));
      }
      if (counted !== null) {
        parts.push('فعلي: ' + fmtMoney(counted));
      }
      parts.push('الفرق: ' + (diff > 0 ? '+' : '') + fmtMoney(diff));
      out.push(makeRow({
        id: 'shift-' + String(sh.id || i) + '-' + String(at || 0),
        at: at || 0,
        type: 'shift_diff',
        who: who,
        details: parts.join(' | '),
        amount: diff
      }));
    }
  }

  function buildRows(fromMs, toMs) {
    var all = [];
    collectReturnsAndCancellations(all);
    collectSaleDiscounts(all);
    collectReceiptCorrections(all);
    collectStockAdjustments(all);
    collectSupplierReturns(all);
    collectCreditLimitChanges(all);
    collectCashOutsAndSupplierAccounts(all);
    collectShiftDiffs(all);

    var hasFrom = typeof fromMs === 'number' && isFinite(fromMs);
    var hasTo = typeof toMs === 'number' && isFinite(toMs);
    var filtered = [];

    for (var i = 0; i < all.length; i++) {
      var row = all[i];
      if (hasFrom && row.at < fromMs) {
        continue;
      }
      if (hasTo && row.at > toMs) {
        continue;
      }
      filtered.push(row);
    }

    filtered.sort(function (a, b) {
      return (b.at || 0) - (a.at || 0);
    });

    return filtered;
  }

  /* ---------- Styles ---------- */

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var css = [
      '#' + SECTION_ID + ' {',
      '  background: #1b2027;',
      '  border: 1px solid #343b44;',
      '  border-radius: 10px;',
      '  padding: 16px;',
      '  margin-top: 16px;',
      '  color: #e6edf3;',
      '  direction: rtl;',
      '}',
      '#' + SECTION_ID + ' .nsl-head {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '  gap: 10px;',
      '  margin-bottom: 12px;',
      '}',
      '#' + SECTION_ID + ' .nsl-title {',
      '  margin: 0;',
      '  font-size: 18px;',
      '  color: #79c9eb;',
      '}',
      '#' + SECTION_ID + ' .nsl-sub {',
      '  margin: 2px 0 0;',
      '  font-size: 12px;',
      '  color: #9aa6b2;',
      '}',
      '#' + SECTION_ID + ' .nsl-actions {',
      '  display: flex;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '#' + SECTION_ID + ' .nsl-summary {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 8px;',
      '  padding: 10px 12px;',
      '  background: #14181d;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  margin-bottom: 12px;',
      '  align-items: center;',
      '}',
      '#' + SECTION_ID + ' .nsl-stat {',
      '  background: #1b2027;',
      '  border: 1px solid #343b44;',
      '  border-radius: 6px;',
      '  padding: 4px 10px;',
      '  font-size: 12px;',
      '  color: #d7e0ea;',
      '}',
      '#' + SECTION_ID + ' .nsl-stat strong {',
      '  color: #79c9eb;',
      '  margin-right: 4px;',
      '}',
      '#' + SECTION_ID + ' .nsl-stat-top {',
      '  border-color: #79c9eb;',
      '  background: rgba(121, 201, 235, 0.1);',
      '}',
      '#' + SECTION_ID + ' .nsl-filters {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 10px;',
      '  align-items: flex-end;',
      '  margin-bottom: 10px;',
      '}',
      '#' + SECTION_ID + ' .nsl-field {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 4px;',
      '  font-size: 12px;',
      '  color: #9aa6b2;',
      '}',
      '#' + SECTION_ID + ' .nsl-input {',
      '  background: #14181d;',
      '  color: #e6edf3;',
      '  border: 1px solid #343b44;',
      '  border-radius: 6px;',
      '  padding: 6px 10px;',
      '  font-size: 13px;',
      '  min-width: 150px;',
      '}',
      '#' + SECTION_ID + ' .nsl-input:focus {',
      '  outline: none;',
      '  border-color: #79c9eb;',
      '}',
      '#' + SECTION_ID + ' .nsl-chips {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 6px;',
      '  margin-bottom: 12px;',
      '}',
      '#' + SECTION_ID + ' .nsl-chip {',
      '  background: #14181d;',
      '  color: #b8c4d0;',
      '  border: 1px solid #343b44;',
      '  border-radius: 999px;',
      '  padding: 4px 10px;',
      '  font-size: 12px;',
      '  cursor: pointer;',
      '}',
      '#' + SECTION_ID + ' .nsl-chip.active {',
      '  background: rgba(121, 201, 235, 0.18);',
      '  border-color: #79c9eb;',
      '  color: #79c9eb;',
      '}',
      '#' + SECTION_ID + ' .nsl-table-wrap {',
      '  overflow-x: auto;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  background: #14181d;',
      '}',
      '#' + SECTION_ID + ' .nsl-table {',
      '  width: 100%;',
      '  border-collapse: collapse;',
      '  font-size: 13px;',
      '}',
      '#' + SECTION_ID + ' .nsl-table th,',
      '#' + SECTION_ID + ' .nsl-table td {',
      '  padding: 8px 10px;',
      '  border-bottom: 1px solid #262c35;',
      '  text-align: right;',
      '  vertical-align: top;',
      '}',
      '#' + SECTION_ID + ' .nsl-table th {',
      '  background: #1b2027;',
      '  color: #9aa6b2;',
      '  font-weight: 600;',
      '  white-space: nowrap;',
      '}',
      '#' + SECTION_ID + ' .nsl-time {',
      '  white-space: nowrap;',
      '  direction: ltr;',
      '  text-align: right;',
      '  color: #b8c4d0;',
      '  font-family: monospace;',
      '  font-size: 12px;',
      '}',
      '#' + SECTION_ID + ' .nsl-type-badge {',
      '  display: inline-block;',
      '  padding: 2px 8px;',
      '  border-radius: 6px;',
      '  font-size: 12px;',
      '  border: 1px solid #343b44;',
      '  background: #1b2027;',
      '  color: #e6edf3;',
      '  white-space: nowrap;',
      '}',
      '#' + SECTION_ID + ' .nsl-badge-warn {',
      '  display: inline-block;',
      '  margin-right: 6px;',
      '  padding: 2px 7px;',
      '  border-radius: 6px;',
      '  font-size: 11px;',
      '  font-weight: 600;',
      '  background: rgba(235, 95, 95, 0.2);',
      '  border: 1px solid #e06c75;',
      '  color: #ff9ca3;',
      '  white-space: nowrap;',
      '}',
      '#' + SECTION_ID + ' .nsl-approver {',
      '  display: block;',
      '  font-size: 11px;',
      '  color: #79c9eb;',
      '  margin-top: 2px;',
      '}',
      '#' + SECTION_ID + ' .nsl-amt {',
      '  white-space: nowrap;',
      '  font-weight: 600;',
      '}',
      '#' + SECTION_ID + ' .nsl-note {',
      '  margin-top: 8px;',
      '  font-size: 12px;',
      '  color: #f0c674;',
      '}',
      '#' + SECTION_ID + ' .nsl-empty {',
      '  padding: 20px;',
      '  text-align: center;',
      '  color: #9aa6b2;',
      '}',
      '#' + PRINT_HOST_ID + ' { display: none; }',
      '@media print {',
      '  body.' + PRINT_BODY_CLASS + ' > *:not(#' + PRINT_HOST_ID + ') {',
      '    display: none !important;',
      '  }',
      '  body.' + PRINT_BODY_CLASS + ' #' + PRINT_HOST_ID + ' {',
      '    display: block !important;',
      '    direction: rtl;',
      '    background: #ffffff;',
      '    color: #000000;',
      '    font-family: sans-serif;',
      '    padding: 12px;',
      '  }',
      '  #' + PRINT_HOST_ID + ' h2 { margin: 0 0 6px; font-size: 18px; }',
      '  #' + PRINT_HOST_ID + ' .nsl-print-meta { font-size: 12px; margin-bottom: 10px; color: #333; }',
      '  #' + PRINT_HOST_ID + ' table { width: 100%; border-collapse: collapse; font-size: 12px; }',
      '  #' + PRINT_HOST_ID + ' th, #' + PRINT_HOST_ID + ' td { border: 1px solid #999; padding: 6px 8px; text-align: right; vertical-align: top; }',
      '  #' + PRINT_HOST_ID + ' th { background: #eee; }',
      '}'
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  /* ---------- Printing ---------- */

  function cleanupPrint() {
    if (typeof activePrintCleanup === 'function') {
      var fn = activePrintCleanup;
      activePrintCleanup = null;
      fn();
    }
  }

  function printRows(rows, metaText) {
    cleanupPrint();

    var host = document.createElement('div');
    host.id = PRINT_HOST_ID;

    host.appendChild(el('h2', '', 'سجل العمليات الحساسة'));
    host.appendChild(el('div', 'nsl-print-meta', metaText));

    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var headers = ['الوقت', 'النوع', 'مين', 'التفاصيل', 'المبلغ'];
    for (var hi = 0; hi < headers.length; hi++) {
      hr.appendChild(el('th', '', headers[hi]));
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var shown = rows.slice(0, MAX_ROWS);
    for (var i = 0; i < shown.length; i++) {
      var r = shown[i];
      var tr = document.createElement('tr');
      tr.appendChild(el('td', '', fmtDateTime(r.at)));
      tr.appendChild(el('td', '', r.typeLabel + (r.badge ? ' — ' + r.badge : '')));
      var whoText = (r.who || '—') + (r.approver ? ' (اعتماد: ' + r.approver + ')' : '');
      tr.appendChild(el('td', '', whoText));
      tr.appendChild(el('td', '', r.details || '—'));
      tr.appendChild(el('td', '', r.amount !== null ? fmtMoney(r.amount) : '—'));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);

    document.body.appendChild(host);
    document.body.classList.add(PRINT_BODY_CLASS);

    var timerId = null;
    function teardown() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove(PRINT_BODY_CLASS);
      var existing = document.getElementById(PRINT_HOST_ID);
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      activePrintCleanup = null;
    }

    function onAfterPrint() {
      teardown();
    }

    activePrintCleanup = teardown;
    window.addEventListener('afterprint', onAfterPrint);
    timerId = setTimeout(teardown, PRINT_TIMEOUT_MS);

    try {
      window.print();
    } catch (e) {
      teardown();
    }
  }

  /* ---------- UI Rendering ---------- */

  function buildSectionElement() {
    var now = Date.now();
    var sdate = new Date(now); sdate.setDate(sdate.getDate() - 6); var sevenDaysAgo = sdate.getTime();

    var state = {
      fromStr: fmtDateInput(sevenDaysAgo),
      toStr: fmtDateInput(now),
      selectedTypes: {},
      personQuery: ''
    };

    var section = el('section', 'nova-sensitive-log');
    section.id = SECTION_ID;

    /* Header */
    var head = el('div', 'nsl-head');
    var titleWrap = el('div', '');
    titleWrap.appendChild(el('h3', 'nsl-title', 'سجل العمليات الحساسة'));
    titleWrap.appendChild(el('p', 'nsl-sub', 'مين عمل إيه وإمتى — متابعة ضد التلاعب'));
    head.appendChild(titleWrap);

    var actions = el('div', 'nsl-actions');
    var refreshBtn = el('button', 'btn btn-secondary', 'تحديث');
    refreshBtn.type = 'button';
    var printBtn = el('button', 'btn btn-primary', 'طباعة السجل');
    printBtn.type = 'button';
    actions.appendChild(refreshBtn);
    actions.appendChild(printBtn);
    head.appendChild(actions);
    section.appendChild(head);

    /* Summary Strip */
    var summaryEl = el('div', 'nsl-summary');
    summaryEl.setAttribute('data-role', 'summary');
    section.appendChild(summaryEl);

    /* Filters */
    var filtersRow = el('div', 'nsl-filters');

    var fromField = el('label', 'nsl-field');
    fromField.appendChild(el('span', '', 'من تاريخ'));
    var fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.className = 'nsl-input';
    fromInput.setAttribute('data-filter', 'from');
    fromInput.value = state.fromStr;
    fromField.appendChild(fromInput);
    filtersRow.appendChild(fromField);

    var toField = el('label', 'nsl-field');
    toField.appendChild(el('span', '', 'إلى تاريخ'));
    var toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.className = 'nsl-input';
    toInput.setAttribute('data-filter', 'to');
    toInput.value = state.toStr;
    toField.appendChild(toInput);
    filtersRow.appendChild(toField);

    var personField = el('label', 'nsl-field');
    personField.appendChild(el('span', '', 'الشخص (منفّذ أو معتمد)'));
    var personInput = document.createElement('input');
    personInput.type = 'text';
    personInput.className = 'nsl-input';
    personInput.setAttribute('data-filter', 'person');
    personInput.placeholder = 'اكتب جزء من الاسم...';
    personField.appendChild(personInput);
    filtersRow.appendChild(personField);

    section.appendChild(filtersRow);

    /* Type Chips */
    var chipsWrap = el('div', 'nsl-chips');
    chipsWrap.setAttribute('data-role', 'type-chips');

    var allChip = el('button', 'nsl-chip active', 'الكل');
    allChip.type = 'button';
    allChip.setAttribute('data-type', 'all');
    chipsWrap.appendChild(allChip);

    var typeChips = {};
    for (var i = 0; i < TYPES.length; i++) {
      (function (t) {
        var chip = el('button', 'nsl-chip', t.label);
        chip.type = 'button';
        chip.setAttribute('data-type', t.key);
        chip.addEventListener('click', function () {
          if (state.selectedTypes[t.key]) {
            delete state.selectedTypes[t.key];
          } else {
            state.selectedTypes[t.key] = true;
          }
          syncChips();
          render();
        });
        typeChips[t.key] = chip;
        chipsWrap.appendChild(chip);
      })(TYPES[i]);
    }

    allChip.addEventListener('click', function () {
      state.selectedTypes = {};
      syncChips();
      render();
    });

    section.appendChild(chipsWrap);

    /* Table */
    var tableWrap = el('div', 'nsl-table-wrap');
    var table = el('table', 'nsl-table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var cols = ['الوقت', 'النوع', 'مين', 'التفاصيل', 'المبلغ'];
    for (var ci = 0; ci < cols.length; ci++) {
      headerRow.appendChild(el('th', '', cols[ci]));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    tbody.setAttribute('data-role', 'rows');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);

    var noteEl = el('div', 'nsl-note');
    noteEl.setAttribute('data-role', 'limit-note');
    section.appendChild(noteEl);

    function syncChips() {
      var keys = Object.keys(state.selectedTypes);
      var anySelected = keys.length > 0;
      allChip.setAttribute('aria-pressed', anySelected ? 'false' : 'true');
      if (anySelected) {
        allChip.classList.remove('active');
      } else {
        allChip.classList.add('active');
      }
      for (var k in typeChips) {
        if (Object.prototype.hasOwnProperty.call(typeChips, k)) {
          typeChips[k].setAttribute('aria-pressed', state.selectedTypes[k] ? 'true' : 'false');
          if (state.selectedTypes[k]) {
            typeChips[k].classList.add('active');
          } else {
            typeChips[k].classList.remove('active');
          }
        }
      }
    }

    var lastFilteredRows = [];

    function renderSummary(rangeRows) {
      summaryEl.textContent = '';

      var totalStat = el('div', 'nsl-stat');
      totalStat.appendChild(document.createTextNode('إجمالي الفترة: '));
      totalStat.appendChild(el('strong', '', fmtNumber(rangeRows.length, 0)));
      summaryEl.appendChild(totalStat);

      var countsByType = {};
      var cancelCountsByPerson = {};

      for (var i = 0; i < rangeRows.length; i++) {
        var r = rangeRows[i];
        countsByType[r.type] = (countsByType[r.type] || 0) + 1;
        if (r.type === 'cancel' || r.type === 'return') {
          var pKey = r.who || 'غير محدد';
          cancelCountsByPerson[pKey] = (cancelCountsByPerson[pKey] || 0) + 1;
        }
      }

      var topPerson = '';
      var topCount = 0;
      for (var p in cancelCountsByPerson) {
        if (Object.prototype.hasOwnProperty.call(cancelCountsByPerson, p)) {
          if (cancelCountsByPerson[p] > topCount) {
            topCount = cancelCountsByPerson[p];
            topPerson = p;
          }
        }
      }

      var topStat = el('div', 'nsl-stat nsl-stat-top');
      topStat.appendChild(document.createTextNode('أكتر حد عمل إلغاءات/مرتجعات: '));
      topStat.appendChild(
        el('strong', '', topCount > 0 ? topPerson + ' (' + fmtNumber(topCount, 0) + ')' : 'لا يوجد')
      );
      summaryEl.appendChild(topStat);

      for (var ti2 = 0; ti2 < TYPES.length; ti2++) {
        var tKey = TYPES[ti2].key;
        var cnt = countsByType[tKey] || 0;
        if (cnt > 0) {
          var st = el('div', 'nsl-stat');
          st.appendChild(document.createTextNode(TYPES[ti2].label + ': '));
          st.appendChild(el('strong', '', fmtNumber(cnt, 0)));
          summaryEl.appendChild(st);
        }
      }
    }

    function render() {
      var fromMs = parseDateInputStart(state.fromStr);
      var toMs = parseDateInputEnd(state.toStr);
      var rangeRows = buildRows(fromMs, toMs);

      renderSummary(rangeRows);

      var selectedKeys = Object.keys(state.selectedTypes);
      var filterByType = selectedKeys.length > 0;
      var q = normalizeText(state.personQuery);

      var filtered = [];
      for (var i = 0; i < rangeRows.length; i++) {
        var row = rangeRows[i];
        if (filterByType && !state.selectedTypes[row.type]) {
          continue;
        }
        if (q) {
          var haystack = normalizeText(row.who + ' ' + row.approver);
          if (haystack.indexOf(q) === -1) {
            continue;
          }
        }
        filtered.push(row);
      }

      lastFilteredRows = filtered;
      tbody.textContent = '';

      if (!filtered.length) {
        var emptyTr = document.createElement('tr');
        var emptyTd = el('td', 'nsl-empty', 'مفيش عمليات حساسة مطابقة للفلاتر دي.');
        emptyTd.colSpan = 5;
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
        noteEl.textContent = '';
        return;
      }

      var shown = filtered.slice(0, MAX_ROWS);
      for (var si = 0; si < shown.length; si++) {
        var item = shown[si];
        var tr = document.createElement('tr');
        tr.setAttribute('data-type', item.type);

        tr.appendChild(el('td', 'nsl-time', fmtDateTime(item.at)));

        var typeTd = document.createElement('td');
        typeTd.appendChild(el('span', 'nsl-type-badge', item.typeLabel));
        if (item.badge) {
          typeTd.appendChild(el('span', 'nsl-badge-warn', item.badge));
        }
        tr.appendChild(typeTd);

        var whoTd = document.createElement('td');
        whoTd.appendChild(el('span', '', item.who || '—'));
        if (item.approver) {
          whoTd.appendChild(el('span', 'nsl-approver', 'اعتماد: ' + item.approver));
        }
        tr.appendChild(whoTd);

        tr.appendChild(el('td', '', item.details || '—'));
        tr.appendChild(el('td', 'nsl-amt', item.amount !== null ? fmtMoney(item.amount) : '—'));

        tbody.appendChild(tr);
      }

      if (filtered.length > MAX_ROWS) {
        noteEl.textContent =
          'معروض أحدث ' +
          fmtNumber(MAX_ROWS, 0) +
          ' عملية من أصل ' +
          fmtNumber(filtered.length, 0) +
          ' عملية — ضيّق الفترة أو الفلاتر عشان تشوف الباقي.';
      } else {
        noteEl.textContent = '';
      }
    }

    fromInput.addEventListener('change', function () {
      state.fromStr = fromInput.value;
      render();
    });

    toInput.addEventListener('change', function () {
      state.toStr = toInput.value;
      render();
    });

    personInput.addEventListener('input', function () {
      state.personQuery = personInput.value;
      render();
    });

    refreshBtn.addEventListener('click', function () {
      render();
    });

    printBtn.addEventListener('click', function () {
      var meta =
        'الفترة: ' + (state.fromStr || '—') + ' إلى ' + (state.toStr || '—') +
        ' | عدد العمليات: ' + (lastFilteredRows.length > MAX_ROWS ? fmtNumber(MAX_ROWS, 0) + ' من أصل ' + fmtNumber(lastFilteredRows.length, 0) + ' (الأحدث فقط)' : fmtNumber(lastFilteredRows.length, 0)) +
        ' | وقت الطباعة: ' + fmtDateTime(Date.now());
      printRows(lastFilteredRows, meta);
    });

    render();
    return section;
  }

  /* ---------- Mounting & Observer ---------- */

  function mountIfReportsActive() {
    var activeReportsTab = document.querySelector('.nova-tab.active[data-page="reports"]');
    if (!activeReportsTab) {
      return;
    }
    var pageView = document.getElementById('novaPageView');
    if (!pageView) {
      return;
    }
    if (pageView.querySelector('#' + SECTION_ID)) {
      return;
    }
    injectStyles();
    pageView.appendChild(buildSectionElement());
  }

  function init() {
    window.novaSensitiveLog = {
      build: buildRows
    };

    mountIfReportsActive();

    if (observerAttached) {
      return;
    }
    var pageView = document.getElementById('novaPageView');
    if (pageView && typeof MutationObserver !== 'undefined') {
      observerAttached = true;
      var obs = new MutationObserver(function () {
        mountIfReportsActive();
      });
      obs.observe(pageView, { childList: true });
    }
  }

  init();
})();