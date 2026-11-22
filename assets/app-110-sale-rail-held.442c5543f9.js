
(function(){
  'use strict';
  var mq = window.matchMedia ? window.matchMedia('(min-width: 900px) and (orientation: landscape)') : null;
  var aside = document.querySelector('.pos-root>.customer-sidebar');
  var header = document.querySelector('.nova-sale-actions');
  if (!mq || !aside || !header) return;
  var HELD_KEY = 'nova-rx-held-invoices-v1';
  var $ = function (id) { return document.getElementById(id); };
  var isEn = function () { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } };
  var SVG = {
    user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    userAdd: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m-3-3h6"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/></svg>'
  };
  // rail skeleton (inside the aside, hidden unless body.nova-rail): customer card on top, then invoice tiles, held invoices, stickers
  var box = document.createElement('div'); box.className = 'nova-rail-box';
  box.innerHTML = '<div class="nova-rail-cust"><div class="nova-cust-card">'
    + '<button type="button" id="novaCustCard" aria-haspopup="dialog"><span class="ncc-name">' + SVG.user + '<span class="nx-rail-name" data-ncc="name"></span></span>'
    + '<span class="ncc-row"><span class="ncc-phone nx-rail-name" data-ncc="phone"></span><span class="ncc-b ncc-pts nx-rail-name" data-ncc="pts"></span></span>'
    + '<span class="ncc-badges" data-ncc="badges"></span><span class="ncc-hist" data-ncc="hist"></span></button>'
    + '<button type="button" id="novaCustCardRefill" class="ncc-refill nx-rail-name" hidden></button>'
    + '<button type="button" id="novaCustCardX">' + SVG.x + '</button></div></div>'
    + '<div class="nova-rail-tiles"></div><div class="nova-rail-held-head"></div><div class="nova-rail-held" aria-live="polite"></div><div class="nova-rail-foot"></div>';
  aside.appendChild(box);
  var custTop = box.querySelector('.nova-rail-cust'), tiles = box.querySelector('.nova-rail-tiles'), heldHead = box.querySelector('.nova-rail-held-head'), heldBox = box.querySelector('.nova-rail-held'), foot = box.querySelector('.nova-rail-foot');
  var card = $('novaCustCard'), cardRefill = $('novaCustCardRefill'), cardX = $('novaCustCardX');
  var ncc = function (k) { return card.querySelector('[data-ncc="' + k + '"]'); };
  var modal = $('novaCustModal'), modalBody = $('novaCustModalBody');
  var TILE_IDS = ['btnNewSale', 'holdCurrentInvoice', 'btnClearInvoice'];
  var KEYS = { btnNewSale: 'F2', btnAddLoyalty: 'F3', btnClearInvoice: 'F4' };
  var marks = {};   // id -> comment placeholder at the original spot
  var on = false, origAddAria = 'إضافة أو تغيير العميل', lastEn = isEn();
  function park(el) { if (!el || marks[el.id]) return; var c = document.createComment('ux-p40:' + el.id); el.parentNode.insertBefore(c, el); marks[el.id] = c; }
  function unpark(el) { var c = el && marks[el.id]; if (!c) return; if (c.parentNode) c.parentNode.replaceChild(el, c); delete marks[el.id]; }
  // the app's translator re-applies data-nova-original-* on every language pass, so keep it in step
  function setAria(el, v) { el.dataset.novaOriginalAriaLabel = v; el.setAttribute('aria-label', v); }
  function addTo(el, html, cls) { var s = document.createElement('span'); s.className = 'nx-rail-add ' + (cls || ''); s.innerHTML = html; el.appendChild(s); return s; }
  function txt(id) { var n = $(id); return n ? n.textContent.trim() : ''; }
  function shown(id) { var n = $(id); return !!n && !n.hidden; }
  function custState() {
    var b = $('customerSelectedBox');
    var attached = !!b && b.style.display !== 'none' && !!txt('custCardName');
    return { attached: attached, name: attached ? txt('custCardName') : '' };
  }
  function debtOf(c) {
    try { var l = window.NovaCredit && window.NovaCredit.createCreditLedger(localStorage, 'nova.credit'); var v = l && c && c.id != null ? Number(l.balance(String(c.id))) : 0; return v > 0.004 ? v : 0; } catch (e) { return 0; }
  }
  function money(v) { var r = Math.round(v * 100) / 100; return (r % 1 ? r.toFixed(2) : String(r)); }
  function renderCard(c) {
    var en = isEn(), cust = window.novaAttachedCustomer || null;
    ncc('name').textContent = c.name;
    ncc('phone').textContent = txt('custCardPhone');
    var tier = txt('custCardTier'), pts = txt('custCardPoints');
    ncc('pts').textContent = [tier, pts !== '' ? pts + (en ? ' pts' : ' نقطة') : ''].filter(Boolean).join(' · ');
    var badges = ncc('badges'), html = '', debt = debtOf(cust);
    if (debt) html += '<span class="ncc-b ncc-debt">' + (en ? 'Owes ' + money(debt) + ' EGP' : 'عليه ' + money(debt) + ' ج') + '</span>';
    var canRefill = shown('custRefillBox');
    var chronic = canRefill ? txt('custChronicList') : '';
    if (chronic && chronic !== 'لا يوجد' && chronic !== 'None') {
      var hint = shown('custDaysSince') ? txt('custRefillHint') : '';
      var full = (en ? 'Chronic: ' : 'مزمن: ') + chronic + (shown('custDaysSince') ? ' · ' + txt('custDaysText') : '') + (hint ? ' · ' + hint : '');
      html += '<span class="ncc-b ncc-chronic nx-rail-name" title="' + esc(full) + '">' + esc(full) + '</span>';
    }
    if (badges.innerHTML !== html) badges.innerHTML = html;
    ncc('hist').textContent = en ? 'History ›' : 'السجل ‹';
    // AUDIT-02 (Gemini Neon draft, reviewed): one-tap «إعادة صرف» on the card when the app has a refill box for this customer
    cardRefill.hidden = !canRefill;
    if (canRefill) { var refillLbl = en ? 'Refill' : 'إعادة صرف'; if (cardRefill.textContent !== refillLbl) cardRefill.textContent = refillLbl; }
    card.classList.toggle('has-refill', canRefill);
    card.removeAttribute('aria-label');   // the visible content (name, phone, points, debt, chronic, «السجل») is the accessible name
    cardX.setAttribute('aria-label', en ? 'Remove customer' : 'إزالة العميل'); cardX.title = cardX.getAttribute('aria-label');
  }
  function syncCustomer() {
    var c = custState(), add = $('btnAddLoyalty');
    custTop.classList.toggle('is-on', on && c.attached);
    if (on && c.attached) renderCard(c);
    if (add && on) {
      var lab = add.querySelector('.nx-rail-label span'), sub = add.querySelector('.nx-rail-sub');
      if (lab) lab.textContent = isEn() ? 'Register customer' : 'تسجيل عميل';
      if (sub) sub.textContent = isEn() ? 'Cash sale without a customer' : 'بيع نقدي من غير عميل';
      // no aria-label in the rail: the visible text names it and the translator has nothing to rewrite
      add.removeAttribute('aria-label');
    }
    if (!c.attached && !modal.hidden) closeModal(false);
  }
  function itemsText(n) {
    if (isEn()) return n + (n === 1 ? ' item' : ' items');
    if (window.NovaFmt && window.NovaFmt.pluralItems) return window.NovaFmt.pluralItems(n); // same wording as the receipt
    if (n === 1) return 'صنف واحد'; if (n === 2) return 'صنفان'; if (n >= 3 && n <= 10) return n + ' أصناف'; return n + ' صنفًا';
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function renderHeld() {
    if (!on) { heldBox.innerHTML = ''; return; }
    var list = [];
    try { var s = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); if (Array.isArray(s)) list = s.filter(function (x) { return x && Array.isArray(x.lines); }); } catch (e) {}
    var first = list, back = isEn() ? 'Resume' : 'رجّعها', del = isEn() ? 'Delete' : 'حذف'; // UI-BATCH1: the rail is the one held list on desktop
    var html = first.map(function (x) {
      var who = x.customerName ? ' · <span class="nx-rail-name">' + esc(x.customerName) + '</span>' : '';
      return '<div class="nova-rail-row">' + SVG.clock + '<span class="nx-meta">' + esc(x.saleNumber || x.id) + ' · ' + esc(itemsText(x.lines.length)) + who + '</span><button type="button" data-rail-resume="' + esc(x.id) + '" aria-label="' + back + ' ' + esc(x.saleNumber || x.id) + '">' + back + '</button><button type="button" class="nx-del" data-rail-delete="' + esc(x.id) + '" aria-label="' + del + ' ' + esc(x.saleNumber || x.id) + '">' + del + '</button></div>';
    }).join('');
    heldBox.innerHTML = html;
  }
  heldBox.addEventListener('click', function (e) {
    var r = e.target.closest('[data-rail-resume]'), m = e.target.closest('[data-rail-more]'), dl = e.target.closest('[data-rail-delete]');
    if (dl) { // delegate to the app's own delete (keeps its undo toast and the cancel record)
      e.stopPropagation(); var did = dl.getAttribute('data-rail-delete'), hl = $('heldInvoiceList');
      var db = hl && Array.prototype.find.call(hl.querySelectorAll('[data-held-delete]'), function (b) { return b.getAttribute('data-held-delete') === did; });
      if (db) db.click(); return;
    }
    if (!r && !m) return;
    e.stopPropagation();   // the app closes the held panel on any outside click
    if (m) { var hb = $('btnHeldInvoices'); if (hb) hb.click(); return; }
    var id = r.getAttribute('data-rail-resume'), list = $('heldInvoiceList');
    var target = list && Array.prototype.find.call(list.querySelectorAll('[data-held-resume]'), function (b) { return b.getAttribute('data-held-resume') === id; });
    if (target) target.click(); else { var hb2 = $('btnHeldInvoices'); if (hb2) hb2.click(); }   // never a dead button: fall back to the held panel
  });
  // keep keyboard focus inside the window: the POS behind it is inert while it is open
  function setInert(v) { var root = document.querySelector('.pos-root'); if (root && !root.contains(modal)) root.inert = v; }
  function openModal() {
    if (!custState().attached) return;
    var d = $('custExtraDetails'); if (d) d.open = true;
    modal.hidden = false; setInert(true);
    var cl = $('novaCustModalClose'); if (cl) cl.focus();
  }
  function closeModal(refocus) {
    if (modal.hidden) return; modal.hidden = true; setInert(false);
    if (refocus !== false && card.offsetParent) card.focus();
  }
  card.addEventListener('click', openModal);
  cardRefill.addEventListener('click', function (e) { e.stopPropagation(); var b = $('btnRefillLast'); if (b) b.click(); });
  cardX.addEventListener('click', function () { var b = $('btnRemoveCust'); if (b) b.click(); });
  $('novaCustModalClose').addEventListener('click', function () { closeModal(); });
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); }
    else if (/^F\d+$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }   // no POS shortcuts behind the history window
  }, true);
  function markKey(el, key) { var k = addTo(el, key, 'nx-k'); k.setAttribute('aria-hidden', 'true'); el.setAttribute('aria-keyshortcuts', key); }
  function enter() {
    if (on) return; on = true;
    var add = $('btnAddLoyalty');
    if (add) {
      park(add); custTop.insertBefore(add, custTop.firstChild); markKey(add, 'F3');
      // the translator re-applies aria-label from data-nova-original-aria-label: drop both while in the rail, restore on leave
      origAddAria = add.dataset.novaOriginalAriaLabel || add.getAttribute('aria-label') || origAddAria;
      delete add.dataset.novaOriginalAriaLabel; add.removeAttribute('aria-label');
      addTo(add, SVG.userAdd + '<span></span>', 'nx-rail-label'); addTo(add, '', 'nx-rail-sub');
    }
    TILE_IDS.forEach(function (id) { var el = $(id); if (!el) return; park(el); tiles.appendChild(el); if (KEYS[id]) markKey(el, KEYS[id]); });
    var clr = $('btnClearInvoice'); if (clr) { var ic = document.createElement('span'); ic.className = 'nx-rail-add'; ic.innerHTML = SVG.trash; ic.style.display = 'contents'; clr.insertBefore(ic, clr.firstChild); }
    var hb = $('btnHeldInvoices'); if (hb) { park(hb); heldHead.appendChild(hb); }
    var sl = $('btnSaleLabels'); if (sl) { park(sl); foot.appendChild(sl); }
    var sel = $('customerSelectedBox'); if (sel) { park(sel); modalBody.appendChild(sel); }
    document.body.classList.add('nova-rail');
    renderHeld(); syncCustomer();
  }
  function leave() {
    if (!on) return; on = false;
    closeModal(false);
    document.querySelectorAll('.nx-rail-add').forEach(function (n) { n.remove(); });
    var add = $('btnAddLoyalty'); if (add) { setAria(add, origAddAria); if (isEn()) add.setAttribute('aria-label', 'Add or change customer'); }
    ['btnAddLoyalty', 'btnNewSale', 'btnClearInvoice'].forEach(function (id) { var b = $(id); if (b) b.removeAttribute('aria-keyshortcuts'); });
    ['customerSelectedBox', 'btnSaleLabels', 'btnHeldInvoices'].concat(TILE_IDS.slice().reverse(), ['btnAddLoyalty']).forEach(function (id) { unpark($(id)); });
    document.body.classList.remove('nova-rail');
    heldBox.innerHTML = ''; custTop.classList.remove('is-on');
  }
  function apply() { if (mq.matches) enter(); else leave(); }
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  // keep in step with the app: held list re-render, customer attach/detach/refill info, language switch
  function watch() {
    var hl = $('heldInvoiceList'); if (hl) new MutationObserver(renderHeld).observe(hl, { childList: true });
    var sb = $('customerSelectedBox'); if (sb) new MutationObserver(syncCustomer).observe(sb, { attributes: true, attributeFilter: ['style', 'hidden'], childList: true, characterData: true, subtree: true });
    // body class flips for many reasons: rebuild the held rows (and lose a focused «رجّعها») only when the language changed
    new MutationObserver(function () { if (!on) return; var en = isEn(); if (en !== lastEn) { lastEn = en; renderHeld(); } syncCustomer(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { watch(); renderHeld(); syncCustomer(); }); else watch();
  window.addEventListener('load', function () { renderHeld(); syncCustomer(); });
  window.addEventListener('storage', function (e) { if (e.key === HELD_KEY || e.key === null) renderHeld(); if (e.key === null || /credit/.test(e.key || '')) syncCustomer(); });
  window.novaSaleRail = { isOn: function () { return on; }, open: openModal, close: closeModal, refresh: syncCustomer };
})();
