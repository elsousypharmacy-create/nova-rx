/* NOVA Rx - S2-05: customer credit (آجل) sync. Every local credit movement (nova.credit) is queued once to the offline outbox as
   { id:'cr:<moveId>', op:'credit', move } (sent as kind 'ledger', entity 'credit_move'); credit_move changes pulled from other
   devices are imported AS-IS (same id, same FIFO allocations) and never pushed back. Ids already handled live in 'nova.credit.synced'.
   No network here: the scheduler in pos-sync-wire.js calls flush() before syncAll and applyChanges(feed) after it, only while
   novaBackend.enabled is 'true'. Works as <script> (window.NovaCreditSync / window.novaCreditSync) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NovaCreditSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SYNCED_KEY = 'nova.credit.synced';

  function create(o) {
    if (!o || !o.storage || !o.outbox || !o.ledger) throw new Error('missing-deps');
    var storage = o.storage;
    var outbox = o.outbox;
    var ledger = o.ledger;
    var syncedKey = o.syncedKey || SYNCED_KEY;

    function loadSynced() {
      try {
        var raw = storage.getItem(syncedKey);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }

    function saveSynced(arr) {
      try {
        storage.setItem(syncedKey, JSON.stringify(arr));
      } catch (e) {}
    }

    function flush() {
      var queued = 0, errors = 0;
      try {
        var synced = loadSynced();
        var map = {};
        var i;
        for (i = 0; i < synced.length; i++) map[synced[i]] = true;
        var moves = ledger.allMoves ? ledger.allMoves() : [];
        var dirty = false;
        for (i = 0; i < moves.length; i++) {
          var m = moves[i];
          if (!m || typeof m.id !== 'string' || !m.id || map[m.id]) continue;
          try {
            outbox.enqueue({ id: 'cr:' + m.id, op: 'credit', move: m });
            synced.push(m.id);
            map[m.id] = true;
            dirty = true;
            queued++;
          } catch (e) {
            errors++;
          }
        }
        if (dirty) saveSynced(synced);
      } catch (e) {
        errors++;
      }
      return { queued: queued, errors: errors };
    }

    function applyChanges(changes) {
      var applied = 0, skipped = 0;
      if (!Array.isArray(changes) || !changes.length) return { applied: 0, skipped: 0 };
      var synced = loadSynced();
      var map = {};
      var i;
      for (i = 0; i < synced.length; i++) map[synced[i]] = true;
      var dirty = false;
      for (i = 0; i < changes.length; i++) {
        var c = changes[i];
        if (!c || c.entity !== 'credit_move') continue;
        var data = c.data || c.payload;
        var m = data && data.move;
        if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id) {
          skipped++;
          continue;
        }
        var r = ledger.importMove(m);
        if (r && r.ok) {
          if (!map[m.id]) {
            synced.push(m.id);
            map[m.id] = true;
            dirty = true;
          }
          if (r.imported) applied++;
          else skipped++;
        } else {
          skipped++;
        }
      }
      if (dirty) saveSynced(synced);
      return { applied: applied, skipped: skipped };
    }

    return {
      flush: flush,
      applyChanges: applyChanges
    };
  }

  /* credit-ledger.js is a deferred <script>: wire now if it is already there, else on DOMContentLoaded (deferred scripts run before it). */
  function autowire() {
    if (typeof window === 'undefined' || window.novaCreditSync || !window.NovaCredit || !window.NovaOutbox) return;
    try {
      var ls = window.localStorage;
      if (ls) {
        var ledger = window.NovaCredit.createCreditLedger(ls, 'nova.credit');
        if (typeof ledger.allMoves !== 'function' || typeof ledger.importMove !== 'function') return; // old credit-ledger.js: stay off
        var outbox = window.NovaOutbox.createOutbox(ls, 'nova.outbox');
        window.novaCreditSync = create({ storage: ls, outbox: outbox, ledger: ledger });
      }
    } catch (e) {}
  }
  if (typeof window !== 'undefined') {
    autowire();
    if (!window.novaCreditSync && window.document && window.document.addEventListener) window.document.addEventListener('DOMContentLoaded', autowire);
  }

  return { create: create };
});
