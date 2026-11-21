/* AUDIT-03: data providers for screens built on the logic modules (written by Claude; screens are reviewed Gemini drafts).
   window.__novaSupplierProvider → app/550-supplier-accounts-ui.js (suppliers, current user, approver check, cash out).
   window.novaCashOut → cash leaving the drawer (supplier payments / expenses); the shift close subtracts it (app/130). */
(function () {
  'use strict';
  var SUP_KEY = 'nova-rx-suppliers-v1', CASH_KEY = 'nova-rx-cash-out-v1';
  var read = function (k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  var write = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
  var norm = function (s) { return String(s == null ? '' : s).trim(); };
  var err = function (code) { var e = new Error(code); e.code = code; return e; };
  var rid = function (p) { return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); };

  window.novaCashOut = {
    list: function () { return read(CASH_KEY); },
    add: function (amount, note, by) {
      var n = Math.round(Number(amount) * 100) / 100;
      if (!Number.isFinite(n) || !(n > 0)) throw err('bad-amount');
      var all = read(CASH_KEY);
      all.push({ id: rid('co'), at: Date.now(), amount: n, note: norm(note).slice(0, 200), by: norm(by) });
      write(CASH_KEY, all);   // never truncate: older periods' shift reports depend on it
      // the shift close on the reports page computed its expected drawer at render: re-render so it includes this cash-out
      setTimeout(function () { var tab = document.querySelector('.nova-tab.active[data-page="reports"]'); if (tab) tab.click(); }, 0);
      return n;
    }
  };

  var auth = function () { var a = window.novaAuth; return a && typeof a.hasAccounts === 'function' && a.hasAccounts() ? a : null; };

  window.__novaSupplierProvider = {
    suppliers: function () { return read(SUP_KEY).map(function (s) { return { id: s.id, name: s.name, phone: s.phone || '' }; }); },
    addSupplier: function (o) {
      var name = norm(o && o.name), phone = norm(o && o.phone);
      if (!name) throw err('missing-supplier');
      var all = read(SUP_KEY);
      if (all.some(function (s) { return norm(s.name).toLowerCase() === name.toLowerCase(); })) throw err('duplicate-supplier');
      var s = { id: rid('sup'), name: name.slice(0, 80), phone: phone.slice(0, 20) };
      all.push(s); write(SUP_KEY, all);
      return { id: s.id, name: s.name };
    },
    renameSupplier: function (id, name) {
      name = norm(name); if (!name) throw err('missing-supplier');
      var all = read(SUP_KEY), hit = false;
      all.forEach(function (s) { if (String(s.id) === String(id)) { s.name = name.slice(0, 80); hit = true; } });
      if (!hit) throw err('unknown-supplier');
      write(SUP_KEY, all);
    },
    /* the signed-in account; without accounts on this device there is nobody to approve, so expenses stay disabled */
    currentUser: function () { var A = auth(); var me = A && A.current(); return me ? { id: me.id, name: me.name, role: me.role } : null; },
    verifyApprover: function (name, password) {
      var A = auth();
      if (!A || typeof A.verifyAccount !== 'function') return Promise.resolve(null);
      return A.verifyAccount(name, password).then(function (v) { return v && (v.role === 'manager' || v.role === 'owner') ? v : null; });
    },
    cashOut: function (amount, note) { var me = this.currentUser(); window.novaCashOut.add(amount, note, me ? me.name : ''); }
  };

  /* RCV01 lazy screens: index.html lists the supplier accounts / supplier returns code as
     <link rel="prefetch" as="script" data-nova-lazy href=...> — the browser downloads it in the background (and the service
     worker keeps it for offline use) but nothing runs at startup, so the sale screen opens lighter. It runs, in order, when
     the reports / receiving / products / customers page opens, or once the app is idle a few seconds after loading. */
  var lazyPromise = null;
  function loadLazy() {
    if (lazyPromise) return lazyPromise;
    var links = [].slice.call(document.querySelectorAll('link[rel="prefetch"][as="script"][data-nova-lazy]'));
    lazyPromise = Promise.all(links.map(function (l) {
      return new Promise(function (ok) {
        var s = document.createElement('script');
        s.src = l.getAttribute('href');
        s.async = false;               // dynamic scripts with async=false run in insertion order
        s.onload = function () { ok(true); };
        s.onerror = function () { ok(false); };
        document.body.appendChild(s);
      });
    }));
    return lazyPromise;
  }
  var LAZY_PAGES = { reports: 1, receiving: 1, products: 1, customers: 1, settings: 1, inbox: 1, wa: 1 };
  var inboxOpenPending = false;
  if (!window.NovaOpenInbox) {
    window.NovaOpenInbox = function () {
      if (inboxOpenPending) return true;
      inboxOpenPending = true;
      loadLazy().then(function () {
        inboxOpenPending = false;
        if (window.NovaOpenInbox && !window.NovaOpenInbox._stub) window.NovaOpenInbox();
      }, function () { inboxOpenPending = false; });
      return true;
    };
    window.NovaOpenInbox._stub = true;
  }
  /* /#wa (a click on a new-message notification, UX406): run the lazy WhatsApp code right away so the conversations button
     answers at once. app/130 rewrites the hash to #sale while the page is still parsing, so read the launch URL from the
     navigation entry. (A plain /#wa still lands on the full app, as before: tests/ux/wa-app-mode.mjs, wa-edges.mjs.) */
  var bootWa = false;
  try { var navE = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]; bootWa = !!navE && /#wa(?:[&?]|$)/.test(String(navE.name || '')); } catch (e) {}
  function isWaApp() {
    var path = String(location.pathname || '').replace(/\/+$/, '') || '/';
    return path === '/whatsapp' || path === '/wa' || /(?:^|[?&])app=whatsapp(?:&|$)/.test(String(location.search || ''));
  }
  function lazyPageOpen() {
    var a = document.querySelector('.nova-tab.active[data-page]');
    var p = (document.body && document.body.dataset.activePage) || (a && a.getAttribute('data-page')) || '';
    var h = String(location.hash || '').replace(/^#/, '').split(/[&?]/)[0];
    return !!(LAZY_PAGES[p] || LAZY_PAGES[h] || bootWa || isWaApp());
  }
  function checkLazy() { if (!lazyPromise && lazyPageOpen()) loadLazy(); }
  window.novaLazy = { load: loadLazy };
  window.addEventListener('hashchange', checkLazy);
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('.nova-tab[data-page]'); if (t && LAZY_PAGES[t.getAttribute('data-page')]) loadLazy(); }, true);
  function boot() {
    checkLazy();
    if (document.body && window.MutationObserver) {
      var mo = new MutationObserver(function () { if (lazyPromise) { mo.disconnect(); return; } checkLazy(); });
      mo.observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
    }
    var idle = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1); })(function () { loadLazy(); }, { timeout: 4000 }); };
    if (document.readyState === 'complete') setTimeout(idle, 2500);
    else window.addEventListener('load', function () { setTimeout(idle, 2500); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
