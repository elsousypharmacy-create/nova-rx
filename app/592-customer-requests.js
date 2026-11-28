// app/592-customer-requests.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-customer-requests-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaCustomerRequests';
  var STYLE_ID = 'novaCustomerRequestsStyle';
  var MAX_RECORDS = 500;
  var observer = null;
  var selectedItemKey = '';
  var selectedItemName = '';

  function isEn() {
    try {
      return localStorage.getItem(LANG_KEY) === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(ar, en) {
    return isEn() ? en : ar;
  }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') {
      try {
        window.showToast(msg, kind || 'success');
      } catch (e) {}
    }
  }

  function currentUserName() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        return u && u.name ? String(u.name) : '';
      }
    } catch (e) {}
    return '';
  }

  function normalizeDigits(str) {
    var s = String(str == null ? '' : str);
    var ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    var fa = '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9';
    var out = '';
    var i, ch, idx;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      idx = ar.indexOf(ch);
      if (idx !== -1) {
        out += String(idx);
      } else {
        idx = fa.indexOf(ch);
        out += idx !== -1 ? String(idx) : ch;
      }
    }
    return out;
  }

  function trimStr(val) {
    return String(val == null ? '' : val).replace(/^\s+|\s+$/g, '');
  }

  function normalizePhone(val) {
    var raw = trimStr(val);
    if (!raw) return '';
    var digits = normalizeDigits(raw).replace(/[\s\-()]+/g, '');
    if (!/^01[0125]\d{8}$/.test(digits)) return null;
    return digits;
  }

  function parseQty(val) {
    if (val === undefined || val === null || trimStr(val) === '') return 1;
    var s = normalizeDigits(trimStr(val));
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n >= 1 ? n : NaN;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function trimRecords(list) {
    var arr = list.slice();
    var i, idx;
    while (arr.length > MAX_RECORDS) {
      idx = -1;
      for (i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].status === 'closed') {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        arr.splice(idx, 1);
      } else {
        arr.shift();
      }
    }
    return arr;
  }

  function writeStore(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimRecords(list)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function getProducts() {
    if (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) {
      return window.NOVA_DEMO.products;
    }
    return [];
  }

  function keyOf(product) {
    if (!product) return '';
    try {
      if (window.novaStock && typeof window.novaStock.keyOf === 'function') {
        return String(window.novaStock.keyOf(product) || '');
      }
    } catch (e) {}
    return String(product.barcode || product.id || product.name || '');
  }

  function getOnHand(key) {
    if (!key) return 0;
    try {
      if (!window.novaStock || typeof window.novaStock.hasLots !== 'function' || typeof window.novaStock.lots !== 'function') {
        return 0;
      }
      if (!window.novaStock.hasLots(key)) return 0;
      var lots = window.novaStock.lots(key) || [];
      var sum = 0;
      var i;
      for (i = 0; i < lots.length; i++) {
        sum += Number(lots[i] && lots[i].onHand) || 0;
      }
      return sum;
    } catch (e) {
      return 0;
    }
  }

  function searchProducts(q) {
    try {
      if (window.novaSearch && typeof window.novaSearch.search === 'function') {
        var found = window.novaSearch.search(q, 10);
        if (Array.isArray(found)) return found;
      }
    } catch (e) {}
    var query = String(q || '').toLowerCase();
    var normQuery = normalizeDigits(query);
    var list = getProducts();
    var out = [];
    var i, p;
    for (i = 0; i < list.length && out.length < 10; i++) {
      p = list[i];
      if (!p) continue;
      if (
        !query ||
        (p.name && String(p.name).toLowerCase().indexOf(query) !== -1) ||
        (p.barcode && String(p.barcode).indexOf(normQuery) !== -1)
      ) {
        out.push(p);
      }
    }
    return out;
  }

  function makeId() {
    return 'req_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  }

  function addRequest(opts) {
    var o = opts || {};
    var customer = trimStr(o.customer);
    if (!customer) return false;
    var item = trimStr(o.item);
    if (!item) return false;
    var phone = normalizePhone(o.phone);
    if (phone === null) return false;
    var qty = parseQty(o.qty);
    if (isNaN(qty) || qty < 1) return false;
    var itemKey = trimStr(o.itemKey);
    var note = trimStr(o.note).slice(0, 200);

    var rec = {
      id: makeId(),
      at: new Date().toISOString(),
      by: currentUserName(),
      customer: customer,
      phone: phone,
      item: item,
      itemKey: itemKey,
      qty: qty,
      note: note,
      status: 'open'
    };

    var list = readStore();
    list.push(rec);
    if (!writeStore(list)) return false;
    refreshLists();
    return rec;
  }

  function listRequests(status) {
    var all = readStore();
    if (!status) return all.slice();
    var out = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i] && all[i].status === status) out.push(all[i]);
    }
    return out;
  }

  function arrivedRequests() {
    var open = listRequests('open');
    var out = [];
    var i, r;
    for (i = 0; i < open.length; i++) {
      r = open[i];
      if (r.itemKey && getOnHand(r.itemKey) > 0) {
        out.push(r);
      }
    }
    return out;
  }

  function markNotified(id) {
    if (!id) return false;
    var list = readStore();
    var i, rec;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        rec = list[i];
        if (rec.status === 'closed') return false;
        if (rec.status === 'notified') return rec;
        rec.status = 'notified';
        rec.notifiedAt = new Date().toISOString();
        rec.notifiedBy = currentUserName();
        if (!writeStore(list)) return false;
        refreshLists();
        return rec;
      }
    }
    return false;
  }

  function closeRequest(id, reason) {
    var r = trimStr(reason);
    if (!id || !r) return false;
    var list = readStore();
    var i, rec;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        rec = list[i];
        if (rec.status === 'closed') return false;
        rec.status = 'closed';
        rec.closeType = r === 'delivered' ? 'delivered' : 'cancelled';
        rec.closeReason = r;
        rec.closedAt = new Date().toISOString();
        rec.closedBy = currentUserName();
        if (!writeStore(list)) return false;
        refreshLists();
        return rec;
      }
    }
    return false;
  }

  function waLink(id) {
    if (!id) return null;
    var list = readStore();
    var i, rec = null;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        rec = list[i];
        break;
      }
    }
    if (!rec || !rec.phone) return null;
    var phone = normalizePhone(rec.phone);
    if (!phone) return null;
    var phName = (window.novaPharmacyProfile && typeof window.novaPharmacyProfile.get === 'function')
      ? window.novaPharmacyProfile.get().name
      : 'صيدلية السوسي';
    var msg = 'أهلاً ' + rec.customer + '، ' + rec.item + ' وصل ' + phName + '. هنحجزه لك لحد بكرة.';
    return 'https://wa.me/20' + phone.slice(1) + '?text=' + encodeURIComponent(msg);
  }

  window.novaCustomerRequests = {
    add: addRequest,
    list: listRequests,
    arrived: arrivedRequests,
    markNotified: markNotified,
    close: closeRequest,
    waLink: waLink
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaCustomerRequests{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;}',
      '#novaCustomerRequests *,.ncr-dialog-backdrop,.ncr-dialog-backdrop *{box-sizing:border-box;}',
      '#novaCustomerRequests h3,#novaCustomerRequests h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaCustomerRequests h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaCustomerRequests h4{font-size:0.95rem;margin:0;color:#79c9eb;}',
      '.ncr-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:10px;margin:12px 0;}',
      '.ncr-field{position:relative;min-width:0;}',
      '.ncr-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.ncr-input{width:100%;min-width:0;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.ncr-input:focus{outline:none;border-color:#79c9eb;}',
      '.ncr-results{margin-top:6px;border:1px solid #343b44;border-radius:8px;background:#0d1117;max-height:200px;overflow-y:auto;}',
      '.ncr-result-btn{display:block;width:100%;min-height:44px;text-align:inherit;padding:8px 12px;background:transparent;border:0;border-bottom:1px solid #343b44;color:#e6edf3;cursor:pointer;}',
      '.ncr-result-btn:last-child{border-bottom:0;}',
      '.ncr-result-btn:hover{background:#1c232b;}',
      '.ncr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.ncr-actions button,.ncr-row-actions button,.ncr-dialog-actions button{min-height:44px;}',
      '.ncr-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.ncr-sec-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;margin-bottom:8px;}',
      '.ncr-badge{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 8px;border-radius:999px;background:#238636;color:#ffffff;font-size:0.8rem;font-weight:700;}',
      '.ncr-list{display:flex;flex-direction:column;gap:8px;}',
      '.ncr-row{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;}',
      '.ncr-row-main{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;align-items:center;}',
      '.ncr-row-title{font-weight:600;color:#e6edf3;word-break:break-word;}',
      '.ncr-row-meta{font-size:0.85rem;color:#9fb0c2;word-break:break-word;}',
      '.ncr-hint{display:inline-block;font-size:0.78rem;color:#f2cc60;border:1px solid #343b44;border-radius:6px;padding:2px 6px;}',
      '.ncr-tag{display:inline-block;font-size:0.78rem;color:#79c9eb;border:1px solid #343b44;border-radius:6px;padding:2px 6px;}',
      '.ncr-row-actions{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ncr-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;border:1px solid #343b44;border-radius:8px;background:#0d1117;}',
      '.ncr-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.ncr-dialog{width:100%;max-width:360px;background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;color:#e6edf3;}',
      '.ncr-dialog h4{margin:0 0 10px 0;color:#e6edf3;font-size:1rem;}',
      '.ncr-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:flex-end;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openCancelDialog(req) {
    var backdrop = el('div', 'ncr-dialog-backdrop');
    backdrop.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    var box = el('div', 'ncr-dialog');
    box.appendChild(el('h4', '', t('إلغاء الطلب', 'Cancel Request')));
    box.appendChild(el('div', 'ncr-row-meta', req.customer + ' — ' + req.item));

    var inp = el('input', 'ncr-input');
    inp.type = 'text';
    inp.style.marginTop = '10px';
    inp.placeholder = t('سبب الإلغاء (مطلوب)', 'Cancellation reason (required)');
    box.appendChild(inp);

    var err = el('div', 'ncr-status', '');
    box.appendChild(err);

    var acts = el('div', 'ncr-dialog-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('رجوع', 'Back'));
    cancelBtn.type = 'button';
    var confirmBtn = el('button', 'btn btn-primary', t('تأكيد الإلغاء', 'Confirm Cancel'));
    confirmBtn.type = 'button';

    function closeDialog() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    cancelBtn.addEventListener('click', closeDialog);
    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) closeDialog();
    });
    confirmBtn.addEventListener('click', function () {
      var reason = trimStr(inp.value);
      if (!reason) {
        err.textContent = t('اكتب سبب الإلغاء أولًا.', 'Enter a cancellation reason first.');
        return;
      }
      var res = closeRequest(req.id, reason);
      if (res) {
        toast(t('تم إلغاء الطلب.', 'Request cancelled.'), 'success');
        closeDialog();
      } else {
        err.textContent = t('تعذر إلغاء الطلب.', 'Could not cancel request.');
      }
    });

    acts.appendChild(cancelBtn);
    acts.appendChild(confirmBtn);
    box.appendChild(acts);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    inp.focus();
  }

  function buildRow(req, isArrived) {
    var row = el('div', 'ncr-row');
    var head = el('div', 'ncr-row-main');
    head.appendChild(el('div', 'ncr-row-title', req.customer + ' — ' + req.item + ' (×' + req.qty + ')'));
    if (!req.itemKey) {
      head.appendChild(el('span', 'ncr-hint', t('اربط بصنف', 'Link to item')));
    } else if (req.status === 'notified') {
      head.appendChild(el('span', 'ncr-tag', t('تم التبليغ', 'Notified')));
    }
    row.appendChild(head);

    var metaParts = [];
    if (req.phone) metaParts.push(req.phone);
    if (req.note) metaParts.push(req.note);
    if (metaParts.length) {
      row.appendChild(el('div', 'ncr-row-meta', metaParts.join(' • ')));
    }

    var acts = el('div', 'ncr-row-actions');
    if (isArrived) {
      var waBtn = el('button', 'btn btn-primary', t('بلّغ على واتساب', 'Notify on WhatsApp'));
      waBtn.type = 'button';
      var link = waLink(req.id);
      if (!link) waBtn.disabled = true;
      waBtn.addEventListener('click', function () {
        var url = waLink(req.id);
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          markNotified(req.id);
          toast(t('تم تسجيل التبليغ.', 'Marked as notified.'), 'success');
        }
      });
      acts.appendChild(waBtn);
    }

    if (isArrived || req.status === 'notified') {
      var delivBtn = el('button', 'btn btn-secondary', t('اتسلّم', 'Delivered'));
      delivBtn.type = 'button';
      delivBtn.addEventListener('click', function () {
        if (closeRequest(req.id, 'delivered')) {
          toast(t('تم تسليم الطلب.', 'Request marked delivered.'), 'success');
        }
      });
      acts.appendChild(delivBtn);
    }

    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', function () {
      openCancelDialog(req);
    });
    acts.appendChild(cancelBtn);

    row.appendChild(acts);
    return row;
  }

  function refreshLists() {
    var arrivedWrap = document.getElementById('ncrArrivedList');
    var waitingWrap = document.getElementById('ncrWaitingList');
    var badge = document.getElementById('ncrArrivedBadge');
    if (!arrivedWrap || !waitingWrap || !badge) return;

    while (arrivedWrap.firstChild) arrivedWrap.removeChild(arrivedWrap.firstChild);
    while (waitingWrap.firstChild) waitingWrap.removeChild(waitingWrap.firstChild);

    var arrived = arrivedRequests();
    badge.textContent = String(arrived.length);

    var arrivedIds = {};
    var i;
    for (i = 0; i < arrived.length; i++) {
      arrivedIds[arrived[i].id] = true;
      arrivedWrap.appendChild(buildRow(arrived[i], true));
    }
    if (!arrived.length) {
      arrivedWrap.appendChild(el('div', 'ncr-empty', t('لا توجد طلبات وصلت الآن.', 'No arrived requests right now.')));
    }

    var all = readStore();
    var waitingCount = 0;
    for (i = all.length - 1; i >= 0; i--) {
      if (!all[i]) continue;
      if (all[i].status === 'open' && !arrivedIds[all[i].id]) {
        waitingWrap.appendChild(buildRow(all[i], false));
        waitingCount++;
      } else if (all[i].status === 'notified') {
        waitingWrap.appendChild(buildRow(all[i], false));
        waitingCount++;
      }
    }
    if (!waitingCount) {
      waitingWrap.appendChild(el('div', 'ncr-empty', t('لا توجد طلبات منتظرة.', 'No waiting requests.')));
    }
  }

  function buildCard() {
    injectStyles();
    selectedItemKey = '';
    selectedItemName = '';

    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('طلبات العملاء', 'Customer Requests')));

    var form = el('div', 'ncr-form');

    function makeField(labelText, inputId, placeholder) {
      var wrap = el('div', 'ncr-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', inputId);
      var inp = el('input', 'ncr-input');
      inp.id = inputId;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return { wrap: wrap, input: inp };
    }

    var customerF = makeField(t('اسم العميل', 'Customer Name'), 'ncrCustomerInput', t('مثال: أحمد محمد', 'e.g. Ahmed Mohamed'));
    var phoneF = makeField(t('الموبايل (اختياري)', 'Mobile (Optional)'), 'ncrPhoneInput', '01012345678');
    phoneF.input.setAttribute('inputmode', 'tel');

    var itemF = makeField(t('الصنف', 'Item'), 'ncrItemInput', t('ابحث أو اكتب اسم الصنف', 'Search or type item name'));
    var resultsBox = el('div', 'ncr-results');
    resultsBox.style.display = 'none';
    itemF.wrap.appendChild(resultsBox);

    var qtyF = makeField(t('الكمية', 'Quantity'), 'ncrQtyInput', '1');
    qtyF.input.value = '1';
    qtyF.input.setAttribute('inputmode', 'numeric');

    var noteF = makeField(t('ملاحظة', 'Note'), 'ncrNoteInput', t('اختياري', 'Optional'));

    card.appendChild(form);

    var actions = el('div', 'ncr-actions');
    var submitBtn = el('button', 'btn btn-primary', t('سجّل الطلب', 'Save Request'));
    submitBtn.type = 'button';
    actions.appendChild(submitBtn);
    card.appendChild(actions);

    var statusMsg = el('div', 'ncr-status', '');
    card.appendChild(statusMsg);

    itemF.input.addEventListener('input', function () {
      var q = trimStr(itemF.input.value);
      if (q !== selectedItemName) {
        selectedItemKey = '';
      }
      while (resultsBox.firstChild) resultsBox.removeChild(resultsBox.firstChild);
      if (!q) {
        resultsBox.style.display = 'none';
        return;
      }
      var hits = searchProducts(q);
      if (!hits.length) {
        resultsBox.style.display = 'none';
        return;
      }
      var i, btn, added = 0;
      for (i = 0; i < hits.length; i++) {
        if (!hits[i] || !hits[i].name) continue;
        (function (p) {
          btn = el('button', 'ncr-result-btn', p.name);
          btn.type = 'button';
          btn.addEventListener('click', function () {
            selectedItemKey = keyOf(p);
            selectedItemName = p.name;
            itemF.input.value = p.name;
            resultsBox.style.display = 'none';
          });
          resultsBox.appendChild(btn);
          added++;
        })(hits[i]);
      }
      resultsBox.style.display = added ? 'block' : 'none';
    });

    submitBtn.addEventListener('click', function () {
      var saved = addRequest({
        customer: customerF.input.value,
        phone: phoneF.input.value,
        item: itemF.input.value,
        itemKey: selectedItemKey,
        qty: qtyF.input.value,
        note: noteF.input.value
      });
      if (!saved) {
        var msg = t('تأكد من اسم العميل والصنف ورقم الموبايل والكمية.', 'Check customer name, item, mobile number, and quantity.');
        statusMsg.textContent = msg;
        toast(msg, 'error');
        return;
      }
      customerF.input.value = '';
      phoneF.input.value = '';
      itemF.input.value = '';
      qtyF.input.value = '1';
      noteF.input.value = '';
      selectedItemKey = '';
      selectedItemName = '';
      resultsBox.style.display = 'none';
      var okMsg = t('تم تسجيل الطلب بنجاح.', 'Request saved.');
      statusMsg.textContent = okMsg;
      toast(okMsg, 'success');
    });

    var arrivedHead = el('div', 'ncr-sec-head');
    arrivedHead.appendChild(el('h4', '', t('وصل — بلّغ العميل', 'Arrived — Notify Customer')));
    var badge = el('span', 'ncr-badge', '0');
    badge.id = 'ncrArrivedBadge';
    arrivedHead.appendChild(badge);
    card.appendChild(arrivedHead);

    var arrivedList = el('div', 'ncr-list');
    arrivedList.id = 'ncrArrivedList';
    card.appendChild(arrivedList);

    var waitingHead = el('div', 'ncr-sec-head');
    waitingHead.appendChild(el('h4', '', t('مستني', 'Waiting')));
    card.appendChild(waitingHead);

    var waitingList = el('div', 'ncr-list');
    waitingList.id = 'ncrWaitingList';
    card.appendChild(waitingList);

    return card;
  }

  function isProductsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView) return;
    var existing = document.getElementById(CARD_ID);
    if (!isProductsPage()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (pageView.hidden) return;
    if (existing) return;
    pageView.appendChild(buildCard());
    refreshLists();
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      ensureMounted();
    });
    observer.observe(pageView, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    ensureMounted();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();