/* N30 / BUY-04: local prep list per supplier + read-back cart add. Local only; the adapter is injected (mock in tests).
   A line is 'confirmed' only after a read-back shows the same item id and the expected cart quantity.
   A failed add may be retried; an add whose result could not be read back is NEVER re-added, only re-read. */
(function (root) {
  'use strict';
  var KEY = 'novaPrepListV1', LABEL = 'LOCAL PREP LIST — not sent to any supplier';
  function createPrepList(storage) {
    function load() { try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch (e) { return []; } }
    function save(v) { storage.setItem(KEY, JSON.stringify(v)); }
    return {
      label: LABEL,
      add: function (supplierId, line) {
        var qty = Number(line.qty);
        if (!supplierId || !line.id || !(qty > 0) || Math.floor(qty) !== qty) throw new Error('bad-line');
        var all = load(), hit = all.find(function (l) { return l.supplierId === supplierId && l.id === String(line.id); });
        if (hit) { hit.qty += qty; hit.status = 'pending'; } else all.push({ supplierId: supplierId, id: String(line.id), name: line.name || '', qty: qty, status: 'pending' });
        save(all);
      },
      lines: function (supplierId) { return load().filter(function (l) { return l.supplierId === supplierId; }); },
      suppliers: function () { var s = []; load().forEach(function (l) { if (s.indexOf(l.supplierId) < 0) s.push(l.supplierId); }); return s; },
      mark: function (supplierId, id, patch) { var all = load(); all.forEach(function (l) { if (l.supplierId === supplierId && l.id === id) Object.assign(l, patch); }); save(all); }
    };
  }
  /* adapter: { cartQty(id) -> Promise<number|null>, add(id, qty) -> Promise }, confirm(line, expected) -> boolean.
     Returns [{id, qty, status, readBack}] with status confirmed | declined | failed | unconfirmed. */
  async function pushToCart(list, supplierId, adapter, confirm) {
    var out = [];
    for (var line of list.lines(supplierId)) {
      if (line.status === 'confirmed') continue;
      var r = { id: line.id, qty: line.qty, status: 'failed', readBack: null };
      try {
        if (line.status === 'unconfirmed') {            // retry after unreadable result: re-read only, never re-add
          var now = await adapter.cartQty(line.id);
          r.readBack = { id: line.id, qty: now };
          r.status = now === line.expected ? 'confirmed' : 'unconfirmed';
        } else {
          var before = await adapter.cartQty(line.id), expected = (before || 0) + line.qty;
          if (!confirm(line, expected)) { r.status = 'declined'; out.push(r); continue; }
          list.mark(supplierId, line.id, { status: 'unconfirmed', expected: expected });   // persisted before the write
          try { await adapter.add(line.id, line.qty); } catch (e) {
            var chk = null; try { chk = await adapter.cartQty(line.id); } catch (e2) { /* unreadable */ }
            if (chk === before || (chk == null && before == null)) { list.mark(supplierId, line.id, { status: 'failed' }); out.push(r); continue; }
            r.status = 'unconfirmed'; r.readBack = { id: line.id, qty: chk }; out.push(r); continue;
          }
          var after = await adapter.cartQty(line.id);
          r.readBack = { id: line.id, qty: after };
          r.status = after === expected ? 'confirmed' : 'unconfirmed';
        }
      } catch (e) { r.status = line.status === 'unconfirmed' || r.readBack ? 'unconfirmed' : 'failed'; }
      list.mark(supplierId, line.id, { status: r.status === 'declined' ? 'pending' : r.status });
      out.push(r);
    }
    return out;
  }
  var api = { createPrepList: createPrepList, pushToCart: pushToCart, LABEL: LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaPrepList = api;
})(typeof window !== 'undefined' ? window : globalThis);
