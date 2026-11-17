/* NOVA Rx - S2-03: goods receipt (GRN) sync. After a confirmed receive on the purchases page, one op is queued to the shared
   outbox: { id: receiptId, op:'receipt', poId, ref, lines:[{code, qty (BASE units), price (cost per base unit), lot, expiry, unit, perBox}] }
   (kind 'ledger', entity 'stock_receipt'). Receipts pulled from other devices are appended to the local stock ledger once;
   this device's own receipts (already in its ledger, in boxes) are skipped via 'nova.receipts.local'. No network here.
   Works as <script> (window.NovaReceiptSync / window.novaReceiptSync) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.NovaReceiptSync = factory(root);
    try {
      if (root.NovaOutbox && typeof localStorage !== 'undefined' && localStorage) {
        var ob = typeof root.NovaOutbox.createOutbox === 'function'
          ? root.NovaOutbox.createOutbox(localStorage, 'nova.outbox')
          : null;
        if (ob) {
          root.novaReceiptSync = root.NovaReceiptSync.create({
            outbox: ob,
            storage: localStorage
          });
        }
      }
    } catch (_) {}
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var LOCAL_KEY = 'nova.receipts.local';
  var PKG_KEY = 'nova-rx-packaging-v1';

  function fnv1a32hex(str) {
    var s = String(str == null ? '' : str);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 0x01000193) : ((h * 0x01000193) | 0);
    }
    var hex = (h >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  function sanitizeIdPart(s) {
    return String(s == null ? '' : s).replace(/[^A-Za-z0-9_\-:.]/g, '_');
  }

  /* Random id of THIS device, kept in storage: two devices that number a PO / GRN identically in the same millisecond must not
     produce the same receipt key (the server would drop the second as a duplicate = silent stock loss). Found by the day simulation. */
  function deviceId(storage) {
    try {
      var v = storage && storage.getItem('nova.device.id');
      if (v) return String(v);
      var chars = '0123456789abcdefghijklmnopqrstuvwxyz', s = '';
      for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * 36));
      if (storage) storage.setItem('nova.device.id', s);
      return s;
    } catch (_) { return ''; }
  }

  function receiptId(po, grn, devId) {
    var poId = po && po.id ? String(po.id) : '';
    var createdAt = po && po.createdAt ? String(po.createdAt) : '';
    var ref = grn && grn.ref ? String(grn.ref) : '';
    var hash = fnv1a32hex(poId + '|' + createdAt + '|' + ref + '|' + (devId || ''));
    return 'rcv:' + sanitizeIdPart(poId) + ':' + hash;
  }

  function readJson(storage, key, fallback) {
    if (!storage || typeof storage.getItem !== 'function') return fallback;
    try {
      var raw = storage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(storage, key, val) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function resolvePackaging(storage, code) {
    var map = readJson(storage, PKG_KEY, {});
    var pkg = (map && typeof map === 'object' && map[code]) || {};
    var unitsPerBox = Number(pkg.unitsPerBox) > 0 ? Number(pkg.unitsPerBox) : 0;
    var stripsPerBox = Number(pkg.stripsPerBox) > 0 ? Number(pkg.stripsPerBox) : 0;
    var unitsPerStrip = Number(pkg.unitsPerStrip) > 0 ? Number(pkg.unitsPerStrip) : 0;

    var basePerBox = unitsPerBox || (unitsPerStrip && stripsPerBox ? unitsPerStrip * stripsPerBox : 0) || stripsPerBox || 1;
    var baseUnit = (unitsPerBox || (unitsPerStrip && stripsPerBox))
      ? 'tablet'
      : (stripsPerBox ? 'strip' : 'box');

    return { basePerBox: basePerBox, baseUnit: baseUnit };
  }

  function getLocalSet(storage) {
    var arr = readJson(storage, LOCAL_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function rememberLocalId(storage, id) {
    var list = getLocalSet(storage);
    if (list.indexOf(id) === -1) {
      list.push(id);
      writeJson(storage, LOCAL_KEY, list);
    }
  }

  function resolveLedger(deps, storage) {
    if (deps && deps.ledger) return deps.ledger;
    var g = typeof window !== 'undefined' ? window : root;
    var st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (g && g.NovaStockLedger && typeof g.NovaStockLedger.createLedger === 'function' && st) {
      return g.NovaStockLedger.createLedger(st, 'nova.stock.ledger');
    }
    return null;
  }

  function create(deps) {
    deps = deps || {};
    var outbox = deps.outbox;
    var storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);

    function afterReceive(po, grn) {
      try {
        if (!outbox || typeof outbox.enqueue !== 'function') {
          return { ok: false, queued: 0, error: 'no-outbox' };
        }
        if (!po || !grn || !Array.isArray(grn.lines) || !grn.lines.length) {
          return { ok: false, queued: 0, error: 'invalid-grn' };
        }
        var id = receiptId(po, grn, deviceId(storage));
        var lines = [];
        for (var i = 0; i < grn.lines.length; i++) {
          var ln = grn.lines[i] || {};
          var code = String(ln.code || '');
          var pkg = resolvePackaging(storage, code);
          var perBox = pkg.basePerBox;
          var qty = Number(ln.qty) * perBox;
          var price = Math.round((Number(ln.cost) / perBox) * 100) / 100;
          lines.push({
            code: code,
            qty: qty,
            price: price,
            lot: String(ln.lot || ''),
            expiry: String(ln.expiry || ''),
            unit: pkg.baseUnit,
            perBox: perBox
          });
        }
        var payload = {
          id: id,
          op: 'receipt',
          poId: String(po.id || ''),
          ref: String(grn.ref || ''),
          lines: lines
        };
        outbox.enqueue(payload);
        rememberLocalId(storage, id);
        return { ok: true, queued: 1 };
      } catch (err) {
        return { ok: false, queued: 0, error: err && err.message ? err.message : String(err) };
      }
    }

    function flush() {
      return { queued: 0 };
    }

    function applyChanges(changes) {
      var applied = 0;
      var skipped = 0;
      if (!Array.isArray(changes)) return { applied: 0, skipped: 0 };
      var localIds = getLocalSet(storage);
      var ledger = resolveLedger(deps, storage);

      for (var i = 0; i < changes.length; i++) {
        var ch = changes[i];
        if (!ch || ch.entity !== 'stock_receipt' || !ch.data || !ch.data.receiptId) {
          continue;
        }
        var rId = String(ch.data.receiptId);
        if (localIds.indexOf(rId) !== -1) {
          skipped++;
          continue;
        }
        if (!ledger || typeof ledger.append !== 'function') {
          skipped++;
          continue;
        }
        var items = Array.isArray(ch.data.items) ? ch.data.items : [];
        var anyApplied = false;
        for (var j = 0; j < items.length; j++) {
          var item = items[j] || {};
          try {
            ledger.append({
              kind: 'receive',
              code: String(item.productId || item.code || ''),
              qty: Number(item.qty),
              ref: rId,
              lot: item.lot ? String(item.lot) : '',
              expiry: item.expiry ? String(item.expiry) : '',
              cost: Number(item.unitCostMinor || 0) / 100
            });
            anyApplied = true;
          } catch (e) {
            if (e && e.code === 'duplicate-movement') {
              /* already applied */
            } else {
              throw e;
            }
          }
        }
        if (anyApplied) applied++;
        else skipped++;
      }
      return { applied: applied, skipped: skipped };
    }

    return {
      afterReceive: afterReceive,
      flush: flush,
      applyChanges: applyChanges
    };
  }

  return {
    create: create,
    receiptId: receiptId
  };
});
