/* NOVA Rx - S3-01 device-print-wire.js: routes the POS invoice print to a device gateway (window.novaDeviceGateway with send())
   through NovaDevices (device-gateway.js) when one is configured AND a printer is chosen in Settings; otherwise the caller keeps the
   browser print. The same click retried never prints twice (jobId 'inv:<saleId>:<copyNo>'); a reprint has a new copyNo on purpose.
   A failure only returns an Arabic message: the sale is never touched. No network of its own, no paid cloud print.
   NOTE: no physical printer has been tested yet (S3-02..S3-04 need the owner in the pharmacy).
   Works as <script> (window.NovaDevicePrint / window.novaDevicePrint) and in Node (module.exports). */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'nova.devices.invoicePrinter';

  var ERRORS_AR = {
    'not-permitted': 'ليس لديك صلاحية الطباعة على هذه الطابعة.',
    'unsupported-device': 'الطابعة المختارة لا تدعم الفواتير.',
    'in-progress': 'جاري الطباعة… انتظر لحظة.',
    'device-failed': 'تعذّر الوصول للطابعة. الفاتورة محفوظة — أعد المحاولة أو اطبع من المتصفح.'
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function defaultStorage(rootObj) {
    try {
      if (rootObj && rootObj.localStorage) return rootObj.localStorage;
    } catch (_) {}
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }
    };
  }

  function isInvoicePrinter(dev) {
    if (!dev || dev.kind !== 'printer' || !Array.isArray(dev.outputs)) return false;
    return dev.outputs.indexOf('invoice') !== -1;
  }

  function create(opts) {
    opts = opts || {};
    var devices = opts.devices || (root && root.NovaDevices) || null;
    var storage = opts.storage || defaultStorage(root);
    var getGateway = typeof opts.getGateway === 'function'
      ? opts.getGateway
      : function () { return (root && root.novaDeviceGateway) || null; };

    var hasCustomGetUser = typeof opts.getUser === 'function';
    var getUser = hasCustomGetUser
      ? opts.getUser
      : function () {
          if (root && root.novaAuth) {
            try {
              if (typeof root.novaAuth.currentUser === 'function') return root.novaAuth.currentUser();
              if (typeof root.novaAuth.getUser === 'function') return root.novaAuth.getUser();
              if (typeof root.novaAuth.user === 'function') return root.novaAuth.user(); // the app exposes novaAuth.user()
              if (root.novaAuth.user) return root.novaAuth.user;
            } catch (_) {}
            return null;
          }
          return null;
        };

    var dispatcher = null;
    var boundGw = null;

    function getDispatcher() {
      var gw = getGateway();
      if (!gw || typeof gw.send !== 'function' || !devices || typeof devices.createDispatcher !== 'function') {
        return null;
      }
      if (!dispatcher || boundGw !== gw) {
        boundGw = gw;
        dispatcher = devices.createDispatcher({
          send: function (req) {
            return gw.send(req);
          }
        });
      }
      return dispatcher;
    }

    function selectedPrinter() {
      try {
        var v = storage.getItem(STORAGE_KEY);
        return v ? String(v) : '';
      } catch (_) {
        return '';
      }
    }

    function setPrinter(id) {
      if (!id) {
        try { storage.setItem(STORAGE_KEY, ''); } catch (_) {}
        return true;
      }
      if (!devices || typeof devices.find !== 'function') return false;
      var dev = devices.find(id);
      if (!isInvoicePrinter(dev)) return false;
      try { storage.setItem(STORAGE_KEY, String(id)); } catch (_) {}
      return true;
    }

    function hasGateway() {
      var gw = getGateway();
      var p = selectedPrinter();
      return Boolean(gw && typeof gw.send === 'function' && p);
    }

    function resolveUser() {
      var u = getUser();
      if (u) return u;
      var authPresent = Boolean(hasCustomGetUser || (root && root.novaAuth));
      if (authPresent) return null;
      return { role: 'owner' };
    }

    function buildPayload(sale) {
      var s = sale || {};
      var rawLines = Array.isArray(s.lines) ? s.lines : (Array.isArray(s.items) ? s.items : []);
      var lines = [];
      for (var i = 0; i < rawLines.length; i++) {
        var ln = rawLines[i] || {};
        lines.push({
          name: ln.name != null ? ln.name : '',
          qty: ln.qty != null ? ln.qty : (ln.quantity != null ? ln.quantity : 1),
          price: ln.price != null ? ln.price : (ln.unitPrice != null ? ln.unitPrice : 0)
        });
      }
      return {
        saleId: s.id != null ? s.id : s.number,
        number: s.number,
        total: s.total,
        lines: lines
      };
    }

    function printInvoice(sale, copyNo) {
      if (!hasGateway()) {
        return Promise.resolve({ ok: true, via: 'browser' });
      }
      var disp = getDispatcher();
      if (!disp) {
        return Promise.resolve({ ok: true, via: 'browser' });
      }
      var s = sale || {};
      var saleKey = s.id != null ? s.id : s.number;
      var jobId = 'inv:' + saleKey + ':' + (copyNo || 0);
      var payload = buildPayload(s);
      var user = resolveUser();
      var printer = selectedPrinter();

      return disp.print(user, 'invoice', printer, jobId, payload).then(function (res) {
        if (res && res.ok) {
          var out = { ok: true, via: 'device' };
          if (res.duplicate) out.duplicate = true;
          return out;
        }
        var errCode = (res && res.error) ? res.error : 'device-failed';
        var msg = ERRORS_AR[errCode] || ERRORS_AR['device-failed'];
        return {
          ok: false,
          via: 'device',
          error: errCode,
          message_ar: msg
        };
      });
    }

    /* UI text per language: the app's i18n checks forbid Latin words inside Arabic UI and Arabic inside English UI. */
    var NAMES = {
      ar: { 'scanner-hid': 'ماسح باركود يعمل كلوحة مفاتيح', 'printer-thermal-80': 'طابعة حرارية عرض ٨٠ مم (فواتير)', 'printer-thermal-58': 'طابعة حرارية عرض ٥٨ مم (فواتير)', 'printer-label': 'طابعة ملصقات حرارية', 'printer-a4': 'طابعة ورق عادي' },
      en: { 'scanner-hid': 'Barcode scanner (keyboard mode)', 'printer-thermal-80': 'Thermal printer 80 mm (invoices)', 'printer-thermal-58': 'Thermal printer 58 mm (invoices)', 'printer-label': 'Thermal label printer', 'printer-a4': 'Plain paper printer' }
    };
    var TEXT = {
      ar: { title: 'الطابعات والماسح', printer: 'طابعة الفواتير:', browser: 'طباعة المتصفح (افتراضي)', note: 'الماسح يعمل كلوحة مفاتيح: اضغط في خانة البحث ثم امسح. لم تُجرَّب طابعة حقيقية بعد.', dir: 'rtl' },
      en: { title: 'Printers and scanner', printer: 'Invoice printer:', browser: 'Browser print (default)', note: 'The scanner types like a keyboard: tap the search box, then scan. No real printer has been tested yet.', dir: 'ltr' }
    };

    function devicesHtml(lang) {
      var L = lang === 'en' ? 'en' : 'ar', T = TEXT[L];
      var list = (devices && typeof devices.list === 'function') ? devices.list() : [];
      var cur = selectedPrinter();
      var itemsHtml = '';
      var optionsHtml = '<option value=""' + (cur === '' ? ' selected' : '') + '>' + T.browser + '</option>';

      for (var i = 0; i < list.length; i++) {
        var d = list[i], nm = NAMES[L][d.id] || d.id;
        itemsHtml += '<li data-device="' + escapeHtml(d.id) + '">' + escapeHtml(nm) + '</li>';
        if (isInvoicePrinter(d)) {
          var sel = (cur === d.id) ? ' selected' : '';
          optionsHtml += '<option value="' + escapeHtml(d.id) + '"' + sel + '>' + escapeHtml(nm) + '</option>';
        }
      }

      return (
        '<div dir="' + T.dir + '" class="nova-devices-settings">' +
          '<h3>' + T.title + '</h3>' +
          '<ul>' + itemsHtml + '</ul>' +
          '<label for="novaInvoicePrinter">' + T.printer + '</label>' +
          '<select id="novaInvoicePrinter">' + optionsHtml + '</select>' +
          '<p>' + T.note + '</p>' +
        '</div>'
      );
    }

    return {
      selectedPrinter: selectedPrinter,
      setPrinter: setPrinter,
      hasGateway: hasGateway,
      printInvoice: printInvoice,
      devicesHtml: devicesHtml
    };
  }

  var api = {
    create: create,
    ERRORS_AR: ERRORS_AR
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NovaDevicePrint = api;
    if (root.NovaDevices) {
      root.novaDevicePrint = create({ devices: root.NovaDevices });
    }
  }
})(typeof window !== 'undefined' ? window : null);
