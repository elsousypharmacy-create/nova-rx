/* N29 / BUY-05 UI: local purchase orders + receiving (GRN). On-device only; never contacts a supplier.
   Every state change asks the person to confirm (window.confirm) and passes {confirmed:true} to the store. */
(function () {
  'use strict';
  var PO = window.NovaPurchaseOrders, L = window.NovaStockLedger;
  var ledger = L.createLedger(localStorage), store = PO.createStore(localStorage, ledger);
  var AR = { draft: 'مسودة', sent: 'مُرسل', accepted: 'مقبول', partial: 'استلام جزئي', received: 'تم الاستلام', cancelled: 'ملغي' };
  var ERR = { 'confirmation-required': 'يلزم التأكيد', 'bad-transition': 'الإجراء غير متاح في هذه الحالة', 'bad-lot': 'رقم التشغيلة مطلوب', 'bad-expiry': 'تاريخ الصلاحية غير صحيح (YYYY-MM-DD)', 'bad-qty': 'الكمية غير صحيحة', 'bad-cost': 'التكلفة غير صحيحة', 'duplicate-grn': 'رقم الاستلام مستخدم', 'has-receipts': 'لا يمكن الإلغاء بعد الاستلام', 'missing-ref': 'رقم الاستلام مطلوب', 'no-lines': 'لا توجد أصناف', 'bad-supplier': 'المورد مطلوب', 'duplicate-line': 'صنف مكرر', 'duplicate-lot-line': 'تشغيلة مكررة في نفس الاستلام' };
  var WARN = { expired: 'منتهي الصلاحية', 'short-expiry': 'صلاحية أقل من 90 يومًا', unordered: 'صنف غير مطلوب في أمر الشراء', 'over-receipt': 'استلام أكثر من المطلوب', 'cost-differs': 'التكلفة تختلف عن أمر الشراء', 'invoice-vs-grn': 'كمية الفاتورة تختلف عن المستلم', 'invoice-vs-po': 'كمية الفاتورة أكبر من أمر الشراء' };
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function say(m) { $('poStatus').textContent = m; }
  function err(e) { say(ERR[e.code] || ('خطأ: ' + (e.code || e.message))); }
  function lines(id) { return $(id).value.split('\n').map(function (s) { return s.split(',').map(function (x) { return x.trim(); }); }).filter(function (a) { return a.length > 1 || a[0]; }); }
  function act(label, fn) { var b = el('button', label, 'row-action'); b.type = 'button'; b.onclick = function () { if (!window.confirm(label + '؟')) return; try { fn(); say('تم'); } catch (e) { err(e); } render(); }; return b; }
  function render() {
    var box = $('poList'); box.textContent = '';
    var all = store.list(); if (!all.length) box.appendChild(el('p', 'لا توجد أوامر شراء محلية', 'hint'));
    all.forEach(function (po) {
      var d = el('div', null, 'offer'); d.setAttribute('data-po', po.id); d.setAttribute('data-state', po.state);
      d.appendChild(el('h3', po.id + ' — ' + po.supplier + ' — ' + AR[po.state]));
      po.lines.forEach(function (l) { d.appendChild(el('p', l.code + ' ' + l.name + ' | مطلوب ' + l.qty + ' | مستلم ' + l.received + ' | تكلفة ' + l.cost)); });
      po.grns.forEach(function (g) { g.warnings.forEach(function (w) { d.appendChild(el('p', '⚠ ' + g.ref + ': ' + (WARN[w.type] || w.type) + ' ' + w.code, 'warning')); }); });
      var C = { confirmed: true };
      if (po.state === 'draft') d.appendChild(act('إرسال', function () { store.send(po.id, C); }));
      if (po.state === 'sent') d.appendChild(act('قبول المورد', function () { store.accept(po.id, C); }));
      if (['draft', 'sent', 'accepted'].indexOf(po.state) >= 0 && !po.grns.length) d.appendChild(act('إلغاء', function () { store.cancel(po.id, C); }));
      if (['sent', 'accepted', 'partial'].indexOf(po.state) >= 0) { var r = el('button', 'استلام', 'row-action'); r.type = 'button'; r.onclick = function () { $('grnPo').value = po.id; $('grnRef').focus(); }; d.appendChild(r); }
      box.appendChild(d);
    });
  }
  $('poCreate').onclick = function () {
    try {
      store.create({ supplier: $('poSupplier').value.trim(), lines: lines('poLines').map(function (a) { return { code: a[0], name: a[3] || '', qty: Number(a[1]), cost: Number(a[2]) }; }) });
      $('poLines').value = ''; say('تم إنشاء مسودة (لم يُرسل شيء للمورد)');
    } catch (e) { err(e); } render();
  };
  $('grnSave').onclick = function () {
    var id = $('grnPo').value.trim();
    if (!window.confirm('تأكيد استلام البضاعة وإضافتها للمخزون؟')) return;
    try {
      var inv = {}; lines('grnInvoice').forEach(function (a) { inv[a[0]] = Number(a[1]); });
      var r = store.receive(id, { ref: $('grnRef').value.trim(), invoice: { qty: inv }, lines: lines('grnLines').map(function (a) { return { code: a[0], lot: a[1], expiry: a[2], qty: Number(a[3]), cost: Number(a[4]) }; }) }, { confirmed: true });
      say(r.warnings.length ? 'تم الاستلام مع ' + r.warnings.length + ' تنبيه' : 'تم الاستلام'); $('grnLines').value = '';
    } catch (e) { err(e); } render();
  };
  $('openPo').onclick = function () { render(); $('poDialog').showModal(); };
  $('closePo').onclick = function () { $('poDialog').close(); };
  window.novaPurchaseOrders = { store: store, ledger: ledger, render: render };
})();
