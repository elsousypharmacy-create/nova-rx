/* NOVA Rx — INT-04 local printers/scanners support (pure logic, mocked gateway, no network, no paid cloud print).
   Supported-device list, permission check, gateway contract, and idempotent device output so a device failure never doubles a sale.
   Works as <script> (window.NovaDevices) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var SUPPORTED = [
    { id: 'scanner-hid', kind: 'barcode', name: 'ماسح باركود USB/HID (محاكاة لوحة مفاتيح)', formats: ['EAN-13', 'EAN-8', 'CODE-128', 'QR'] },
    { id: 'printer-thermal-80', kind: 'printer', name: 'طابعة حرارية 80mm (فواتير)', outputs: ['invoice'] },
    { id: 'printer-thermal-58', kind: 'printer', name: 'طابعة حرارية 58mm (فواتير)', outputs: ['invoice'] },
    { id: 'printer-label', kind: 'printer', name: 'طابعة ملصقات حرارية (ستيكر)', outputs: ['sticker'] },
    { id: 'printer-a4', kind: 'printer', name: 'طابعة A4 عادية', outputs: ['invoice', 'sticker'] }
  ];
  var PERMS = { barcode: 'devices.scan', invoice: 'devices.print.invoice', sticker: 'devices.print.sticker' };

  function list() { return SUPPORTED.map(function (d) { return Object.assign({}, d); }); }
  function find(id) { return SUPPORTED.filter(function (d) { return d.id === id; })[0] || null; }

  /* EAN-13 / EAN-8 check digit validation; other formats only need non-empty. */
  function validBarcode(code) {
    code = String(code == null ? '' : code).trim();
    if (!code) return false;
    if (!/^\d+$/.test(code)) return true;
    if (code.length !== 13 && code.length !== 8) return false;
    var sum = 0, n = code.length - 1;
    for (var i = 0; i < n; i++) sum += Number(code[i]) * ((n - i) % 2 === 1 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(code[n]);
  }

  function can(user, action) {
    var p = PERMS[action];
    return !!(user && p && (user.role === 'owner' || (user.permissions || []).indexOf(p) >= 0));
  }

  /* Gateway contract: gateway.send({deviceId, type, jobId, payload}) -> Promise<{ok:boolean, error?}>. Mockable. */
  function createDispatcher(gateway, opts) {
    var jobs = {}; // jobId -> {status, attempts}
    return {
      jobs: jobs,
      /* Printing is a side effect of a saved sale; it never creates or re-creates the sale. Same jobId is never printed twice once ok. */
      print: function (user, type, deviceId, jobId, payload) {
        if (!can(user, type)) return Promise.resolve({ ok: false, error: 'not-permitted' });
        var dev = find(deviceId);
        if (!dev || dev.kind !== 'printer' || dev.outputs.indexOf(type) < 0) return Promise.resolve({ ok: false, error: 'unsupported-device' });
        if (!jobId) return Promise.resolve({ ok: false, error: 'job-id-required' });
        var j = jobs[jobId];
        if (j && j.status === 'done') return Promise.resolve({ ok: true, duplicate: true });
        if (j && j.status === 'pending') return Promise.resolve({ ok: false, error: 'in-progress' });
        j = jobs[jobId] = { status: 'pending', attempts: ((j && j.attempts) || 0) + 1 };
        return Promise.resolve().then(function () {
          return gateway.send({ deviceId: deviceId, type: type, jobId: jobId, payload: payload });
        }).then(function (r) {
          j.status = r && r.ok ? 'done' : 'failed';
          return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'device-failed' };
        }, function () { j.status = 'failed'; return { ok: false, error: 'device-failed' }; });
      }
    };
  }

  var api = { SUPPORTED: SUPPORTED, PERMS: PERMS, list: list, find: find, validBarcode: validBarcode, can: can, createDispatcher: createDispatcher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaDevices = api;
})(typeof window !== 'undefined' ? window : globalThis);
