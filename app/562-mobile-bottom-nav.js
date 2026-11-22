/* Q21-2a ROLE NAV: the top nav shows each person only what their role uses. Staff (cashier, pharmacist): البيع، الفواتير، العملاء،
   النواقص، الوردية. Owner/manager: البيع، الفواتير، العملاء، الوردية، المخزون، التقارير، الأدوات + ⚙ (النواقص and استلام are in المخزون
   and الأدوات). An entry with data-nav-need="a b" shows when the signed-in role may do any of those actions (auth-permissions.js); with
   accounts on the device it stays hidden until the permissions are known (fail closed). No accounts = single user = owner. This is a view
   filter, not a security boundary: every screen keeps its own checks. */
(function () {
  'use strict';
  if (window.novaNavRoles) return;
  function accounts() {
    var A = window.novaAuth;
    if (A && typeof A.hasAccounts === 'function') { try { return !!A.hasAccounts(); } catch (e) { return true; } }
    try { var v = localStorage.getItem('nova.auth.accounts'); if (v == null) return false; var a = JSON.parse(v); return !Array.isArray(a) || a.length > 0; } catch (e) { return true; }
  }
  function can(action) {
    if (!accounts()) return true;
    var P = window.novaPerms;
    if (P && typeof P.can === 'function') { try { return !!P.can(action); } catch (e) { return false; } }
    return false;
  }
  function allowed(el) {
    var need = el.getAttribute('data-nav-need');
    if (need) return need.split(' ').some(can);
    if (el.hasAttribute('data-nav-staff')) return !can('accounts.manage');
    return true;
  }
  var sig = '';
  function apply() {
    var items = document.querySelectorAll('.nova-nav [data-nav-need], .nova-nav [data-nav-staff]');
    var admin = can('accounts.manage');
    var s = [].map.call(items, function (el) { return allowed(el) ? 1 : 0; }).join('') + (admin ? 'A' : 'S');
    if (s === sig) return; sig = s;
    [].forEach.call(items, function (el, i) { el.hidden = s.charAt(i) !== '1'; });
    document.documentElement.classList.toggle('nova-role-admin', admin);
    document.documentElement.classList.add('nova-nav-ready');
    try { window.dispatchEvent(new Event('nova-nav-roles')); } catch (e) {}
  }
  window.novaNavRoles = { apply: apply, allowed: allowed, can: can };
  apply();
  // sign-in / sign-out and the late permissions module change the answer: cheap re-check
  setInterval(apply, 1500);
  window.addEventListener('storage', apply);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
})();
/* NAV-01 (owner decision 2026-11-20): phone bottom navigation. On screens <= 780px a fixed bottom bar with 5 targets
   (البيع، الفواتير، العملاء، المخزون، المزيد) replaces the horizontally scrolling top tabs. «المزيد» opens a sheet with the rest
   (النواقص، استلام الطلبيات، التقارير، الإعدادات). Every button just clicks the existing .nova-tab of that page, so routing,
   permissions and page rendering stay exactly as they are. Desktop is unchanged. */
(function () {
  'use strict';
  if (window.__novaBottomNav) return; window.__novaBottomNav = true;
  var ICON = {
    sale: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6 M10 20.5h.01 M17 20.5h.01',
    invoices: 'M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z M10 8h4 M10 12h4',
    customers: 'M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 20v-1.5a4 4 0 0 0-3-3.8 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
    products: 'M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
    shift: 'M4 7h16v12H4z M4 11h16 M9 15h6 M8 7V5h8v2',
    purchases: 'M4 6h16 M4 12h10 M4 18h7 M18 14v6 M15 17h6'
  };
  // Q21-2b: owner/manager — البيع، الفواتير، الوردية، المخزون + «المزيد»; staff — البيع، الفواتير، العملاء، النواقص، الوردية (no «المزيد»)
  var ADMIN_MAIN = [['sale', 'البيع'], ['invoices', 'الفواتير'], ['shift', 'الوردية'], ['products', 'المخزون']];
  var STAFF_MAIN = [['sale', 'البيع'], ['invoices', 'الفواتير'], ['customers', 'العملاء'], ['purchases', 'النواقص', '/purchases'], ['shift', 'الوردية']];
  var MORE = [
    ['customers', 'العملاء'],
    ['reports', 'التقارير'],
    ['tools', 'الأدوات'],
    ['purchases', 'النواقص', '/purchases'],
    ['receiving', 'استلام الطلبيات'],
    ['settings', 'الإعدادات']
  ];
  var MORE_PAGES = { customers: 1, receiving: 1, reports: 1, settings: 1, tools: 1 };
  function isAdmin() { return document.documentElement.classList.contains('nova-role-admin'); }
  var css = ''
    + '#novaBottomNav{display:none}'
    + '@media (max-width:780px){'
    + 'body.nova-bbar .nova-nav,body.nova-bbar .nova-nav-chev{display:none!important}'
    + 'body.nova-bbar{--nova-bbar-h:calc(58px + env(safe-area-inset-bottom,0px))}'
    + '#novaBottomNav{display:flex;position:relative;flex:0 0 var(--nova-bbar-h);order:9999;width:100%;z-index:900;height:var(--nova-bbar-h);padding-bottom:env(safe-area-inset-bottom,0px);'
    + 'background:#111418;border-top:1px solid #2a3139;box-sizing:border-box;direction:rtl}'
    + '#novaBottomNav button{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;'
    + 'background:none;border:0;color:#9eacb9;font:inherit;font-size:12px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '#novaBottomNav button[aria-current="page"]{color:#79c9eb;font-weight:700}'
    + '#novaBottomNav button:focus-visible{outline:2px solid #79c9eb;outline-offset:-4px;border-radius:10px}'
    + '#novaBottomNav svg{width:22px;height:22px}'
    + 'body.nova-bbar .pos-root,body.nova-bbar #novaPageView{min-height:0!important}'
    + 'body.nova-bbar .toast-container,body.nova-bbar #toastContainer{top:calc(8px + env(safe-area-inset-top,0px))!important;bottom:auto!important}'
    + '}'
    + '#novaMoreSheet{position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;direction:rtl}'
    + '#novaMoreSheet .nms-panel{width:100%;background:#14181d;border-top:1px solid #343b44;border-radius:16px 16px 0 0;'
    + 'padding:10px 12px calc(12px + var(--nova-bbar-h,58px));box-sizing:border-box}'
    + '#novaMoreSheet h2{margin:4px 6px 8px;font-size:15px;color:#e8eef3}'
    + '#novaMoreSheet a,#novaMoreSheet button.nms-item{display:flex;align-items:center;width:100%;min-height:48px;padding:0 14px;box-sizing:border-box;'
    + 'background:#1b2027;border:1px solid #2a3139;border-radius:10px;margin:6px 0;color:#e8eef3;font:inherit;font-size:15px;text-decoration:none;cursor:pointer;text-align:start}'
    + '#novaMoreSheet [aria-current="page"]{border-color:#79c9eb;color:#79c9eb}';

  function svg(d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function activePage() {
    var t = document.querySelector('.nova-tab.active[data-page]');
    return (t && t.getAttribute('data-page')) || (document.body && document.body.dataset.activePage) || 'sale';
  }
  function go(page) {
    var tab = document.querySelector('.nova-tab[data-page="' + page + '"]');
    if (window.novaSwitchPage) window.novaSwitchPage(page); else if (tab) tab.click(); else location.hash = '#' + page;
    setTimeout(sync, 0);
  }
  var bar = null;
  // the WhatsApp inbox (#wa) and the standalone WhatsApp app have their own layout: no bar there
  function waMode() {
    if (document.documentElement.classList.contains('app-whatsapp') || /^#wa(\b|&|$)/.test(location.hash || '')) return true;
    var inbox = document.getElementById('novaInboxView');
    return !!(inbox && !inbox.hidden);
  }
  function sync() {
    if (!bar) return;
    var off = waMode();
    document.body.classList.toggle('nova-bbar', !off);
    bar.style.display = off ? 'none' : '';
    var p = activePage();
    [].forEach.call(bar.querySelectorAll('button[data-bnav]'), function (b) {
      var k = b.getAttribute('data-bnav');
      var on = k === p || (k === 'more' && MORE_PAGES[p] && !bar.querySelector('[data-bnav="' + p + '"]'));
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function closeSheet(sheet, back) {
    if (!sheet || !sheet.parentNode) return;
    sheet.parentNode.removeChild(sheet);
    document.removeEventListener('keydown', sheet.__key, true);
    if (back && back.focus) back.focus();
  }
  function openMore(btn) {
    var old = document.getElementById('novaMoreSheet'); if (old) { closeSheet(old, btn); return; }
    var p = activePage();
    var sheet = document.createElement('div');
    sheet.id = 'novaMoreSheet';
    sheet.innerHTML = '<div class="nms-panel" role="dialog" aria-modal="true" aria-labelledby="novaMoreT"><h2 id="novaMoreT">المزيد</h2>'
      + MORE.map(function (m) {
        var cur = m[0] === p ? ' aria-current="page"' : '';
        return m[2] ? '<a href="' + m[2] + '" class="nms-item"' + cur + '>' + m[1] + '</a>'
          : '<button type="button" class="nms-item" data-more="' + m[0] + '"' + cur + '>' + m[1] + '</button>';
      }).join('') + '</div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) { closeSheet(sheet, btn); return; }
      var b = e.target.closest && e.target.closest('[data-more]');
      if (b) { closeSheet(sheet, null); go(b.getAttribute('data-more')); }
    });
    sheet.__key = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(sheet, btn); return; }
      if (e.key !== 'Tab') return;
      var f = [].slice.call(sheet.querySelectorAll('a,button'));
      if (!f.length) return;
      var out = !sheet.contains(document.activeElement);
      if (e.shiftKey && (out || document.activeElement === f[0])) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (out || document.activeElement === f[f.length - 1])) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', sheet.__key, true);
    var first = sheet.querySelector('a,button'); if (first) first.focus();
  }
  function mount() {
    if (document.getElementById('novaBottomNav')) return;
    if (!document.querySelector('.nova-nav .nova-tab[data-page]')) return;   // not the POS shell (e.g. WhatsApp app mode)
    var st = document.createElement('style'); st.id = 'novaBottomNavCss'; st.textContent = css; document.head.appendChild(st);
    bar = document.createElement('nav');
    bar.id = 'novaBottomNav';
    bar.setAttribute('aria-label', 'التنقل الرئيسي (موبايل)');
    var built = '';
    var build = function () {
      var admin = isAdmin(), key = admin ? 'a' : 's';
      if (built === key) return; built = key;
      bar.innerHTML = (admin ? ADMIN_MAIN : STAFF_MAIN).map(function (m) {
        return '<button type="button" data-bnav="' + m[0] + '"' + (m[2] ? ' data-href="' + m[2] + '"' : '') + '>' + svg(ICON[m[0]]) + '<span>' + m[1] + '</span></button>';
      }).join('') + (admin ? '<button type="button" data-bnav="more" aria-haspopup="dialog">' + svg('M5 12h.01 M12 12h.01 M19 12h.01') + '<span>المزيد</span></button>' : '');
      sync();
    };
    document.body.appendChild(bar);
    build();
    window.addEventListener('nova-nav-roles', build);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-bnav]'); if (!b) return;
      var k = b.getAttribute('data-bnav');
      if (k === 'more') openMore(b); else if (b.getAttribute('data-href')) location.href = b.getAttribute('data-href'); else go(k);
    });
    var nav = document.querySelector('.nova-nav');
    if (nav && window.MutationObserver) new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
    window.addEventListener('hashchange', function () { setTimeout(sync, 0); });
    // the inbox opens through history.replaceState (no hashchange): follow its hidden flag
    if (window.MutationObserver) new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    sync();
    if (window.matchMedia) { var mq = window.matchMedia('(max-width:780px)'); var onMq = function () { if (!mq.matches) closeSheet(document.getElementById('novaMoreSheet'), null); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
