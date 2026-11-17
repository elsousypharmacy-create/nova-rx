/* NOVA Rx - S2-04 purchase order sync wire. Local POs ('nova.purchase.orders', written by purchase-orders.js) that left the
   draft state are queued as snapshots { id: key + ':' + historyLen, op:'po', key: 'po:<fnv32>', po } (kind 'ledger', entity
   'purchase_order') whenever their state / history / GRN count changes. POs pulled from other devices are stored as read-only
   remote copies (remote:true, id '<PO-n>@<key part>', syncKey) and never pushed back. Never contacts a supplier.
   No network here: the POS scheduler calls flush()/applyChanges() only while novaBackend.enabled is 'true'.
   Works as <script> (window.NovaPoSync / window.novaPoSync) and in Node (module.exports). */
(function (root) {
  'use strict';

  var ORDERS_KEY = 'nova.purchase.orders';
  var SYNCED_KEY = 'nova.po.synced';

  function fnv1a32hex(str) {
    var s = String(str == null ? '' : str);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = (h >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex.slice(-8);
  }

  /* Random id of THIS device (same key as receipt-sync-wire.js): two devices with the same PO number and creation millisecond
     must not share a key. Found by the day simulation. */
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

  function poKey(po, devId) {
    if (po && typeof po.syncKey === 'string' && po.syncKey) return po.syncKey;
    var id = po && po.id != null ? String(po.id) : '';
    var at = po && po.createdAt != null ? String(po.createdAt) : '';
    return 'po:' + fnv1a32hex(id + '|' + at + '|' + (devId || ''));
  }

  function readJson(storage, key, fallback) {
    try {
      var raw = storage && storage.getItem ? storage.getItem(key) : null;
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(storage, key, val) {
    try {
      if (storage && storage.setItem) storage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function cloneLines(lines) {
    var src = Array.isArray(lines) ? lines : [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var ln = src[i] || {};
      out.push({
        code: String(ln.code == null ? '' : ln.code),
        name: String(ln.name == null ? '' : ln.name),
        qty: Number(ln.qty || 0),
        cost: Number(ln.cost || 0),
        received: Number(ln.received || 0)
      });
    }
    return out;
  }

  function create(opts) {
    var cfg = opts || {};
    var storage = cfg.storage || (root && root.localStorage) || null;
    var outbox = cfg.outbox || null;
    var dev = deviceId(storage);

    function flush() {
      var queued = 0;
      var errors = 0;
      try {
        if (!storage || !outbox || typeof outbox.enqueue !== 'function') {
          return { queued: 0, errors: 0 };
        }
        var orders = readJson(storage, ORDERS_KEY, []);
        if (!Array.isArray(orders)) return { queued: 0, errors: 0 };
        var synced = readJson(storage, SYNCED_KEY, {});
        if (!synced || typeof synced !== 'object' || Array.isArray(synced)) synced = {};
        var dirty = false;

        for (var i = 0; i < orders.length; i++) {
          var po = orders[i];
          if (!po || typeof po !== 'object' || po.remote) continue;
          if (!po.state || po.state === 'draft') continue;
          var key = poKey(po, dev);
          var histLen = Array.isArray(po.history) ? po.history.length : 0;
          var grnsLen = Array.isArray(po.grns) ? po.grns.length : 0;
          var sig = String(po.state) + ':' + histLen + ':' + grnsLen;
          if (synced[key] === sig) continue;

          var snapshot = {
            id: String(po.id == null ? '' : po.id),
            supplier: String(po.supplier == null ? '' : po.supplier),
            state: String(po.state),
            createdAt: String(po.createdAt == null ? '' : po.createdAt),
            lines: cloneLines(po.lines),
            historyLen: histLen
          };

          try {
            outbox.enqueue({
              id: key + ':' + histLen,
              op: 'po',
              key: key,
              po: snapshot
            });
            synced[key] = sig;
            dirty = true;
            queued++;
          } catch (_) {
            errors++;
          }
        }

        if (dirty) writeJson(storage, SYNCED_KEY, synced);
      } catch (_) {
        errors++;
      }
      return { queued: queued, errors: errors };
    }

    function applyChanges(changes) {
      var applied = 0;
      var skipped = 0;
      try {
        if (!storage || !Array.isArray(changes)) return { applied: 0, skipped: 0 };
        var orders = readJson(storage, ORDERS_KEY, []);
        if (!Array.isArray(orders)) orders = [];
        var dirty = false;

        for (var i = 0; i < changes.length; i++) {
          var ch = changes[i];
          if (!ch || ch.entity !== 'purchase_order' || !ch.data) continue;
          var d = ch.data;
          if (typeof d.key !== 'string' || !d.po || typeof d.po !== 'object') {
            skipped++;
            continue;
          }
          var key = d.key;
          var rpo = d.po;
          var incomingHistLen = Number(rpo.historyLen || 0);

          var idx = -1;
          for (var j = 0; j < orders.length; j++) {
            var cur = orders[j];
            if (!cur || typeof cur !== 'object') continue;
            if (cur.syncKey === key || (!cur.syncKey && poKey(cur, dev) === key)) {
              idx = j;
              break;
            }
          }

          if (idx !== -1) {
            var existing = orders[idx];
            if (!existing.remote) {
              skipped++;
              continue;
            }
            var curHistLen = Number(existing.historyLen || 0);
            if (incomingHistLen <= curHistLen) {
              skipped++;
              continue;
            }
          }

          var entry = {
            id: String(rpo.id == null ? '' : rpo.id) + '@' + key.slice(3, 9),
            syncKey: key,
            remote: true,
            supplier: String(rpo.supplier == null ? '' : rpo.supplier),
            state: String(rpo.state == null ? 'sent' : rpo.state),
            createdAt: String(rpo.createdAt == null ? '' : rpo.createdAt),
            lines: cloneLines(rpo.lines),
            historyLen: incomingHistLen,
            grns: [],
            history: []
          };

          if (idx !== -1) {
            orders[idx] = entry;
          } else {
            orders.push(entry);
          }
          dirty = true;
          applied++;
        }

        if (dirty) writeJson(storage, ORDERS_KEY, orders);
      } catch (_) {}
      return { applied: applied, skipped: skipped };
    }

    return {
      flush: flush,
      applyChanges: applyChanges
    };
  }

  var api = { create: create, poKey: poKey };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.NovaPoSync = api;
    try {
      if (root.NovaOutbox && root.localStorage && !root.novaPoSync) {
        root.novaPoSync = create({ storage: root.localStorage, outbox: root.NovaOutbox.createOutbox(root.localStorage, 'nova.outbox') });
      }
    } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
