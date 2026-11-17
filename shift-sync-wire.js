/* NOVA Rx - S2-06: shift closings sync. Single source of truth for POS shift closings: localStorage 'nova-rx-shift-closings-v1'
   (the list the reports screen already reads; records are immutable). finance-shifts.js (NovaShifts / 'nova.shifts') is retired
   for the POS screen. Every local closing is queued once as { id:'sh:<recId>', op:'shift', record } (kind 'ledger', entity
   'shift_close'); closings pulled from other devices are inserted by id (sorted by time) and never pushed back.
   No network here: the POS scheduler calls flush()/applyChanges() only while novaBackend.enabled is 'true'.
   Works as <script> (window.NovaShiftSync / window.novaShiftSync) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NovaShiftSync = factory();
    if (root.NovaOutbox && typeof root.localStorage !== 'undefined') {
      try {
        root.novaShiftSync = root.NovaShiftSync.create({
          storage: root.localStorage,
          outbox: root.NovaOutbox.createOutbox(root.localStorage, 'nova.outbox')
        });
      } catch (e) {}
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  var CLOSINGS_KEY = 'nova-rx-shift-closings-v1';
  var SYNCED_KEY = 'nova.shift.synced';
  var MAX_RECORDS = 200;

  function newClosingId(now) {
    var ts = typeof now === 'number' && isFinite(now) ? Math.floor(now) : Date.now();
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    var suffix = '';
    for (var i = 0; i < 6; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * 36));
    }
    return 'SC' + ts + '-' + suffix;
  }

  function readJson(storage, key, fallback) {
    try {
      var raw = storage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(storage, key, val) {
    storage.setItem(key, JSON.stringify(val));
  }

  function isValidRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    if (typeof r.id !== 'string' || !r.id) return false;
    if (typeof r.at !== 'number' || !isFinite(r.at)) return false;
    if (typeof r.float !== 'number' || !isFinite(r.float) || r.float < 0) return false;
    if (typeof r.expected !== 'number' || !isFinite(r.expected)) return false;
    if (typeof r.counted !== 'number' || !isFinite(r.counted) || r.counted < 0) return false;
    if (typeof r.diff !== 'number' || !isFinite(r.diff)) return false;
    if (typeof r.note !== 'string') return false;
    return true;
  }

  function create(opts) {
    var storage = opts && opts.storage;
    var outbox = opts && opts.outbox;

    function flush() {
      var queued = 0;
      var errors = 0;
      if (!storage || !outbox || typeof outbox.enqueue !== 'function') {
        return { queued: 0, errors: 0 };
      }
      try {
        var closings = readJson(storage, CLOSINGS_KEY, []);
        var synced = readJson(storage, SYNCED_KEY, []);
        var syncedMap = {};
        for (var i = 0; i < synced.length; i++) {
          syncedMap[synced[i]] = true;
        }
        var changed = false;
        for (var j = 0; j < closings.length; j++) {
          var rec = closings[j];
          if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
          if (syncedMap[rec.id]) continue;
          try {
            outbox.enqueue({
              id: 'sh:' + rec.id,
              op: 'shift',
              record: rec
            });
            synced.push(rec.id);
            syncedMap[rec.id] = true;
            queued++;
            changed = true;
          } catch (err) {
            errors++;
          }
        }
        if (changed) {
          writeJson(storage, SYNCED_KEY, synced);
        }
      } catch (e) {
        errors++;
      }
      return { queued: queued, errors: errors };
    }

    function applyChanges(changes) {
      var applied = 0;
      var skipped = 0;
      if (!storage || !Array.isArray(changes)) {
        return { applied: 0, skipped: 0 };
      }
      var closings = readJson(storage, CLOSINGS_KEY, []);
      var synced = readJson(storage, SYNCED_KEY, []);
      var existingIds = {};
      var syncedMap = {};
      var i;
      for (i = 0; i < closings.length; i++) {
        if (closings[i] && closings[i].id) existingIds[closings[i].id] = true;
      }
      for (i = 0; i < synced.length; i++) {
        syncedMap[synced[i]] = true;
      }

      var dirty = false;
      var syncedDirty = false;

      for (i = 0; i < changes.length; i++) {
        var ch = changes[i];
        if (!ch || ch.entity !== 'shift_close') continue;
        var rec = ch.data && ch.data.record;
        if (!isValidRecord(rec)) {
          skipped++;
          continue;
        }
        if (existingIds[rec.id]) {
          if (!syncedMap[rec.id]) {
            synced.push(rec.id);
            syncedMap[rec.id] = true;
            syncedDirty = true;
          }
          skipped++;
          continue;
        }
        closings.push(rec);
        existingIds[rec.id] = true;
        if (!syncedMap[rec.id]) {
          synced.push(rec.id);
          syncedMap[rec.id] = true;
          syncedDirty = true;
        }
        applied++;
        dirty = true;
      }

      if (dirty) {
        closings.sort(function (a, b) {
          return a.at - b.at;
        });
        if (closings.length > MAX_RECORDS) {
          closings = closings.slice(closings.length - MAX_RECORDS);
        }
        writeJson(storage, CLOSINGS_KEY, closings);
      }
      if (syncedDirty) {
        writeJson(storage, SYNCED_KEY, synced);
      }
      return { applied: applied, skipped: skipped };
    }

    return {
      flush: flush,
      applyChanges: applyChanges
    };
  }

  return {
    create: create,
    newClosingId: newClosingId
  };
});
