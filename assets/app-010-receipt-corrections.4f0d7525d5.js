/* Q21-2m PREVIEW ONLY: testers on the preview Worker (nova-rx-preview.*.workers.dev) open an empty device and hit empty invoices /
   reports. On that host only, a device with no sales gets a few clearly marked demo invoices (numbers start with DEMO-), once. Never on any
   other host, never when the device already has sales, and the flag stops it from coming back after the tester clears them. */
(function () {
  try {
    if (!/^nova-rx-preview\./.test(location.hostname)) return;
    var KEY = 'nova-rx-sales-v1', FLAG = 'nova.preview.demoSeeded';
    if (localStorage.getItem(FLAG)) return;
    var cur = JSON.parse(localStorage.getItem(KEY) || '[]');
    localStorage.setItem(FLAG, new Date().toISOString());
    if (Array.isArray(cur) && cur.length) return;
    var now = Date.now(), P = [['6281001234568', 'بانادول إكسترا', 12], ['6281001234576', 'سيتريزين 10 مجم', 14.75], ['6281001234577', 'فولتارين جل 50 جم', 26], ['6281001234575', 'فيتامين د3 50,000 وحدة', 45]];
    var pays = ['cash', 'card', 'cash', 'wallet', 'cash', 'card'];
    var sales = pays.map(function (pay, i) {
      var p = P[i % P.length], q = 1 + (i % 3), total = Math.round(p[2] * q * 100) / 100;
      var vat = window.novaVat ? window.novaVat.calc(total) : Math.round((total * 14 / 114) * 100) / 100;
      return { id: 'DEMO-S' + (i + 1), number: 'DEMO-' + String(i + 1).padStart(4, '0'), at: now - (i + 1) * 47 * 60000, subtotal: total, discount: 0, total: total, vat: vat,
        received: pay === 'cash' ? total : 0, change: 0, tenders: [{ method: pay, amount: total }], payment: pay,
        status: 'final', demo: true, lines: [{ barcode: p[0], name: p[1], price: p[2], qty: q, discount: 0 }] };
    });
    localStorage.setItem(KEY, JSON.stringify(sales));
  } catch (e) {}
})();

/* Receipt corrections share the existing device stores. Call mutations under the stock lock. */
(function (root) {
  'use strict';
  const KEYS = { receipts: 'nova-rx-receipts-v1', orders: 'nova.purchase.orders',
    lots: 'nova-rx-lots-v1', ledger: 'nova.stock.ledger', journal: 'nova.receipt-transaction-v1' };
  function fail(code) { const error = new Error(code); error.code = code; throw error; }
  function read(storage, key) {
    const rows = JSON.parse(readRaw(storage, key) || '[]');
    if (!Array.isArray(rows)) fail('invalid-store');
    return rows;
  }
  // Readers use the committed journal image while a failed write awaits locked recovery.
  function readRaw(storage, key) {
    const journal = storage.getItem(KEYS.journal);
    const writes = journal ? JSON.parse(journal).writes : null;
    return writes && Object.prototype.hasOwnProperty.call(writes, key) ? writes[key] : storage.getItem(key);
  }
  function recover(storage) {
    const raw = storage.getItem(KEYS.journal);
    if (!raw) return;
    const transaction = JSON.parse(raw);
    for (const [key, value] of Object.entries(transaction.writes)) {
      if (!Object.values(KEYS).includes(key) || key === KEYS.journal) fail('invalid-journal');
      storage.setItem(key, value);
    }
    storage.removeItem(KEYS.journal);
  }
  function commit(storage, writes) {
    storage.setItem(KEYS.journal, JSON.stringify({ writes }));
    recover(storage);
  }
  function effectiveLines(receipt) {
    return receipt.lines.map((line, index) => ({ ...line, qty: line.qty +
      (receipt.corrections || []).reduce((sum, correction) => sum +
        correction.changes.filter(change => change.index === index).reduce((n, change) => n + change.delta, 0), 0) }));
  }
  function review(po, lines) {
    const codes = new Set([...(po?.lines || []).map(line => line.code), ...lines.map(line => line.code)]);
    return [...codes].map(code => {
      const ordered = po?.lines.find(line => line.code === code);
      const incoming = lines.filter(line => line.code === code);
      const quantity = incoming.reduce((sum, line) => sum + Number(line.qty), 0);
      const remaining = ordered ? Math.max(0, ordered.qty - ordered.received - (ordered.cancelledQty || 0)) : 0;
      return { code, name: incoming[0]?.name || ordered?.name || code,
        ordered: ordered?.qty ?? null, prior: ordered?.received || 0, quantity,
        remaining: ordered ? Math.max(0, remaining - quantity) : null,
        excess: ordered ? Math.max(0, quantity - remaining) : 0,
        unordered: !!po && !ordered, expectedCost: ordered?.cost ?? null,
        costs: [...new Set(incoming.map(line => Number(line.cost)))],
        costChanged: !!ordered && incoming.some(line => Math.round(line.cost * 100) !== Math.round(ordered.cost * 100)) };
    });
  }
  function correct(storage, request, context) {
    recover(storage);
    const receipts = read(storage, KEYS.receipts);
    const receipt = receipts.find(row => row.id === request.receiptId);
    if (!receipt || receipt.pending) fail('receipt-unavailable');
    const previous = (receipt.corrections || []).find(row => row.id === request.id);
    if (previous) {
      if (previous.signature !== JSON.stringify(request)) fail('correction-conflict');
      return previous;
    }
    if (!context.actor?.id || !context.allowed) fail('permission');
    if (!request.id || !request.reason?.trim()) fail('reason-required');
    if ((receipt.corrections || []).length !== request.version) fail('receipt-changed');
    if (!Array.isArray(request.quantities) || request.quantities.length !== receipt.lines.length) fail('bad-qty');
    const effective = effectiveLines(receipt);
    const changes = effective.flatMap((line, index) => {
      const quantity = request.quantities[index];
      if (!Number.isSafeInteger(quantity) || quantity < 0) fail('bad-qty');
      return quantity === line.qty ? [] : [{ index, code: line.code, key: line.key,
        lot: line.lot, expiry: line.expiry, cost: line.cost, before: line.qty, after: quantity, delta: quantity - line.qty }];
    });
    if (!changes.length) fail('no-changes');
    const lots = read(storage, KEYS.lots);
    const reductions = new Map();
    changes.filter(change => change.delta < 0).forEach(change => {
      const key = JSON.stringify([change.key, change.lot, change.expiry]);
      reductions.set(key, (reductions.get(key) || 0) - change.delta);
    });
    for (const [key, quantity] of reductions) {
      const [product, lot, expiry] = JSON.parse(key);
      if (context.hasHold(product)) fail('stock-reserved');
      if (context.available(product, lot, expiry) < quantity) fail('insufficient-stock');
    }
    const movements = read(storage, KEYS.ledger);
    const orders = read(storage, KEYS.orders);
    const po = receipt.poId ? orders.find(row => row.id === receipt.poId) : null;
    if (receipt.poId && !po) fail('po-not-found');
    const at = context.now || new Date().toISOString();
    // Older manual receipts predate ledger wiring. Preserve their original receipt movement on first correction.
    if (!po) receipt.lines.forEach((line, index) => {
      const ref = receipt.id + '/original/' + index;
      if (!movements.some(row => row.ref === ref)) movements.push({ seq: movements.length + 1,
        at: receipt.at, kind: 'receive', code: line.code, qty: line.qty, delta: line.qty,
        ref, lot: line.lot, expiry: line.expiry, cost: line.cost });
    });
    changes.forEach(change => {
      let left = -change.delta;
      const matching = lots.filter(row => row.key === change.key && row.lot === change.lot && row.expiry === change.expiry);
      if (change.delta > 0) {
        if (matching.length) matching[0].qty += change.delta;
        else lots.push({ key: change.key, lot: change.lot, expiry: change.expiry, cost: change.cost, qty: change.delta });
      } else {
        for (const row of matching) { const take = Math.min(row.qty, left); row.qty -= take; left -= take; }
        if (left > 0) fail('insufficient-stock');
      }
      movements.push({ seq: movements.length + 1, at, kind: 'adjustment', code: change.code,
        qty: change.delta, delta: change.delta, ref: receipt.id + '/correction/' + request.id + '/' + change.index });
      const ordered = po?.lines.find(line => line.code === change.code);
      if (ordered) {
        ordered.received += change.delta;
        if (ordered.received < 0) fail('bad-po-total');
        if (po.closure) ordered.cancelledQty = Math.max(0, ordered.qty - ordered.received);
      }
    });
    const record = { id: request.id, at, by: { id: context.actor.id, name: context.actor.name },
      reason: request.reason.trim(), changes, signature: JSON.stringify(request) };
    receipt.corrections = [...(receipt.corrections || []), record];
    if (po) {
      if (!po.closure) po.state = po.lines.every(line => line.received >= line.qty) ? 'received' : 'partial';
      po.history.push({ at, state: po.state, by: context.actor.id, correction: request.id, receiptId: receipt.id });
      const grn = po.grns.find(row => row.ref === receipt.invoice);
      if (!grn) fail('receipt-link-missing');
      grn.corrections = [...(grn.corrections || []), record];
    }
    commit(storage, { [KEYS.receipts]: JSON.stringify(receipts), [KEYS.orders]: JSON.stringify(orders),
      [KEYS.lots]: JSON.stringify(lots.filter(row => row.receiptRefs || row.qty > 0)), [KEYS.ledger]: JSON.stringify(movements) });
    return record;
  }
  const api = { KEYS, readRaw, recover, review, correct, effectiveLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaReceiptOperations = api;
})(typeof window === 'undefined' ? globalThis : window);
