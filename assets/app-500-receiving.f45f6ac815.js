
/* UX-P30 receiving page (العمليات › استلام الطلبيات). On-device only: stock goes in through window.novaStock.addLot (same path as manual receive);
   a local receipts log (nova-rx-receipts-v1) keeps supplier / invoice / lines. Pending orders are read from the local PO store (nova.purchase.orders). Nothing is sent to any supplier. */
(function () {
  'use strict';
  var RK = 'nova-rx-receipts-v1', POK = 'nova.purchase.orders';
  var SUPPLIERS = ['أوميت', 'فارما أوفرسيز'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function read(k) { const a = JSON.parse(window.NovaReceiptOperations.readRaw(localStorage, k) || '[]'); if (!Array.isArray(a)) throw new Error('invalid-store'); return a; }
  function receipts() { return read(RK).filter(function (r) { return r && Array.isArray(r.lines); }); }
  function saveReceipt(receipt) {
    const rows = JSON.parse(localStorage.getItem(RK) || '[]');
    if (!Array.isArray(rows)) throw new Error('invalid-receipt-store');
    const index = rows.findIndex(row => row?.id === receipt.id);
    if (index < 0) rows.push(receipt);
    else rows[index] = receipt;
    localStorage.setItem(RK, JSON.stringify(rows));
  }
  function appliedCount(receipt) {
    try {
      return receipt.lines.filter((line, index) => window.novaStock.hasReceiptLine(receipt.id + '/' + index)).length;
    } catch (_) { return 0; }
  }
  function applyReceipt(receipt) {
    const lines = receipt.lines;
    let poResult, grn;
    if (receipt.poId) {
      const ledger = window.NovaStockLedger.createLedger(localStorage, 'nova.stock.ledger');
      const retryLedger = {
        append(movement) {
          const prior = ledger.movements(movement.code).find(m =>
            m.kind === movement.kind && m.ref === movement.ref && m.lot === movement.lot);
          if (!prior) return ledger.append(movement);
          if (prior.qty !== movement.qty || prior.expiry !== movement.expiry || prior.cost !== movement.cost) {
            throw new Error('receipt-movement-conflict');
          }
          return prior;
        }
      };
      const store = window.NovaPurchaseOrders.createStore(localStorage, retryLedger);
      grn = { ref: receipt.invoice, lines: lines.map(({ code, lot, expiry, qty, cost }) => ({ code, lot, expiry, qty, cost })) };
      const po = store.get(receipt.poId);
      const prior = po.grns.find(entry => entry.ref === grn.ref);
      if (prior && JSON.stringify(prior.lines) !== JSON.stringify(grn.lines)) throw new Error('receipt-conflict');
      poResult = prior ? { po, warnings: prior.warnings || [] } : store.receive(receipt.poId, grn, { confirmed: true, by: receipt.by });
    }
    for (const [index, line] of lines.entries()) {
      if (!window.novaStock.addLot(line, receipt.id + '/' + index)?.ok) throw new Error('stock-save-failed');
    }
    const finished = { ...receipt, pending: false, poState: poResult?.po.state || null,
      warnings: (poResult?.warnings || []).map(warning => warning.type) };
    saveReceipt(finished);
    if (poResult) {
      try { window.novaReceiptSync?.afterReceive(poResult.po, grn); } catch (_) {}
    }
  }
  function pendingPOs() { return read(POK).filter(function (p) { return p && Array.isArray(p.lines) && ['sent', 'accepted', 'partial'].indexOf(p.state) >= 0; }); }
  function boxes(r) { return window.NovaReceiptOperations.effectiveLines(r).reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0); }
  // RCV-BONUS: a bonus line keeps qty = paid + bonus (stock); money uses paid x invoice price while the line is uncorrected
  function hasBonus(l) { return l.bonus > 0 && l.paidQty != null && l.qty === l.paidQty + l.bonus; }
  function lineMoney(l) { return hasBonus(l) && l.invoiceCost != null ? (Number(l.paidQty) || 0) * (Number(l.invoiceCost) || 0) : (Number(l.qty) || 0) * (Number(l.cost) || 0); }
  function qtyLabel(l) { return hasBonus(l) ? l.paidQty + ' + ' + l.bonus + ' بونص' : l.qty + ' علبة'; }
  function total(r) { return window.NovaReceiptOperations.effectiveLines(r).reduce(function (s, l) { return s + lineMoney(l); }, 0); }
  function nItems(n) { return n === 1 ? 'صنف واحد' : n === 2 ? 'صنفين' : n + (n >= 3 && n <= 10 ? ' أصناف' : ' صنف'); }
  function disp(name) { return window.novaDispName ? window.novaDispName(name) : String(name || ''); }
  var AR_M = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function fmtDate(s) {
    if (!s) return '—';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s).trim());
    if (m && +m[2] >= 1 && +m[2] <= 12) return +m[3] + ' ' + AR_M[+m[2] - 1] + ' ' + +m[1];
    var d = new Date(s);
    return !isNaN(d.getTime()) ? d.getUTCDate() + ' ' + AR_M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : String(s);
  }
  function toast(m) { if (typeof window.novaToast === 'function') window.novaToast(m); }
  var I = {
    cam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    truck: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  const receiptOps = window.NovaReceiptOperations;
  function reviewTable(po, lines) {
    const rows = receiptOps.review(po, lines.map(line => line.paidQty != null ? { ...line, qty: line.paidQty, cost: line.invoiceCost != null ? line.invoiceCost : line.cost } : line));
    if (!rows.length) return '';
    return '<h3>مراجعة الاستلام</h3><div class="rcv-review-scroll"><table><thead><tr>' +
      ['الصنف', 'المطلوب', 'سبق استلامه', 'الواصل الآن', 'الباقي', 'الزيادة', 'سعر الشراء'].map(label => '<th>' + label + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(row => '<tr' + (row.excess || row.unordered || row.costChanged ? ' class="rcv-difference"' : '') + '><td>' + esc(disp(row.name)) +
        (row.unordered ? '<small>خارج الطلبية</small>' : '') + '</td><td data-label="المطلوب">' + (row.ordered ?? '—') + '</td><td data-label="سبق استلامه">' + row.prior + '</td><td data-label="الواصل الآن">' + row.quantity +
        '</td><td data-label="الباقي">' + (row.remaining ?? '—') + '</td><td data-label="الزيادة">' + row.excess + '</td><td data-label="سعر الشراء">' + row.costs.map(money).join(' / ') +
        (row.costChanged ? '<small>سعر الطلبية ' + money(row.expectedCost) + '</small>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function modal(title, content) {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'rcv-ov'; overlay.dir = 'rtl';
    overlay.innerHTML = '<div class="rcv-dlg rcv-controls" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="rcv-dlg-h"><h2>' + esc(title) + '</h2><button type="button" class="rcv-x" aria-label="إغلاق" data-control-close>×</button></div>' +
      '<div class="rcv-control-body">' + content + '</div></div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus(); }
    function onKey(event) {
      if (!overlay.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll('button,input,textarea,a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    overlay.querySelector('[data-control-close]').onclick = close;
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('button').focus();
    return { overlay, close };
  }
  function actionActor(action) {
    const actor = window.novaAuth?.current();
    if (!actor || !window.novaPerms?.require(action)) throw new Error('permission');
    return actor;
  }
  const controlErrors = {
    permission: 'سجل دخول مستخدم لديه صلاحية الإجراء من الإعدادات.',
    'reason-required': 'اكتب سبب التعديل.', 'bad-qty': 'اكتب كميات صحيحة أكبر من أو تساوي صفر.',
    'no-changes': 'لم تتغير أي كمية.', 'stock-reserved': 'الصنف محجوز في فاتورة بيع. أكملها أو ألغها أولًا.',
    'insufficient-stock': 'الكمية المتبقية لا تسمح بالتصحيح بعد حركات البيع أو التحويل.',
    'receipt-changed': 'الفاتورة اتعدلت من شاشة أخرى. افتح التصحيح من جديد.',
    'po-changed': 'الطلبية اتغيرت. افتح تفاصيلها من جديد.',
    'receipt-unavailable': 'أكمل حفظ الاستلام قبل التصحيح.', 'bad-transition': 'حالة الطلبية اتغيرت. افتحها من جديد.',
    'pending-receipt': 'أكمل الاستلام المتوقف قبل إلغاء الكمية الباقية.'
  };
  function errorText(error) { return controlErrors[error.code || error.message] || 'تعذر إكمال الحفظ. أعد المحاولة لاستكمال نفس العملية.'; }
  function receiptActions(receipt) {
    return '<div class="rcv-actions rcv-receipt-actions">' +
      (receipt.poId ? '<button type="button" class="rcv-btn sm" data-rcv-order="' + esc(receipt.poId) + '">الطلبية الأصلية</button>' : '') +
      '<button type="button" class="rcv-btn sm" data-rcv-moves="' + esc(receipt.id) + '">حركة المخزون وسجل التعديل</button>' +
      '<button type="button" class="rcv-btn sm" data-rcv-correct="' + esc(receipt.id) + '">تصحيح الكميات</button></div>';
  }
  function openCorrection(id) {
    const receipt = receipts().find(row => row.id === id && !row.pending);
    if (!receipt) return;
    const lines = receiptOps.effectiveLines(receipt);
    const view = modal('تصحيح كميات الفاتورة ' + receipt.invoice,
      '<p>راجع الكميات الصحيحة. سيتم تسجيل حركة فرق مرتبطة بالفاتورة.</p><div class="rcv-review-scroll"><table><thead><tr><th>الصنف</th><th>الصلاحية</th><th>الكمية الحالية</th><th>الكمية الصحيحة</th><th>الفرق</th></tr></thead><tbody>' +
      lines.map((line, index) => '<tr><td>' + esc(disp(line.name)) + '</td><td dir="ltr" data-label="الصلاحية">' + esc(line.expiry) + '</td><td data-label="الكمية الحالية">' + line.qty +
        '</td><td data-label="الكمية الصحيحة"><input type="number" min="0" step="1" data-correct-index="' + index + '" value="' + line.qty + '" aria-label="الكمية الصحيحة ' + esc(disp(line.name)) + '"></td><td data-label="الفرق" data-correct-delta="' + index + '">0</td></tr>').join('') +
      '</tbody></table></div><label class="rcv-control-label">سبب التصحيح<textarea id="rcvCorrectionReason" maxlength="500" required></textarea></label>' +
      '<p id="rcvCorrectionError" role="alert"></p><button type="button" class="rcv-btn primary" id="rcvCorrectionSave">مراجعة وتأكيد التصحيح</button>');
    const inputs = [...view.overlay.querySelectorAll('[data-correct-index]')];
    inputs.forEach((input, index) => input.oninput = () => { view.overlay.querySelector('[data-correct-delta="' + index + '"]').textContent = Number(input.value) - lines[index].qty; });
    const operationId = window.novaStock.newKey();
    const save = view.overlay.querySelector('#rcvCorrectionSave');
    let request = null;
    save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        const actor = actionActor('stock.adjust');
        if (!request) {
          if (inputs.some(input => input.value.trim() === '')) throw new Error('bad-qty');
          const reason = view.overlay.querySelector('#rcvCorrectionReason').value.trim();
          if (!reason) throw new Error('reason-required');
          if (!window.confirm('تأكيد تسجيل فرق الكميات على المخزون؟')) return;
          request = { id: operationId, receiptId: id, version: (receipt.corrections || []).length,
            quantities: inputs.map(input => Number(input.value)), reason };
        }
        await window.novaStock.withLock(() => receiptOps.correct(localStorage, request, {
          actor: actionActor('stock.adjust'), allowed: window.novaPerms.require('stock.adjust'),
          available: (key, lot, expiry) => window.novaStock.lots(key).find(row => row.lot === lot && row.expiry === expiry)?.onHand || 0,
          hasHold: key => window.novaStock.holds().some(row => row.key === key)
        }));
        view.close(); render(); openMovements(id); toast('تم تسجيل تصحيح الاستلام');
      } catch (error) {
        // A persisted journal owns the submitted values until recovery completes.
        if (!localStorage.getItem(receiptOps.KEYS.journal)) request = null;
        view.overlay.querySelector('#rcvCorrectionError').textContent = errorText(error);
      } finally { save.disabled = false; }
    };
  }
  function openMovements(id) {
    const receipt = receipts().find(row => row.id === id);
    if (!receipt) return;
    const original = receipt.lines.map(line => '<tr><td>' + esc(disp(line.name)) + '</td><td data-label="الكمية المضافة">' + (hasBonus(line) ? line.paidQty + ' + ' + line.bonus + ' بونص' : line.qty) + '</td><td data-label="الصلاحية">' + esc(line.expiry) + '</td><td data-label="سعر الشراء">' + money(line.cost) + '</td></tr>').join('');
    modal('حركة المخزون · فاتورة ' + receipt.invoice,
      '<p>' + esc(receipt.supplier) + ' · ' + fmtDate(receipt.date) + (receipt.poId ? ' · ' + esc(receipt.poId) : '') + '</p>' +
      '<h3>الاستلام الأصلي</h3><div class="rcv-review-scroll"><table><thead><tr><th>الصنف</th><th>الكمية المضافة</th><th>الصلاحية</th><th>سعر الشراء</th></tr></thead><tbody>' + original + '</tbody></table></div>' +
      '<h3>التصحيحات</h3>' + ((receipt.corrections || []).map(correction => '<section class="rcv-audit"><b>' + esc(correction.by.name) + '</b> · <time dir="ltr">' + esc(correction.at) + '</time><p>' + esc(correction.reason) + '</p>' +
        correction.changes.map(change => '<p>' + esc(disp(receipt.lines[change.index].name)) + ' · ' + change.before + ' ← ' + change.after + ' · فرق المخزون <b dir="ltr">' + (change.delta > 0 ? '+' : '') + change.delta + '</b></p>').join('') + '</section>').join('') || '<p>لا توجد تصحيحات.</p>'));
  }
  function openOrder(id) {
    const po = read(POK).find(row => row.id === id);
    if (!po) return;
    const related = receipts().filter(receipt => receipt.poId === id);
    const view = modal('الطلبية ' + po.id,
      '<p>' + esc(po.supplier) + '</p><div class="rcv-review-scroll"><table><thead><tr><th>الصنف</th><th>المطلوب</th><th>المستلم</th><th>المنتظر</th><th>ملغي من الباقي</th></tr></thead><tbody>' +
      po.lines.map(line => '<tr><td>' + esc(disp(line.name || line.code)) + '</td><td data-label="المطلوب">' + line.qty + '</td><td data-label="المستلم">' + line.received + '</td><td data-label="المنتظر">' + Math.max(0, line.qty - line.received - (line.cancelledQty || 0)) + '</td><td data-label="ملغي من الباقي">' + (line.cancelledQty || 0) + '</td></tr>').join('') +
      '</tbody></table></div><h3>فواتير الاستلام</h3>' + (related.map(receipt => '<button type="button" class="rcv-btn" data-open-receipt="' + esc(receipt.id) + '">' + esc(receipt.invoice) + (receipt.pending ? ' · يحتاج استكمال' : '') + '</button>').join('') || '<p>لم يتم الاستلام بعد.</p>') +
      (po.state === 'partial' ? '<p>الكمية الناقصة ما زالت منتظرة.</p><button type="button" class="rcv-btn" data-rcv-close-rest="' + esc(po.id) + '">إلغاء الكمية الباقية</button>' : '') +
      (po.closure ? '<p class="rcv-audit">تم إنهاء الطلبية مع إلغاء الباقي · ' + esc(po.closure.reason) + ' · ' + esc(po.closure.by) + ' · ' + esc(po.closure.at) + '</p>' : ''));
    const closeRest = view.overlay.querySelector('[data-rcv-close-rest]');
    if (closeRest) closeRest.onclick = event => { event.stopPropagation(); view.close(); closeRemaining(id); };
    view.overlay.querySelectorAll('[data-open-receipt]').forEach(button => button.onclick = () => {
      view.close(); render();
      const row = document.getElementById('rcv-' + button.dataset.openReceipt);
      if (row) { row.open = true; row.scrollIntoView({ block: 'center' }); row.querySelector('summary').focus(); }
      else { const receipt = related.find(row => row.id === button.dataset.openReceipt); if (receipt?.pending) openForm(receipt); else openMovements(button.dataset.openReceipt); }
    });
  }
  function closeRemaining(id) {
    const po = read(POK).find(row => row.id === id);
    if (!po) return;
    const view = modal('إلغاء الكمية الباقية من ' + id,
      '<label class="rcv-control-label">سبب إلغاء الباقي<textarea id="rcvCloseReason" maxlength="500" required></textarea></label>' +
      '<p id="rcvCloseError" role="alert"></p><button type="button" class="rcv-btn primary" id="rcvCloseSave">تأكيد إلغاء الباقي</button>');
    const operationId = window.novaStock.newKey(), save = view.overlay.querySelector('#rcvCloseSave');
    save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        const actor = actionActor('purchases.manage');
        const reason = view.overlay.querySelector('#rcvCloseReason').value.trim();
        if (!reason) throw new Error('reason-required');
        if (!window.confirm('تأكيد إنهاء الطلبية وإلغاء الكمية التي لم تصل؟')) return;
        await window.novaStock.withLock(() => {
          const currentActor = actionActor('purchases.manage');
          if (receipts().some(row => row.poId === id && row.pending)) throw new Error('pending-receipt');
          const store = window.NovaPurchaseOrders.createStore(localStorage, window.NovaStockLedger.createLedger(localStorage));
          store.closeRemaining(id, { id: operationId, reason, version: po.history.length }, { confirmed: true, by: currentActor.id });
        });
        view.close(); render(); toast('تم إنهاء الطلبية وإلغاء الباقي');
      } catch (error) { view.overlay.querySelector('#rcvCloseError').textContent = errorText(error); }
      finally { save.disabled = false; }
    };
  }

  var host = null;
  function render(view) {
    host = view || host;
    try { return renderContent(host); }
    catch (_) {
      if (host) host.innerHTML = '<div class="rcv"><p role="alert">تعذر قراءة بيانات الاستلام. راجع مساحة التخزين ثم أعد المحاولة.</p><button type="button" class="rcv-btn" data-rcv="retry">إعادة المحاولة</button></div>';
    }
  }
  function renderContent(view) {
    host = view || host; if (!host) return;
    var receiptsList = receipts().slice().reverse(), all = receiptsList.filter(r => !r.pending), pending = receiptsList.filter(r => r.pending), pos = pendingPOs(), t = today();
    var todays = all.filter(function (r) { return String(r.at || '').slice(0, 10) === t; });
    var month = all.filter(function (r) { return String(r.date || r.at || '').slice(0, 7) === t.slice(0, 7); });
    var h = '<div class="rcv">'
      + '<div class="nova-page-header rcv-head"><div><h1>استلام الطلبيات</h1><p>استلم فاتورة المورد وأضفها للمخزون بالتشغيلة والصلاحية.</p></div>'
      + '<div class="rcv-actions"><button type="button" class="rcv-btn" data-rcv="photo">' + I.cam + 'قراءة فاتورة بالصورة</button><button type="button" class="rcv-btn primary" data-rcv="new">' + I.plus + 'استلام فاتورة</button></div></div>'
      + '<div class="rcv-kpis">'
      + '<div class="rcv-kpi"><small>استلامات النهارده</small><strong>' + todays.length + '</strong><span>' + (todays.length ? todays.reduce(function (s, r) { return s + boxes(r); }, 0) + ' علبة' : 'لسه مفيش') + '</span></div>'
      + '<div class="rcv-kpi"><small>طلبيات مستنية</small><strong>' + pos.length + '</strong><span>من صفحة المشتريات</span></div>'
      + '<div class="rcv-kpi"><small>استلامات الشهر</small><strong>' + money(month.reduce(function (s, r) { return s + total(r); }, 0)) + '</strong><span>' + month.length + ' فاتورة</span></div>'
      + '</div>';
    h += '<section class="rcv-sec"><div class="rcv-sec-h"><h2>طلبيات مستنية الاستلام</h2><span class="rcv-count">' + pos.length + '</span></div>';
    if (!pos.length) h += '<p class="rcv-empty-line">مفيش طلبيات مستنية. الطلبيات اللي بتتأكد من صفحة المشتريات هتظهر هنا.</p>';
    else h += '<div class="rcv-pos">' + pos.map(function (p) {
      var q = p.lines.reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0), got = p.lines.reduce(function (s, l) { return s + Math.min(Number(l.received) || 0, Number(l.qty) || 0); }, 0);
      var pct = q ? Math.round(got * 100 / q) : 0;
      return '<div class="rcv-po"><div class="rcv-po-top"><b>' + esc(p.supplier) + '</b><span class="rcv-tag" data-state="' + esc(p.state) + '">' + (p.state === 'partial' ? 'وصل جزء' : 'مستني') + '</span></div>'
        + '<small>' + esc(p.id) + ' · ' + fmtDate(p.sentAt || p.createdAt) + ' · ' + nItems(p.lines.length) + '</small>'
        + '<div class="rcv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>'
        + '<div class="rcv-po-foot"><span>' + got + ' / ' + q + ' علبة</span><button type="button" class="rcv-btn sm" data-rcv-order="' + esc(p.id) + '">تفاصيل الطلبية</button><button type="button" class="rcv-btn sm primary" data-rcv-po="' + esc(p.id) + '">استلم</button></div></div>';
    }).join('') + '</div>';
    h += '</section>';
    if (pending.length) h += '<section class="rcv-sec"><div class="rcv-sec-h"><h2>استلامات تحتاج استكمال</h2><span class="rcv-count">' + pending.length + '</span></div><div class="rcv-pos">' + pending.map(r =>
      '<div class="rcv-po"><div class="rcv-po-top"><b>' + esc(r.supplier) + ' · ' + esc(r.invoice) + '</b><span class="rcv-tag" data-state="partial">مسودة · يحتاج استكمال</span></div><div class="rcv-po-foot"><span>اتحفظ ' +
      appliedCount(r) + ' من ' + r.lines.length + '</span><button type="button" class="rcv-btn sm primary" data-rcv-resume="' +
      esc(r.id) + '">كمّل الاستلام</button></div></div>').join('') + '</div></section>';
    var isEmbed = document.documentElement.classList.contains('nova-embed');
    if (isEmbed) {
      h += '<section class="rcv-sec"><div class="rcv-sec-h"><h2>سجل الفواتير</h2><span class="rcv-count">' + all.length + '</span></div>';
      if (!all.length) h += '<div class="rcv-empty">' + I.truck + '<b>لسه مفيش استلامات</b><span>لما المندوب يوصل، اضغط «استلام فاتورة» واكتب الأصناف، أو صوّر الفاتورة.</span><div class="rcv-actions"><button type="button" class="rcv-btn" data-rcv="needs">اطلب من النواقص</button><button type="button" class="rcv-btn" data-rcv="history">سجل الفواتير</button></div></div>';
      else h += '<div class="rcv-po"><div class="rcv-po-top"><b>آخر فاتورة: ' + esc(all[0].supplier) + ' · ' + esc(all[0].invoice) + '</b><span class="rcv-tag">' + fmtDate(all[0].date || all[0].at) + '</span></div><small>' + nItems(all[0].lines.length) + ' · ' + boxes(all[0]) + ' علبة · ' + money(total(all[0])) + '</small><div class="rcv-po-foot"><div class="rcv-actions"><button type="button" class="rcv-btn sm" data-rcv-correct="' + esc(all[0].id) + '">تصحيح الكميات</button><button type="button" class="rcv-btn sm" data-rcv-moves="' + esc(all[0].id) + '">حركة المخزون</button></div><button type="button" class="rcv-btn sm primary" data-rcv="history">عرض سجل الفواتير</button></div></div>';
      h += '</section></div>';
    } else {
      h += '<section class="rcv-sec"><div class="rcv-sec-h"><h2>آخر الاستلامات</h2><span class="rcv-count">' + all.length + '</span></div>';
      if (!all.length) h += '<div class="rcv-empty">' + I.truck + '<b>لسه مفيش استلامات</b><span>لما المندوب يوصل، اضغط «استلام فاتورة» واكتب الأصناف، أو صوّر الفاتورة.</span><button type="button" class="rcv-btn" data-rcv="needs">اطلب من النواقص</button></div>';
      else h += '<div class="rcv-table"><div class="rcv-tr rcv-th"><span>التاريخ</span><span>المورد</span><span>رقم الفاتورة</span><span>الأصناف</span><span>الإجمالي</span></div>'
        + all.slice(0, 50).map(function (r) {
          return '<details class="rcv-row" id="rcv-' + esc(r.id) + '"><summary class="rcv-tr"><span>' + fmtDate(r.date || r.at) + '</span><span><b>' + esc(r.supplier) + '</b>' + (r.poId ? ' <small class="rcv-po-ref">' + esc(r.poId) + '</small>' : '') + (r.warnings && r.warnings.length ? ' <small class="rcv-warn" title="' + esc(r.warnings.join('، ')) + '">⚠ ' + r.warnings.length + '</small>' : '') + '</span><span dir="ltr">' + esc(r.invoice) + '</span><span>' + nItems(r.lines.length) + ' · ' + boxes(r) + ' علبة</span><span><b>' + money(total(r)) + '</b></span></summary>'
            + '<div class="rcv-lines">' + window.NovaReceiptOperations.effectiveLines(r).map(function (l) { return '<div><span>' + esc(disp(l.name)) + '</span><span>' + qtyLabel(l) + '</span><span dir="ltr">' + esc(l.autoLot ? '—' : l.lot) + '</span><span dir="ltr">' + esc(String(l.expiry || '').slice(0, 7)) + '</span><span>' + money(lineMoney(l)) + '</span></div>'; }).join('') + '</div>' + receiptActions(r) + '</details>';
        }).join('') + '</div>';
      h += '</section></div>';
    }
    host.innerHTML = h;
  }

  // ---------- invoice form ----------
  var form = null;
  // Expiry input: MM/YY. Accepts 1126, 11/26, 11/2026, 2026-11. Returns internal 'YYYY-MM' or ''.
  function parseExp(v) {
    v = String(v || '').trim(); var m, mo, y;
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(v))) { y = +m[1]; mo = +m[2]; }
    else if ((m = /^(\d{1,2})\s*[\/\-.]\s*(\d{2}|\d{4})$/.exec(v)) || (m = /^(\d{2})(\d{2}|\d{4})$/.exec(v))) { mo = +m[1]; y = +m[2]; if (m[2].length === 2) y += 2000; }
    else return '';
    if (mo < 1 || mo > 12 || y < 2000 || y > 2099) return '';
    return y + '-' + String(mo).padStart(2, '0');
  }
  function expShow(e) { return /^\d{4}-\d{2}/.test(e || '') ? e.slice(5, 7) + '/' + e.slice(2, 4) : (e || ''); }
  function blankLine(p) { return { key: p && p.key || '', name: p && p.name || '', code: p && p.code || '', qty: p && (p.paidQty != null ? p.paidQty : p.qty) || '', bonus: p && p.bonus || '', lot: p && !p.autoLot && p.lot || '', exp: p && p.expiry ? p.expiry.slice(0, 7) : '', cost: p && p.invoiceCost != null ? p.invoiceCost : (p && p.cost != null ? p.cost : ''), price: p && p.expiry && p.price != null ? p.price : '' }; } // a new price is pre-filled only when resuming a saved receipt line (never the catalog price)
  function openForm(pre) {
    if (document.getElementById('rcvForm')) return;
    var prevFocus = document.activeElement;
    pre = pre || {};
    var st = { lines: (pre.lines && pre.lines.length ? pre.lines : [null]).map(blankLine), poId: pre.poId || '', pending: pre.pending ? pre : null };
    var sups = SUPPLIERS.concat(receipts().map(function (r) { return r.supplier; })).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
    var ov = document.createElement('div'); ov.id = 'rcvForm'; ov.className = 'rcv-ov'; ov.dir = 'rtl';
    ov.innerHTML = '<div class="rcv-dlg" role="dialog" aria-modal="true" aria-labelledby="rcvTitle">'
      + '<div class="rcv-dlg-h"><h2 id="rcvTitle">استلام فاتورة' + (st.poId ? ' <small>' + esc(st.poId) + '</small>' : '') + '</h2><button type="button" class="rcv-x" data-rcv-close aria-label="إغلاق">' + I.x + '</button></div>'
      + '<div class="rcv-meta"><div class="rcv-supbox"><label for="rcvSup">المورد <b class="rcv-req" aria-hidden="true">*</b></label><select id="rcvSup" aria-required="true"></select>'
      + '<div id="rcvSupNewBox" class="rcv-supnew" hidden><input id="rcvSupNew" autocomplete="off" maxlength="60" placeholder="اسم المورد الجديد" aria-label="اسم المورد الجديد"><button type="button" class="rcv-btn sm primary" id="rcvSupAdd">إضافة</button></div></div>'
      + '<label for="rcvInv"><span>رقم الفاتورة <b class="rcv-req" aria-hidden="true">*</b></span><input id="rcvInv" dir="ltr" autocomplete="off" aria-required="true" value="' + esc(pre.invoice || '') + '" placeholder="مثلًا 10452"></label>'
      + '<label>تاريخ الفاتورة<input id="rcvDate" type="date" dir="ltr" value="' + esc(pre.date || today()) + '"></label></div>'
      + '<div id="rcvLines" class="rcv-grid"></div>'
      + '<button type="button" class="rcv-add" data-rcv-add>' + I.plus + 'إضافة صنف</button>'
      + '<section id="rcvReview" class="rcv-review" aria-label="مراجعة فروق الاستلام"></section>'
      + '<div class="rcv-dlg-f"><div class="rcv-sum" id="rcvSum"></div><div id="rcvMsg" class="rcv-msg" role="alert"></div><div id="rcvMissing" class="rcv-missing" aria-live="polite"></div>'
      + '<div class="rcv-dlg-btns"><button type="button" class="rcv-btn" data-rcv-close>إلغاء</button><button type="button" class="rcv-btn primary" id="rcvOk">تأكيد الاستلام وإضافة للمخزون</button></div></div></div>';
    document.body.appendChild(ov); form = { ov: ov, st: st };
    var supSel = ov.querySelector('#rcvSup');
    function supOptions(cur) {
      var list = sups.slice(); if (cur && list.indexOf(cur) < 0) list.push(cur);
      sups = list;
      supSel.innerHTML = '<option value="">اختر المورد</option>' + list.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') + '<option value="__new">+ مورد جديد</option>';
      supSel.value = cur || '';
    }
    supOptions(pre.supplier || '');
    if (st.poId || st.pending) supSel.disabled = true;
    var supBox = ov.querySelector('#rcvSupNewBox'), supNew = ov.querySelector('#rcvSupNew'), lastSup = supSel.value;
    function supValue() { return supSel.value === '__new' ? '' : supSel.value; }
    function addSupplier() {
      var n = supNew.value.trim().replace(/\s+/g, ' ');
      if (!n) { msg('اكتب اسم المورد الجديد'); supNew.focus(); return; }
      var hit = sups.filter(function (x) { return x === n; })[0] || n;
      supOptions(hit); lastSup = hit; supBox.hidden = true; supNew.value = ''; msg(''); sum();
      ov.querySelector('#rcvInv').focus();
    }
    supSel.addEventListener('change', function () {
      if (supSel.value === '__new') { supBox.hidden = false; supNew.focus(); sum(); return; }
      supBox.hidden = true; lastSup = supSel.value; msg(''); sum();
      if (supSel.value) ov.querySelector('#rcvInv').focus(); // typing never edits the supplier
    });
    ov.querySelector('#rcvSupAdd').addEventListener('click', addSupplier);
    supNew.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSupplier(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); supBox.hidden = true; supOptions(lastSup); sum(); } });
    ov.querySelector('#rcvInv').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var f = box.querySelector('[data-f=q]'); if (f) f.focus(); } });
    ov.querySelector('#rcvInv').addEventListener('input', function () { msg(''); sum(); });
    var box = ov.querySelector('#rcvLines');
    function rowHtml(l, i) {
      return '<div class="rcv-line" data-i="' + i + '">'
        + '<div class="rcv-fld rcv-pick"><span class="rcv-lbl">الصنف <b class="rcv-req" aria-hidden="true">*</b></span><input data-f="q" autocomplete="off" placeholder="ابحث بالاسم أو امسح الباركود" value="' + esc(l.key ? disp(l.name) : (l.name || '')) + '" aria-label="الصنف" aria-required="true"' + (l.key ? ' data-ok="1"' : '') + '><div class="rcv-sug" hidden></div></div>'
        + '<div class="rcv-fld"><span class="rcv-lbl">الكمية</span><div class="rcv-unitbox"><input data-f="qty" type="number" min="1" step="1" inputmode="numeric" value="' + esc(l.qty) + '" aria-label="الكمية بالعلب" placeholder="0"><span class="rcv-unit">علبة</span></div></div>'
        + '<div class="rcv-fld rcv-bonus"><span class="rcv-lbl">بونص</span><input data-f="bonus" type="number" min="0" max="9999" step="1" inputmode="numeric" value="' + esc(l.bonus) + '" aria-label="بونص مجاني بالعلب" placeholder="0"></div>'
        + '<div class="rcv-fld"><span class="rcv-lbl">سعر العلبة</span><input data-f="cost" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(l.cost) + '" aria-label="سعر الشراء للعلبة" placeholder="0.00"></div>'
        + '<div class="rcv-fld rcv-price"><span class="rcv-lbl">سعر البيع الجديد</span><input data-f="price" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(l.price == null ? '' : l.price) + '" aria-label="سعر البيع الجديد للعلبة (اختياري، لو السعر اتغير)" placeholder="اختياري"></div>'
        + '<div class="rcv-fld"><span class="rcv-lbl">الصلاحية <b class="rcv-req" aria-hidden="true">*</b></span><input data-f="exp" type="text" dir="ltr" inputmode="numeric" maxlength="7" autocomplete="off" value="' + esc(expShow(l.exp)) + '" aria-label="تاريخ الصلاحية شهر/سنة" aria-required="true" placeholder="MM/YY"><small class="rcv-err" data-err role="alert"></small></div>'
        + '<div class="rcv-fld"><span class="rcv-lbl">التشغيلة (اختياري)</span><input data-f="lot" dir="ltr" maxlength="40" value="' + esc(l.lot) + '" aria-label="رقم التشغيلة (اختياري)" placeholder="اختياري"></div>'
        + '<div class="rcv-fld"><span class="rcv-lbl">الإجمالي</span><output class="rcv-lt" data-lt>—</output></div>'
        + '<button type="button" class="rcv-del" data-rcv-del aria-label="حذف السطر">' + I.x + '</button></div>';
    }
    function draw() { box.innerHTML = st.lines.map(rowHtml).join(''); sum(); }
    function sum() {
      var n = 0, b = 0, t = 0;
      st.lines.forEach(function (l, i) {
        var q = Number(l.qty) || 0, bn = bonusOf(l), c = Number(l.cost) || 0, row = box.children[i];
        if (row) row.querySelector('[data-lt]').textContent = q && c ? money(q * c) : '—';
        if (l.key || l.name) { n++; b += q + (Number.isInteger(bn) && bn > 0 ? bn : 0); t += q * c; }
      });
      var miss = [], now0 = new Date(), tt = Date.UTC(now0.getFullYear(), now0.getMonth(), now0.getDate()), anyItem = false, expBad = false, qtyBad = false, bonusBad = false, pickBad = false;
      if (!supValue()) miss.push('المورد');
      if (!ov.querySelector('#rcvInv').value.trim()) miss.push('رقم الفاتورة');
      var usedAny = false;
      st.lines.forEach(function (l, i) {
        var row = box.children[i], er = row && row.querySelector('[data-err]'), raw = String(l.exp || '').trim(), pe = parseExp(raw), msgE = '';
        var bn = bonusOf(l), used = !!(l.key || l.name || l.qty || bonusRaw(l) || l.lot || raw), q = Number(l.qty);
        if (l.key) anyItem = true;
        if (raw) {
          if (!pe) { if (row && (row.dataset.touched || raw.length >= 5)) msgE = 'اكتب الشهر والسنة مثل 11/26'; }
          else { var y = +pe.slice(0, 4), mo = +pe.slice(5); if (Date.UTC(y, mo, 0) < tt) msgE = 'الصلاحية منتهية (الشهر ده عدّى)'; }
        }
        if (er) er.textContent = msgE;
        if (used) usedAny = true;
        if (used && !l.key) pickBad = true;
        if (used && (!Number.isInteger(q) || q <= 0)) qtyBad = true;
        if (used && !bonusOk(bn, q)) bonusBad = true;
        if (used && (!pe || msgE || +pe.slice(5) < 1 || +pe.slice(5) > 12)) expBad = true;
      });
      if (!anyItem || pickBad) miss.push('صنف واحد على الأقل');
      if (qtyBad) miss.push('الكمية');
      if (bonusBad) miss.push('البونص');
      if (expBad || !usedAny) miss.push('الصلاحية');
      var mEl = ov.querySelector('#rcvMissing'); mEl.textContent = miss.length && !st.pending ? 'ناقص: ' + miss.join('، ') : '';
      var okBtn = ov.querySelector('#rcvOk'); if (okBtn && !st.pending) { okBtn.disabled = miss.length > 0; okBtn.setAttribute('aria-disabled', String(miss.length > 0)); }
      ov.querySelector('#rcvSum').innerHTML = '<span>' + nItems(n) + '</span><span>' + b + ' علبة</span><b>' + money(t) + '</b>';
      const po = st.poId ? read(POK).find(row => row.id === st.poId) : null;
      const lines = st.lines.filter(line => line.key).map(line => ({ ...line, code: line.code || line.key }));
      ov.querySelector('#rcvReview').innerHTML = po ? reviewTable(po, lines) : '';

    }
    function bonusRaw(l) { return String(l.bonus == null ? '' : l.bonus).trim(); }
    function bonusOf(l) { var r = bonusRaw(l); return r === '' ? 0 : Number(r); }
    function bonusOk(bn, q) { return Number.isInteger(bn) && bn >= 0 && bn <= 9999 && (!(Number.isInteger(q) && q > 0) || bn <= 10 * q); }
    function lineOf(el) { var r = el.closest('.rcv-line'); return r ? +r.getAttribute('data-i') : -1; }
    var found = {};
    function suggest(inp, i) {
      var t = inp.value.trim(), sug = inp.parentNode.querySelector('.rcv-sug');
      st.lines[i].key = ''; st.lines[i].name = t; inp.removeAttribute('data-ok');
      var res = t && window.novaSearch ? window.novaSearch.search(t, 6) : [];
      found[i] = res;
      if (!res.length) { sug.hidden = true; sug.innerHTML = ''; return; }
      sug.innerHTML = res.map(function (p, k) { return '<button type="button" data-pick="' + k + '">' + esc(disp(p.name)) + (p.price ? '<small>' + money(p.price) + '</small>' : '') + '</button>'; }).join('');
      sug.hidden = false;
    }
    function pick(i, k) {
      var p = (found[i] || [])[k]; if (!p) return;
      var l = st.lines[i]; l.key = window.novaStock ? window.novaStock.keyOf(p) : (p.key || p.barcode || p.name); l.name = p.name; l.code = p.barcode || l.key;
      if (l.cost === '' && p.cost) l.cost = p.cost;
      var row = box.children[i], inp = row.querySelector('[data-f=q]');
      inp.value = disp(p.name); inp.setAttribute('data-ok', '1');
      row.querySelector('.rcv-sug').hidden = true;
      if (l.cost !== '') row.querySelector('[data-f=cost]').value = l.cost;
      row.querySelector('[data-f=qty]').focus(); sum();
    }
    box.addEventListener('input', function (e) {
      var f = e.target.getAttribute('data-f'), i = lineOf(e.target); if (i < 0) return;
      if (f === 'q') { suggest(e.target, i); sum(); } else { st.lines[i][f] = e.target.value; sum(); }
      msg('');
    });
    box.addEventListener('focusout', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-f') === 'exp') { var r = e.target.closest('.rcv-line'); if (r) { r.dataset.touched = '1'; sum(); } } });
    box.addEventListener('mousedown', function (e) {
      var b = e.target.closest('[data-pick]');
      if (b) { e.preventDefault(); pick(lineOf(b), +b.getAttribute('data-pick')); }
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (b) { pick(lineOf(b), +b.getAttribute('data-pick')); return; }
      if (e.target.closest('[data-rcv-del]')) { var i = lineOf(e.target); st.lines.splice(i, 1); if (!st.lines.length) st.lines.push(blankLine()); draw(); }
    });
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var f = e.target.getAttribute('data-f'), i = lineOf(e.target); if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      if (f === 'q') { if (found[i] && found[i].length) pick(i, 0); return; }
      var nx = { qty: 'bonus', bonus: 'exp', lot: 'exp', exp: 'cost', cost: 'price' }[f];
      if (nx) box.children[i].querySelector('[data-f=' + nx + ']').focus();
      else addLine();
    });
    function addLine() { st.lines.push(blankLine()); draw(); box.lastElementChild.querySelector('[data-f=q]').focus(); }
    function msg(m, warn) { var el = ov.querySelector('#rcvMsg'); el.textContent = m || ''; el.className = 'rcv-msg' + (warn ? ' warn' : ''); }
    function dirty() { return ov.querySelector('#rcvInv').value.trim() || st.lines.some(function (l) { return l.key || l.qty || bonusRaw(l) || l.lot; }); }
    function close(force) { if (!force && !st.pending && dirty() && !window.confirm('تقفل من غير ما تحفظ الاستلام؟')) return; ov.remove(); document.removeEventListener('keydown', key, true); form = null; if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') { try { prevFocus.focus(); } catch (_) {} } }
    function key(e) {
      if (e.key === 'Escape') { var s = ov.querySelector('.rcv-sug:not([hidden])'); e.preventDefault(); e.stopPropagation(); if (s) { s.hidden = true; return; } close(); }
      else if (e.key === 'Tab') {
        var controls = [].slice.call(ov.querySelectorAll('button,input,select,textarea,a[href]')).filter(function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; });
        if (!controls.length) return;
        var first = controls[0], last = controls[controls.length - 1];
        if (!ov.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', key, true);
    ov.addEventListener('click', function (e) {
      if (e.target.closest('[data-rcv-close]')) close();
      else if (e.target.closest('[data-rcv-add]')) addLine();
      else if (!e.target.closest('.rcv-pick')) ov.querySelectorAll('.rcv-sug').forEach(function (s) { s.hidden = true; });
    });
    function validateReceipt() {
      var sup = supValue().trim(), inv = ov.querySelector('#rcvInv').value.trim(), date = ov.querySelector('#rcvDate').value || today();
      if (!sup) { msg('اختر المورد'); supSel.focus(); return; }
      if (!inv) { msg('اكتب رقم الفاتورة'); ov.querySelector('#rcvInv').focus(); return; }
      const previous = receipts().find(r => r.supplier === sup && r.invoice === inv);
      if (previous) {
        msg(previous.pending ? 'الفاتورة دي محتاجة استكمال. اقفل النافذة واضغط «كمّل الاستلام» من القائمة.' : 'الفاتورة دي (' + inv + ') اتسجلت قبل كده للمورد ده');
        return;
      }
      var used = st.lines.filter(function (l) { return l.key || l.name || l.qty || bonusRaw(l) || l.lot; });
      if (!used.length) { msg('ضيف صنف واحد على الأقل'); return; }
      var id = 'RCV-' + window.novaStock.newKey();
      var now = new Date(), t0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), soon = t0 + 90 * 864e5, out = [], short = 0;
      for (var i = 0; i < st.lines.length; i++) {
        var l = st.lines[i]; if (used.indexOf(l) < 0) continue;
        var row = box.children[i], bad = function (f, m) { msg('سطر ' + (i + 1) + ': ' + m); row.querySelector('[data-f=' + f + ']').focus(); };
        if (!l.key) return bad('q', 'اختار الصنف من القائمة');
        var q = Number(l.qty); if (!Number.isInteger(q) || q <= 0) return bad('qty', 'اكتب كمية صحيحة بالعلب');
        var bn = bonusOf(l); if (!bonusOk(bn, q)) return bad('bonus', 'اكتب بونص صحيح');
        var autoLot = !String(l.lot).trim(), lot = autoLot ? id + '/' + (i + 1) : String(l.lot).trim();
        var pe = parseExp(l.exp); if (!pe) return bad('exp', 'اكتب الصلاحية شهر/سنة مثل 11/26');
        var y = +pe.slice(0, 4), mo = +pe.slice(5), last = new Date(Date.UTC(y, mo, 0));
        if (mo < 1 || mo > 12) return bad('exp', 'اختار تاريخ صلاحية صحيح');
        if (last.getTime() < t0) return bad('exp', 'الصلاحية منتهية');
        if (last.getTime() < soon) short++;
        if (out.some(function (o) { return o.key === l.key && o.lot === lot; })) return bad('lot', 'نفس الصنف ونفس التشغيلة متكررين');
        if (l.cost !== '' && (!Number.isFinite(Number(l.cost)) || Number(l.cost) < 0)) return bad('cost', 'اكتب سعر شراء صحيح');
        var priceRaw = String(l.price == null ? '' : l.price).trim(), newPrice = priceRaw === '' ? null : Math.round(Number(priceRaw) * 100) / 100;
        if (newPrice !== null && (!Number.isFinite(newPrice) || newPrice <= 0)) return bad('price', 'اكتب سعر بيع صحيح أو سيبه فاضي');
        var invCost = l.cost === '' ? 0 : Number(l.cost) || 0, expStr = pe + '-' + String(last.getUTCDate()).padStart(2, '0');
        // no bonus → exactly today's line shape (replay/idempotency compares it)
        out.push(bn > 0
          ? { key: l.key, code: l.code || l.key, name: l.name, qty: q + bn, paidQty: q, bonus: bn, lot: lot, autoLot: autoLot, expiry: expStr, invoiceCost: invCost, cost: Math.round(q * invCost / (q + bn) * 10000) / 10000 }
          : { key: l.key, code: l.code || l.key, name: l.name, qty: q, lot: lot, autoLot: autoLot, expiry: expStr, cost: invCost });
        if (newPrice !== null) out[out.length - 1].price = newPrice;
      }
      var b = out.reduce(function (s, o) { return s + o.qty; }, 0), bb = out.reduce(function (s, o) { return s + (o.bonus || 0); }, 0);
      var bTxt = bb ? (b - bb) + ' + ' + bb + ' بونص = ' + b + ' علبة' : b + ' علبة';
      if (st.poId && read(POK).find(row => row.id === st.poId)?.supplier !== sup) { msg('مورد الفاتورة يختلف عن الطلبية'); return; }
      if (!window.confirm('تأكيد استلام ' + nItems(out.length) + ' (' + bTxt + ') من ' + sup + ' وإضافتهم للمخزون؟' + (short ? '\nتنبيه: ' + short + ' صنف صلاحيته أقل من 3 شهور.' : ''))) return;
      if (st.poId) {
        const po = pendingPOs().find(entry => entry.id === st.poId);
        if (!po || po.grns?.some(entry => entry.ref === inv)) { msg('الفاتورة دي اتسجلت قبل كده للطلبية أو الطلبية اكتملت'); return; }
      }
      return { id, at: new Date().toISOString(), date, supplier: sup, invoice: inv, poId: st.poId || null, lines: out, pending: true, by: window.novaAuth?.current()?.id || null };
    }
    const submit = ov.querySelector('#rcvOk');
    function showPending() {
      const receipt = st.pending;
      if (!receipt) return;
      const done = appliedCount(receipt);
      box.querySelectorAll('.rcv-line').forEach((row, index) => {
        try { row.hidden = window.novaStock.hasReceiptLine(receipt.id + '/' + index); } catch (_) {}
      });
      ov.querySelectorAll('input,select,[data-rcv-add],[data-rcv-del]').forEach(el => { el.disabled = true; });
      submit.textContent = 'كمّل الاستلام';
      msg('اتحفظ ' + done + ' من ' + receipt.lines.length + ' · كمّل نفس الفاتورة');
    }
    submit.addEventListener('click', async function () {
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const completed = await window.novaStock.withLock(() => {
          if (st.pending) {
            const current = receipts().find(r => r.id === st.pending.id);
            if (!current) throw new Error('receipt-not-found');
            if (!current.pending) return current;
          } else {
            const receipt = validateReceipt();
            if (!receipt) return null;
            saveReceipt(receipt);
            st.pending = receipt;
          }
          applyReceipt(st.pending);
          return st.pending;
        });
        if (completed) {
          close(true);
          toast('تم استلام ' + nItems(completed.lines.length) + ' (' + boxes(completed) + ' علبة) من ' + completed.supplier);
          render();
        }
      } catch (_) {
        if (st.pending) { showPending(); render(); }
        else msg('تعذر حفظ الفاتورة على الجهاز. جرّب تاني.');
      } finally { submit.disabled = false; }
    });
    draw();
    if (st.pending) { showPending(); submit.focus(); return; }
    sum();
    (pre.supplier || supSel.disabled ? ov.querySelector('#rcvInv') : supSel).focus();
  }

  function openPhoto() {
    var pn = document.getElementById('novaAiPanel');
    if (pn) pn.classList.add('open'); else location.hash = '#products&receive=1';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-rcv],[data-rcv-po],[data-rcv-resume],[data-rcv-correct],[data-rcv-order],[data-rcv-moves],[data-rcv-close-rest]'); if (!a || !a.closest('.rcv,.rcv-controls')) return;
    if (a.hasAttribute('data-rcv-correct')) openCorrection(a.dataset.rcvCorrect);
    else if (a.hasAttribute('data-rcv-order')) openOrder(a.dataset.rcvOrder);
    else if (a.hasAttribute('data-rcv-moves')) openMovements(a.dataset.rcvMoves);
    else if (a.hasAttribute('data-rcv-close-rest')) closeRemaining(a.dataset.rcvCloseRest);
    else if (a.getAttribute('data-rcv') === 'retry') render();
    else if (a.getAttribute('data-rcv') === 'needs') { if (window.parent !== window) window.parent.postMessage({ novaPurchasesTab: 'needs' }, location.origin); else location.href = '/purchases'; }
    else if (a.getAttribute('data-rcv') === 'history') { if (window.parent !== window) window.parent.postMessage({ novaPurchasesTab: 'history' }, location.origin); else location.href = '/purchases#history'; }
    else if (a.getAttribute('data-rcv') === 'new') openForm();
    else if (a.getAttribute('data-rcv') === 'photo') openPhoto();
    else if (a.hasAttribute('data-rcv-resume')) {
      const receipt = receipts().find(r => r.pending && r.id === a.getAttribute('data-rcv-resume'));
      if (receipt) openForm(receipt);
    }
    else if (a.hasAttribute('data-rcv-po')) {
      var po = read(POK).filter(function (p) { return p.id === a.getAttribute('data-rcv-po'); })[0]; if (!po) return;
      openForm({ supplier: po.supplier, poId: po.id, lines: po.lines.filter(function (l) { return (l.qty - (l.received || 0)) > 0; }).map(function (l) {
        var hit = window.novaSearch && l.code ? window.novaSearch.search(l.code, 1)[0] : null;
        return { key: hit ? (window.novaStock ? window.novaStock.keyOf(hit) : hit.name) : '', name: hit ? hit.name : (l.name || l.code), code: l.code, qty: l.qty - (l.received || 0), cost: l.cost };
      }) });
    }
  });
  window.novaReceiving = { render: render, open: openForm, openOrder };
  const incomingOrder = new URLSearchParams(location.search).get('order');
  if (incomingOrder && location.hash === '#receiving') openOrder(incomingOrder);
  var pv = document.getElementById('novaPageView'); if (pv && document.body.dataset.activePage === 'receiving') render(pv);
})();
