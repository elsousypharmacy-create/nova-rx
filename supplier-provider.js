/* Default supplier provider for the app: talks to the NOVA Worker (same origin).
   Only defined when no other provider exists (tests inject their own).
   The PIN is asked once and kept in this browser only. No supplier passwords here:
   supplier logins are done by a separate secure job and never reach the app. */
(function () {
  'use strict';
  if (window.NOVA_SUPPLIER_PROVIDER) return;

  var KEY = 'novaApiPin';

  function getPin(forceAsk) {
    var pin = null;
    try { pin = localStorage.getItem(KEY); } catch (e) { pin = null; }
    if (!pin || forceAsk) {
      pin = window.prompt('رقم PIN الموردين');
      if (pin) { try { localStorage.setItem(KEY, pin); } catch (e) { /* ignore */ } }
    }
    return pin;
  }

  function call(path, options, retried) {
    var pin = getPin(false);
    if (!pin) return Promise.reject(new Error('pin-required'));
    var init = Object.assign({ headers: {} }, options || {});
    init.headers = Object.assign({ 'X-Nova-Pin': pin, 'Content-Type': 'application/json' }, init.headers);
    return fetch(path, init).then(function (res) {
      if (res.status === 401 && !retried) {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        return call(path, options, true);
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('http-' + res.status));
        return data;
      });
    });
  }

  function mapState(s) {
    if (s === 'ok') return 'ok';
    if (s === 'expired') return 'error';
    return 'off';
  }

  window.NOVA_SUPPLIER_PROVIDER = {
    previewAumetCart: function (line) { return call('/api/purchases/aumet-cart/preview', {method:'POST',body:JSON.stringify(line)}); },
    applyAumetCart: function (plan) { return call('/api/purchases/aumet-cart/apply', {method:'POST',body:JSON.stringify(plan)}); },
    listSellers: function () { return call('/api/suppliers/sellers', { method: 'GET' }); },
    purchasingStock: function (dashboardPin) { return call('/api/purchases/stock', { method: 'POST', body: JSON.stringify({ dashboardPin: dashboardPin || '' }) }); },
    search: function (query, opts) {
      return call('/api/suppliers/search', {
        method: 'POST',
        body: JSON.stringify({ query: query, requestedQty: (opts && opts.requestedQty) || 1, supplierIds: opts && opts.supplierIds }),
      });
    },
    listSuppliers: function () {
      return call('/api/suppliers/status', { method: 'GET' }).then(function (r) {
        return (r.suppliers || []).map(function (s) {
          return {
            id: s.id,
            name: s.name,
            state: mapState(s.state),
            available: true,
            message: s.state === 'expired' ? 'الجلسة انتهت' : '',
          };
        });
      });
    },
    testSupplier: function (id) {
      return call('/api/suppliers/status', { method: 'GET' }).then(function (r) {
        var s = (r.suppliers || []).filter(function (x) { return x.id === id; })[0];
        return { ok: !!s && s.state === 'ok', message: s && s.state === 'ok' ? 'الاتصال سليم' : 'الجلسة منتهية أو غير مربوطة' };
      });
    },
    connectSupplier: function () {
      return Promise.resolve({ ok: false, message: 'إضافة مورد جديد بتتم بالتواصل معانا (محتاج ربط مخصوص)' });
    },
  };
})();

