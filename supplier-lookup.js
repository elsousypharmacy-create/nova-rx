/* Supplier lookup on the sale screen (Epic #53, task 08).
   DOM layer only: all data comes from window.NOVA_SUPPLIER_PROVIDER,
   which the network provider (built separately) will supply. When the
   provider is missing, buttons report that suppliers are not linked yet
   and nothing breaks. Passwords are never stored, logged or displayed. */
(function () {
  'use strict';

  var SEARCH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

  var EN = {
    'الموردين': 'Suppliers',
    'الرصيد': 'Stock',
    'منخفض': 'Low',
    'الموردين غير مربوطين بعد': 'Suppliers are not linked yet',
    'جاري البحث عند الموردين…': 'Searching suppliers…',
    'عند الموردين': 'at suppliers',
    'رصيدك الحالي': 'Your current stock',
    'علبة': 'packs',
    'الأنسب': 'Best',
    'متوفر': 'Available',
    'غير متوفر': 'Out of stock',
    'أضف لطلبية المورد': 'Add to supplier draft',
    'تمت الإضافة': 'Added',
    'بدائل اقترحها المورد (غالباً نفس المادة الفعالة، راجعها)': 'Alternatives suggested by the supplier (usually same active ingredient, review them)',
    'سعر الصيدلية قبل التوصيل': 'Pharmacy price before delivery',
    'آخر تحديث': 'Last update',
    'إغلاق': 'Close',
    'إدارة الموردين': 'Manage suppliers',
    'تعذر الاتصال': 'Connection failed',
    'إضافة مورد': 'Add supplier',
    'اختار المورد': 'Choose supplier',
    'الإيميل': 'Email',
    'كلمة السر': 'Password',
    'فحص الاتصال': 'Test connection',
    'حفظ': 'Save',
    'إلغاء': 'Cancel',
    'فحص': 'Test',
    'مربوط': 'Linked',
    'خطأ': 'Error',
    'قريباً': 'Soon',
    'جاهز': 'Ready',
    'الحساب': 'Account',
    'كلمة السر بتتحفظ مشفّرة على سيرفر NOVA ومش بتظهر تاني، حتى ليك. تقدر تمسح الربط في أي وقت. النظام بيقرأ الأسعار بس، وما بيطلبش حاجة.': 'The password is stored encrypted on the NOVA server and is never shown again, even to you. You can unlink at any time. The system only reads prices and never orders anything.',
    'إدارة حسابات الموردين وربطهم بالأسعار.': 'Manage supplier accounts and price links.',
    'جاري الفحص…': 'Testing…',
    'جاري الحفظ…': 'Saving…',
    'خصم عن سعر الجمهور': 'Discount off public price'
  };

  function isEn() {
    var c = (document.documentElement.className || '') + ' ' + (document.body ? document.body.className : '');
    return c.indexOf('lang-en') !== -1;
  }
  function tr(ar) {
    return isEn() && EN[ar] ? EN[ar] : ar;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function provider() {
    return window.NOVA_SUPPLIER_PROVIDER || null;
  }

  var modelApi = null;
  import('./worker/procurement/ui-model.js').then(function (m) { modelApi = m; }).catch(function () {});

  var draftStore = null;
  function draft() {
    if (!draftStore && modelApi) {
      try { draftStore = modelApi.createDraftStore(window.localStorage); } catch (e) { draftStore = null; }
    }
    return draftStore;
  }

  function productStockByBarcode(barcode) {
    var demo = window.NOVA_DEMO;
    if (!demo || !demo.products) return null;
    for (var i = 0; i < demo.products.length; i++) {
      if (String(demo.products[i].barcode) === String(barcode)) return demo.products[i];
    }
    return null;
  }

  /* ---------- modal helpers ---------- */
  function openModal(cardClass, labelledBy) {
    closeModal();
    var d = document.createElement('div');
    d.className = 'modal-backdrop active';
    d.id = 'novaSupplierBackdrop';
    d.style.zIndex = '9300';
    d.innerHTML = '<div class="modal-card ' + cardClass + '" role="dialog" aria-modal="true"' +
      (labelledBy ? ' aria-label="' + esc(labelledBy) + '"' : '') + '></div>';
    d.addEventListener('click', function (e) { if (e.target === d) closeModal(); });
    document.body.appendChild(d);
    return d.querySelector('.modal-card');
  }
  function closeModal() {
    var old = document.getElementById('novaSupplierBackdrop');
    if (old) old.remove();
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('novaSupplierBackdrop')) closeModal();
  });

  /* ---------- lookup popup ---------- */
  function purchasePrefs() {
    var defaults = { suppliers: ['aumet', 'pharmaoverseas'], aumetSellers: [] };
    try { return Object.assign(defaults, JSON.parse(localStorage.getItem('novaPurchasePrefsV1') || '{}')); }
    catch (e) { return defaults; }
  }
  function sellerScopeHtml() {
    var prefs = purchasePrefs();
    var enabled = Array.isArray(prefs.suppliers) && prefs.suppliers.indexOf('aumet') !== -1;
    var count = Array.isArray(prefs.aumetSellers) ? prefs.aumetSellers.length : 0;
    var message = !enabled ? 'أوميت متوقف في اختيارات الموردين' : !count
      ? 'أوميت مستبعد من البحث: اختَر مخازنك أولًا على هذا المتصفح'
      : 'البحث في أوميت داخل ' + count + ' مخزن محدد على هذا المتصفح';
    return '<div class="sp-scope"><span>' + esc(tr(message)) + '</span> <button type="button" class="sp-link" data-aumet-scope>' + tr('اختيار مخازن أوميت') + '</button></div>';
  }
  function bindSellerScope(card, query, stock) {
    var button = card.querySelector('[data-aumet-scope]');
    if (button) button.addEventListener('click', function () { openSellerScope(query, stock); });
  }
  function openSellerScope(query, stock) {
    var prefs = purchasePrefs();
    var selected = (Array.isArray(prefs.aumetSellers) ? prefs.aumetSellers : []).map(String);
    var card = openModal('ss-card', tr('اختيار مخازن أوميت'));
    card.innerHTML = '<div class="modal-header"><h3>' + tr('اختيار مخازن أوميت') + '</h3></div><div class="ss-body">' + tr('جاري قراءة المخازن…') + '</div><div class="modal-footer"><button class="btn btn-secondary" data-back>' + tr('إلغاء') + '</button><button class="btn btn-primary" data-save-scope disabled>' + tr('حفظ وإعادة البحث') + '</button></div>';
    card.querySelector('[data-back]').addEventListener('click', function () { openLookup(query, stock); });
    provider().listSellers().then(function (r) {
      if (!document.body.contains(card)) return;
      var sellers = (r.sellers || []).filter(function (s) { return !s.locked; });
      var body = card.querySelector('.ss-body');
      if (!sellers.length) { body.textContent = tr('مخازن حساب أوميت غير متاحة؛ جدّد جلسة المورد ثم حاول تاني. الاختيارات المحفوظة لم تتغير.'); return; }
      body.innerHTML = '<p>' + tr('اختَر المخازن المسموح البحث فيها. الحفظ يفعّل أوميت على هذا المتصفح.') + '</p>' + sellers.map(function (s) {
        return '<label style="display:flex;align-items:center;gap:10px;min-height:44px"><input type="checkbox" data-seller-id="' + esc(s.id) + '"' + (selected.indexOf(String(s.id)) !== -1 ? ' checked' : '') + '>' + esc(s.name) + '</label>';
      }).join('') + '<p class="sp-err" data-scope-error></p>';
      var save = card.querySelector('[data-save-scope]'); save.disabled = false;
      save.addEventListener('click', function () {
        var ids = Array.from(body.querySelectorAll('[data-seller-id]:checked')).map(function (input) { return input.getAttribute('data-seller-id'); });
        var error = body.querySelector('[data-scope-error]');
        if (!ids.length) { error.textContent = tr('اختَر مخزنًا واحدًا على الأقل'); return; }
        // Re-read before saving so days, coverage and other supplier choices survive.
        var latest = purchasePrefs(); latest.aumetSellers = ids;
        latest.suppliers = Array.isArray(latest.suppliers) ? latest.suppliers.slice() : [];
        if (latest.suppliers.indexOf('aumet') === -1) latest.suppliers.push('aumet');
        try { localStorage.setItem('novaPurchasePrefsV1', JSON.stringify(latest)); }
        catch (e) { error.textContent = tr('تعذر حفظ الاختيار؛ فعّل تخزين المتصفح ثم حاول تاني'); return; }
        openLookup(query, stock);
      });
    }).catch(function () {
      if (document.body.contains(card)) card.querySelector('.ss-body').textContent = tr('تعذر قراءة مخازن أوميت؛ الاختيارات المحفوظة لم تتغير. جدّد جلسة المورد ثم حاول تاني.');
    });
  }
  function openLookup(query, stock) {
    var card = openModal('sp-card', tr('الموردين'));
    var title = esc(query || '');
    var head = '<div class="modal-header"><div><h3>' + title + ' ' + tr('عند الموردين') + '</h3>' +
      (Number.isFinite(stock) ? '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">' + tr('رصيدك الحالي') + ' ' + stock + ' ' + tr('علبة') + '</div>' : '') +
      '</div></div>';
    if (!provider()) {
      card.innerHTML = head + '<div class="sp-body"><div class="sp-state">' + tr('الموردين غير مربوطين بعد') + '</div></div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" data-close>' + tr('إغلاق') + '</button></div>';
      bindClose(card);
      return;
    }
    card.innerHTML = head + sellerScopeHtml() + '<div class="sp-body"><div class="sp-state">' + tr('جاري البحث عند الموردين…') + '</div></div>' +
      '<div class="modal-footer"><span class="sp-foot-note">' + tr('سعر الصيدلية قبل التوصيل') + '</span><button class="btn btn-secondary" data-close>' + tr('إغلاق') + '</button></div>';
    bindClose(card);
    bindSellerScope(card, query, stock);
    provider().search(query, { requestedQty: 1 }).then(function (res) {
      if (!document.body.contains(card)) return;
      renderLookup(card, res);
    }).catch(function () {
      if (!document.body.contains(card)) return;
      var body = card.querySelector('.sp-body');
      if (body) body.innerHTML = '<div class="sp-err">' + tr('تعذر الاتصال') + '</div>';
    });
  }

  function bindClose(root) {
    root.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
    var link = root.querySelector('[data-suppliers]');
    if (link) link.addEventListener('click', function () { openSuppliersScreen(); });
  }

  function rowHtml(row, showSeller, groupMode) {
    var meta = [];
    if (groupMode && showSeller && row.sellerName) meta.push('<span>' + esc(row.sellerName) + '</span>');
    if (!groupMode) meta.push('<span>' + esc(row.supplierName) + '</span>');
    if (row.unitPriceLabel) meta.push('<span>' + esc(row.unitPriceLabel) + '</span>');
    var tag = row.best ? '<span class="sp-tag t-best">' + tr('الأنسب') + '</span>'
      : row.eligible ? '<span class="sp-tag t-ok">' + esc(row.stockLabel) + '</span>'
      : '<span class="sp-tag t-off">' + esc(row.stockLabel) + '</span>';
    meta.push(tag);
    var disc = Number.isFinite(row.discountPct)
      ? '<span class="sp-disc">' + tr('خصم عن سعر الجمهور') + ' ' + row.discountPct + '%</span>' : '';
    var pub = Number.isFinite(row.publicPrice) ? '<span class="sp-pub">' + row.publicPrice + '</span>' : '';
    var price = Number.isFinite(row.packPrice)
      ? '<div class="sp-p">' + Number(row.packPrice).toFixed(2) + ' <span style="font:11px var(--font);color:var(--text-muted)">ج.م</span></div>' : '';
    return '<div class="sp-row' + (row.best ? ' best' : '') + (row.eligible ? '' : ' off') + '" data-key="' + esc(row.key) + '">' +
      '<div><div class="sp-name">' + esc(row.productName) + '</div><div class="sp-meta">' + meta.join('') + '</div></div>' +
      '<div class="sp-price"><div>' + pub + disc + '</div>' + price + '</div>' +
      '<div class="sp-add"><div class="sp-qty"><button class="btn btn-secondary" data-dec>−</button><b>1</b><button class="btn btn-secondary" data-inc>+</button></div>' +
      '<button class="btn btn-primary" data-add>' + tr('أضف لطلبية المورد') + '</button></div></div>';
  }

  function groupsHtml(groups, rowsByKey) {
    var multi = groups.length > 1 || groups.some(function (g) { return g.rows.some(function (r) { return r.sellerName; }); });
    var html = '';
    groups.forEach(function (g) {
      if (multi) html += '<div class="sp-group-head">' + esc(g.supplierName) + '</div>';
      g.rows.forEach(function (row) {
        rowsByKey[row.key] = row;
        html += rowHtml(row, !!row.sellerName, multi);
      });
    });
    return html;
  }

  function renderLookup(card, res) {
    var body = card.querySelector('.sp-body');
    if (!body || !modelApi) return;
    // Re-read the shared saved selection at render time too, including injected providers.
    var allowed=[];try{allowed=JSON.parse(localStorage.getItem('novaPurchasePrefsV1')||'{}').aumetSellers||[];}catch(e){}
    res=JSON.parse(JSON.stringify(res));
    (res.results||[]).forEach(function(r){r.offers=(r.offers||[]).filter(function(row){var o=row.offer||row;return o.supplierId!=='aumet'||allowed.map(String).indexOf(String(o.sellerId))!==-1;});r.best=null;});
    var model = modelApi.buildLookupModel(res, { requestedQty: 1 });
    var rowsByKey = {};
    var html = groupsHtml(model.groups, rowsByKey);
    (res.suppliers || []).forEach(function (s) {
      if (s && s.state === 'error') {
        html += '<div class="sp-err">' + esc(s.name || s.id) + ': ' + esc(s.message || tr('تعذر الاتصال')) + '</div>';
      }
    });
    model.altGroups.forEach(function (alt, i) {
      html += '<div class="sp-sec">' + (i === 0 ? esc(model.suggestionsNote || '') : '') + '</div>';
      html += groupsHtml(alt.groups, rowsByKey);
    });
    if (!Object.keys(rowsByKey).length) html += '<div class="sp-state">' + tr('لا توجد عروض من المخازن المحددة؛ راجع إعدادات المشتريات') + '</div>';
    body.innerHTML = html;

    var foot = card.querySelector('.modal-footer');
    if (foot) {
      var note = tr('سعر الصيدلية قبل التوصيل');
      if (res.fetchedAt) {
        var t = new Date(res.fetchedAt);
        if (!isNaN(t)) note += ' · ' + tr('آخر تحديث') + ' ' + t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      foot.innerHTML = '<span class="sp-foot-note">' + note + '</span>' +
        '<button class="sp-link" data-suppliers>' + tr('إدارة الموردين') + '</button>' +
        '<button class="btn btn-secondary" data-close>' + tr('إغلاق') + '</button>';
      bindClose(card);
    }

    body.querySelectorAll('.sp-row').forEach(function (el) {
      var row = rowsByKey[el.getAttribute('data-key')];
      if (!row) return;
      var qtyEl = el.querySelector('.sp-qty b');
      var qty = 1;
      el.querySelector('[data-dec]').addEventListener('click', function () { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
      el.querySelector('[data-inc]').addEventListener('click', function () { qty = Math.min(999, qty + 1); qtyEl.textContent = qty; });
      el.querySelector('[data-add]').textContent=tr('إضافة لسلة المورد');
      el.querySelector('[data-add]').disabled=!row.eligible;
      el.querySelector('[data-add]').addEventListener('click', async function (e) {
        var b=e.currentTarget;if(b.disabled)return;
        if(qty<Number(row.minimumOrderQuantity||1)||(Number.isFinite(row.availableQuantity)&&qty>row.availableQuantity)){
          b.textContent=tr('راجع الكمية المتاحة والحد الأدنى');return;
        }
        b.disabled=true;b.textContent=tr('جارٍ مراجعة سلة المورد…');
        try {
          var r=await provider().addToSupplierCart({supplierId:row.supplierId,productId:row.supplierProductId,sellerId:row.sellerId,quantity:qty,price:row.unitPrice,query:row.productName},function(p){return window.confirm(row.supplierName+' — '+(row.sellerName||'')+'\n'+row.productName+'\n'+tr('في السلة')+': '+p.before+' + '+p.quantity+' = '+p.target+'\n'+tr('تأكيد الإضافة الفعلية لسلة المورد؟'));});
          if(r.ok&&r.state==='verified') {b.textContent=tr('تم التأكد من الإضافة عند المورد');return;}
          if(r.state==='cancelled'){b.textContent=tr('إضافة لسلة المورد');b.disabled=false;return;}
          throw new Error(r.error||'cart-readback-unavailable');
        } catch(error) {
          b.disabled=false;b.textContent=tr('لم تتأكد الإضافة — إعادة التحقق');
          var note=el.querySelector('.sp-cart-error');if(!note){note=document.createElement('p');note.className='sp-cart-error sp-err';el.appendChild(note);}
          note.textContent=tr(error.message==='cart-storage-unavailable'?'فعّل تخزين المتصفح لحفظ حالة الإضافة قبل التنفيذ':error.message==='cart-session-required'?'جلسة المورد تحتاج تجديدًا يدعم السلة':error.message==='cart-not-supported'?'ربط سلة هذا المورد غير جاهز بعد؛ لم تتم الإضافة':'تعذر تأكيد الإضافة؛ راجع سلة المورد قبل محاولة جديدة');
        }
      });
    });
  }

  /* ---------- suppliers screen ---------- */
  function stateChip(state) {
    if (state === 'ok') return '<span class="ss-tag ss-ok"><span class="ss-dot"></span>' + tr('مربوط') + '</span>';
    if (state === 'error') return '<span class="ss-tag ss-err"><span class="ss-dot"></span>' + tr('خطأ') + '</span>';
    return '<span class="ss-tag ss-off">' + tr('قريباً') + '</span>';
  }

  function openSuppliersScreen() {
    var card = openModal('ss-card', tr('الموردين'));
    var p = provider();
    var head = '<div class="modal-header"><h3>' + tr('الموردين') + '</h3><button class="btn btn-secondary" data-close>' + tr('إغلاق') + '</button></div>';
    if (!p) {
      card.innerHTML = head + '<div class="ss-body"><div class="sp-state">' + tr('الموردين غير مربوطين بعد') + '</div></div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" data-close>' + tr('إغلاق') + '</button></div>';
      bindClose(card);
      return;
    }
    card.innerHTML = head + '<div class="ss-body"><div class="sp-state">' + tr('جاري البحث عند الموردين…') + '</div></div>' +
      '<div class="modal-footer"><button class="btn btn-primary" data-add-supplier>+ ' + tr('إضافة مورد') + '</button></div>';
    bindClose(card);
    p.listSuppliers().then(function (list) {
      if (!document.body.contains(card)) return;
      var body = card.querySelector('.ss-body');
      body.innerHTML = (list || []).map(function (s) {
        var initials = String(s.name || s.id || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '··';
        var sub = s.account ? tr('الحساب') + ': ' + esc(s.account) : (s.message ? esc(s.message) : '');
        return '<div class="ss-row" data-id="' + esc(s.id) + '"><div class="ss-logo">' + esc(initials) + '</div>' +
          '<div class="ss-grow"><div class="ss-name">' + esc(s.name || s.id) + '</div><div class="ss-sub">' + sub + '</div></div>' +
          stateChip(s.state) +
          (s.state !== 'off' ? '<button class="btn btn-secondary" data-test>' + tr('فحص') + '</button>' : '') +
          '</div>';
      }).join('') || '<div class="sp-state">' + tr('لا توجد عروض من المخازن المحددة؛ راجع إعدادات المشتريات') + '</div>';
      body.querySelectorAll('[data-test]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.closest('.ss-row').getAttribute('data-id');
          b.disabled = true;
          p.testSupplier(id).then(function (r) {
            b.disabled = false;
            var chip = b.closest('.ss-row').querySelector('.ss-tag');
            if (chip) chip.outerHTML = stateChip(r && r.ok ? 'ok' : 'error');
            if (r && r.message) b.closest('.ss-row').querySelector('.ss-sub').textContent = r.message;
          }).catch(function () { b.disabled = false; });
        });
      });
    }).catch(function () {});
    var addBtn = card.querySelector('[data-add-supplier]');
    if (addBtn) addBtn.addEventListener('click', function () { openAddSupplier(card, p); });
  }

  function openAddSupplier(card, p) {
    p.listSuppliers().then(function (list) {
      if (!document.body.contains(card)) return;
      var available = (list || []).filter(function (s) { return s.available; });
      var selected = available.length ? available[0].id : null;
      card.querySelector('.modal-header h3').textContent = tr('إضافة مورد');
      var body = card.querySelector('.ss-body');
      body.innerHTML =
        '<div><span class="ss-lbl">' + tr('اختار المورد') + '</span><div class="ss-sel">' +
          (list || []).map(function (s) {
            var cls = s.available ? (s.id === selected ? 'ss-opt on' : 'ss-opt') : 'ss-opt dis';
            var small = s.available ? tr('جاهز') : tr('قريباً');
            return '<div class="' + cls + '" data-id="' + esc(s.id) + '">' + esc(s.name || s.id) + '<small>' + small + '</small></div>';
          }).join('') + '</div></div>' +
        '<div><span class="ss-lbl">' + tr('الإيميل') + '</span><input class="ss-in" dir="ltr" type="email" autocomplete="off"></div>' +
        '<div><span class="ss-lbl">' + tr('كلمة السر') + '</span><input class="ss-in" dir="ltr" type="password" autocomplete="off"></div>' +
        '<div class="ss-msg"></div>' +
        '<div class="ss-note">' + tr('كلمة السر بتتحفظ مشفّرة على سيرفر NOVA ومش بتظهر تاني، حتى ليك. تقدر تمسح الربط في أي وقت. النظام بيقرأ الأسعار بس، وما بيطلبش حاجة.') + '</div>';
      card.querySelector('.modal-footer').innerHTML =
        '<button class="btn btn-secondary" data-back>' + tr('إلغاء') + '</button>' +
        '<button class="btn btn-secondary" data-check>' + tr('فحص الاتصال') + '</button>' +
        '<button class="btn btn-primary" data-save>' + tr('حفظ') + '</button>';

      body.querySelectorAll('.ss-opt').forEach(function (opt) {
        if (opt.classList.contains('dis')) return;
        opt.addEventListener('click', function () {
          body.querySelectorAll('.ss-opt').forEach(function (o) { o.classList.remove('on'); });
          opt.classList.add('on');
          selected = opt.getAttribute('data-id');
        });
      });

      var emailIn = body.querySelector('input[type=email]');
      var passIn = body.querySelector('input[type=password]');
      var msg = body.querySelector('.ss-msg');
      function connect() {
        var cred = { supplierId: selected, email: emailIn.value.trim(), password: passIn.value };
        passIn.value = '';
        if (!cred.supplierId) return Promise.resolve({ ok: false, message: tr('اختار المورد') });
        return p.connectSupplier(cred);
      }
      card.querySelector('[data-back]').addEventListener('click', openSuppliersScreen);
      card.querySelector('[data-check]').addEventListener('click', function () {
        msg.textContent = tr('جاري الفحص…');
        connect().then(function (r) { msg.textContent = (r && r.message) || (r && r.ok ? tr('مربوط') : tr('خطأ')); })
          .catch(function () { msg.textContent = tr('تعذر الاتصال'); });
      });
      card.querySelector('[data-save]').addEventListener('click', function () {
        msg.textContent = tr('جاري الحفظ…');
        connect().then(function (r) {
          msg.textContent = (r && r.message) || (r && r.ok ? tr('مربوط') : tr('خطأ'));
          if (r && r.ok) setTimeout(openSuppliersScreen, 600);
        }).catch(function () { msg.textContent = tr('تعذر الاتصال'); });
      });
    }).catch(function () {});
  }

  /* ---------- row unit inside suggestion rows ---------- */
  function decorateRow(item) {
    if (item.querySelector('.su')) return;
    if (item.closest('#suggestionsBox') === null) return;
    var tag = item.querySelector('.sugg-tag');
    if (!tag) return;
    var prod = productStockByBarcode(tag.textContent.trim());
    if (!prod) return;
    var nameEl = item.querySelector('.sugg-primary');
    var name = nameEl ? nameEl.textContent.trim() : '';
    var st = modelApi ? modelApi.stockUnitState(prod.stock) : { tone: prod.stock < 30 ? 'low' : 'ok', label: '' };
    var low = st.tone === 'low';
    var w = document.createElement('div');
    w.className = 'su ' + (low ? 'su-low' : 'su-ok');
    w.innerHTML = '<span class="su-stock"><span class="su-dot"></span><small>' + tr('الرصيد') + '</small><b>' + prod.stock + '</b>' +
      (low ? '<small>· ' + tr('منخفض') + '</small>' : '') + '</span>' +
      (low ? '<button type="button" class="su-btn">' + SEARCH_SVG + tr('الموردين') + '</button>'
           : '<button type="button" class="su-btn icon" title="' + tr('الموردين') + '" aria-label="' + tr('الموردين') + '">' + SEARCH_SVG + '</button>');
    w.querySelector('.su-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      openLookup(name, prod.stock);
    });
    item.insertBefore(w, item.lastElementChild);
  }

  function decorateEmpty(box) {
    var kids = box.querySelectorAll('div');
    for (var i = 0; i < kids.length; i++) {
      var t = kids[i].textContent || '';
      if ((t.indexOf('No products found matching') !== -1 || t.indexOf('لا توجد منتجات مطابقة') !== -1) && !kids[i].querySelector('.su-empty')) {
        var holder = document.createElement('div');
        holder.className = 'su-empty';
        holder.innerHTML = '<button type="button" class="su-btn">' + SEARCH_SVG + tr('الموردين') + '</button>';
        holder.querySelector('.su-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          var input = document.getElementById('mainSearchInput');
          openLookup(input ? input.value.trim() : '', null);
        });
        kids[i].appendChild(holder);
      }
    }
  }

  function scanSuggestions() {
    var box = document.getElementById('suggestionsBox');
    if (!box) return;
    box.querySelectorAll('.suggestion-item').forEach(decorateRow);
    decorateEmpty(box);
  }

  /* ---------- settings entry ---------- */
  function decorateSettings() {
    var grid = document.querySelector('.nova-settings-grid');
    if (!grid || grid.querySelector('[data-su-settings]')) return;
    var card = document.createElement('div');
    card.className = 'nova-setting-card';
    card.setAttribute('data-su-settings', '1');
    card.innerHTML = '<h3>' + tr('الموردين') + '</h3><p>' + tr('إدارة حسابات الموردين وربطهم بالأسعار.') + '</p>' +
      '<button type="button" class="nova-page-btn">' + tr('إدارة الموردين') + '</button>';
    card.querySelector('button').addEventListener('click', openSuppliersScreen);
    grid.appendChild(card);
  }

  function scanAll() {
    scanSuggestions();
    decorateSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  function init() {
    scanAll();
    new MutationObserver(function () { scanAll(); })
      .observe(document.body, { childList: true, subtree: true });
  }
})();

