
(function (root) {
  'use strict';
  var en = function () { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } };
  var T = function (a, e) { return en() ? e : a; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var go = function (page) { var b = document.querySelector('.nova-tab[data-page="' + page + '"]'); if (b) b.click(); else if (page === 'purchases') location.href = '/purchases'; };
  function row(ok, title, body, actions) {
    return '<div class="nsw-row" data-ok="' + (ok === true ? '1' : ok === false ? '0' : '') + '"><span class="nsw-dot" aria-hidden="true">' + (ok === true ? '✓' : ok === false ? '!' : '·') + '</span>' +
      '<div class="nsw-main"><strong>' + esc(title) + '</strong><div class="nsw-body">' + body + '</div></div><div class="nsw-act">' + (actions || '') + '</div></div>';
  }
  var STATE = function () { return { ok: T('متصل', 'Connected'), expired: T('انتهت الجلسة', 'Session expired'), off: T('غير مربوط', 'Not connected') }; };
  async function suppliersRow() {
    var st = STATE(), body = '', ok = null;
    try {
      var r = await fetch('/api/suppliers/status', { cache: 'no-store' });
      if (!r.ok) throw new Error('x');
      var j = await r.json(), list = (j && j.suppliers) || [];
      ok = list.length > 0 && list.every(function (s) { return s.state === 'ok'; });
      body = list.map(function (s) { return '<span class="nsw-chip" data-s="' + esc(s.state) + '"><b>' + esc(s.name) + '</b> <span>' + esc(st[s.state] || st.off) + '</span></span>'; }).join('');
      if (list.some(function (s) { return s.state !== 'ok'; })) body += '<div class="nsw-hint">' + T('سجّل دخولك في موقع المورد من متصفحك، وبعدها اضغط تحديث الحالة.', 'Sign in on the supplier site in your browser, then press Refresh status.') + '</div>';
    } catch (e) { body = '<div class="nsw-hint">' + T('اختياري — يتفعل تلقائيًا عند ربط الموردين.', 'Optional — activates when suppliers are connected.') + '</div>'; ok = null; }
    return row(ok, T('الموردين', 'Suppliers'), body, '<button type="button" class="btn" data-nsw="refresh">' + T('تحديث الحالة', 'Refresh status') + '</button><button type="button" class="btn" data-nsw="purchases">' + T('افتح المشتريات', 'Open purchases') + '</button>');
  }
  function syncRow() {
    var s = root.novaSync, p = null, ok = null, body;
    try { p = s && s.pending ? s.pending() : null; } catch (e) { p = null; }
    if (!s) { body = T('المزامنة مقفولة على هذا الجهاز. فعّلها من «الحسابات والمزامنة» على جهاز واحد الأول.', 'Sync is off on this device. Turn it on under Accounts and sync, on one device first.'); }
    else { ok = !(p && (p.review || p.pending)); body = T('الفواتير المنتظرة: ', 'Waiting invoices: ') + esc(p ? p.pending : 0) + ' · ' + T('تحتاج مراجعة: ', 'Need review: ') + esc(p ? p.review : 0); }
    return row(ok, T('المزامنة بين الأجهزة', 'Sync between devices'), '<div class="nsw-hint">' + body + '</div>', '');
  }
  async function render(el) {
    var name = (document.querySelector('.pharmacy-banner-copy strong') || {}).textContent || T('صيدليتك', 'Your pharmacy');
    el.innerHTML = '<h3>' + T('ابدأ هنا: تجهيز الصيدلية', 'Start here: set up your pharmacy') + '</h3><p>' + T('خطوات بسيطة تربط صيدليتك بالموردين والواتس اب والمزامنة. كل خطوة ممكن ترجع لها بعدين.', 'A few simple steps to connect your pharmacy to suppliers, WhatsApp and sync. You can come back to any step.') + '</p><div class="nsw-list">' +
      row(true, T('الصيدلية', 'Pharmacy'), '<div class="nsw-hint">' + esc(name) + '</div>', '<button type="button" class="btn btn-primary" data-nsw="wizard">' + T('معالج البدء السريع', 'Quick setup wizard') + '</button>') +
      row(null, T('الأصناف والرصيد', 'Products and stock'), '<div class="nsw-hint">' + T('ارفع ملف الأصناف من صفحة الأصناف، وبعده الرصيد الافتتاحي.', 'Upload your product file from the Products page, then the opening balance.') + '</div>', '<button type="button" class="btn" data-nsw="products">' + T('افتح الأصناف', 'Open products') + '</button>') +
      '<div data-nsw-slot="sup">' + row(null, T('الموردين', 'Suppliers'), '<div class="nsw-hint">…</div>', '') + '</div>' +
      row(null, T('واتس اب', 'WhatsApp'), '<div class="nsw-hint">' + T('افتح المحادثات وتأكد إن الرسائل بتوصل.', 'Open the conversations and make sure messages arrive.') + '</div>', '<button type="button" class="btn" data-nsw="wa">' + T('افتح المحادثات', 'Open conversations') + '</button>') +
      syncRow() + '</div>';
    var slot = el.querySelector('[data-nsw-slot="sup"]');
    if (slot) slot.innerHTML = await suppliersRow();
    function openWaOverlay() {
      var old = document.getElementById('novaWaOverlay');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var ov = document.createElement('div');
      ov.id = 'novaWaOverlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0d10;display:flex;flex-direction:column;';
      ov.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:#14181d;border-bottom:1px solid #343b44;"><button type="button" class="btn btn-secondary" data-wa-back>' + T('رجوع للكاشير', 'Back to cashier') + '</button><strong>' + T('المحادثات', 'Chats') + '</strong></div>' +
        '<div data-wa-st style="padding:14px;color:#a4adb7;">' + T('جارٍ تحميل المحادثات…', 'Loading conversations…') + '</div>' +
        '<iframe src="/whatsapp" title="' + T('المحادثات', 'Chats') + '" style="flex:1;border:0;width:100%;display:none;"></iframe>';
      document.body.appendChild(ov);
      var fr = ov.querySelector('iframe'), st = ov.querySelector('[data-wa-st]'), tm;
      function arm() {
        clearTimeout(tm);
        st.style.display = 'block';
        st.textContent = T('جارٍ تحميل المحادثات…', 'Loading conversations…');
        fr.style.display = 'none';
        tm = setTimeout(function () {
          st.innerHTML = '<span>' + T('تعذر تحميل المحادثات خلال 10 ثوانٍ.', 'Could not load conversations within 10 seconds.') + '</span> <button type="button" class="btn btn-primary" data-wa-retry>' + T('إعادة المحاولة', 'Retry') + '</button>';
        }, 10000);
      }
      fr.onload = function () { clearTimeout(tm); st.style.display = 'none'; fr.style.display = 'block'; };
      ov.onclick = function (ev) {
        if (ev.target.closest && ev.target.closest('[data-wa-back]')) { clearTimeout(tm); ov.remove(); go('sale'); }
        else if (ev.target.closest && ev.target.closest('[data-wa-retry]')) { arm(); fr.src = '/whatsapp'; }
      };
      arm();
    }
    el.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-nsw]'); if (!b) return;
      var a = b.getAttribute('data-nsw');
      if (a === 'refresh') render(el); else if (a === 'products') go('products'); else if (a === 'purchases') go('purchases'); else if (a === 'wa') openWaOverlay(); else if (a === 'wizard' && typeof root.novaOpenQuickSetup === 'function') root.novaOpenQuickSetup();
    };
  }
  root.novaSetup = { mount: function (el) { if (!el) return; try { render(el); } catch (e) { el.innerHTML = ''; } } };
  /* startup diet (batch A): this file is lazy now, so Settings may already be on screen: fill its setup card */
  if (typeof document !== 'undefined' && document.getElementById) root.novaSetup.mount(document.getElementById('novaSetupCard'));
})(typeof window !== 'undefined' ? window : globalThis);
