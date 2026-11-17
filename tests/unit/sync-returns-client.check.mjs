// S2-01 client: a POS return is queued as an explicit 'return' op after its sale; pulled returns move local stock exactly once.
// Run: node tests/unit/sync-returns-client.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create: createWire } = require('../../pos-sync-wire.js');
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');
const { createBackendClient } = require('../../backend-client.js');

function memStorage() {
  const map = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem(k, v) {
      map[k] = String(v);
    },
    removeItem(k) {
      delete map[k];
    }
  };
}

// 1. Box sale + return of 1 -> outbox has invoice then ret:<id> with op 'return', saleInvoiceId and line price
{
  const storage = memStorage();
  const outbox = createOutbox(storage);
  const ledger = createLedger(storage);
  const wire = createWire({ storage, outbox, ledger });

  const sale = {
    id: 'inv-100',
    lines: [{ barcode: 'p1', name: 'Product 1', unit: 'box', unitFactor: 1, qty: 3, price: 25 }]
  };
  wire.afterSale(sale);

  const ret = {
    id: 'r-200',
    lines: [{ idx: 0, qty: 1 }]
  };
  const res = wire.afterReturn(sale, ret);
  assert.equal(res.ok, true);
  assert.equal(res.queued, true);
  assert.equal(res.movements, 1);

  const items = outbox.all();
  assert.equal(items.length, 2);
  assert.equal(items[0].key, 'inv-100');
  assert.equal(items[1].key, 'ret:r-200');
  assert.deepEqual(items[1].payload, {
    id: 'ret:r-200',
    op: 'return',
    clientReturnId: 'r-200',
    saleInvoiceId: 'inv-100',
    lines: [{ code: 'p1', qty: 1, price: 25 }]
  });
}

// 2. Return of a strip-unit sale -> not queued, in nova.sync.skipped
{
  const storage = memStorage();
  const outbox = createOutbox(storage);
  const ledger = createLedger(storage);
  const wire = createWire({ storage, outbox, ledger });

  const stripSale = {
    id: 'inv-strip-1',
    lines: [{ barcode: 'p2', name: 'Product 2', unit: 'strip', unitFactor: 0.5, qty: 2, price: 10 }]
  };
  const ret = {
    id: 'r-strip-1',
    lines: [{ idx: 0, qty: 1 }]
  };
  const res = wire.afterReturn(stripSale, ret);
  assert.equal(res.ok, true);
  assert.equal(res.queued, false);
  assert.equal(res.skipped, 'unit-mapping');
  assert.equal(outbox.all().length, 0);

  const skipped = JSON.parse(storage.getItem('nova.sync.skipped') || '[]');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'unit-mapping');
}

// 3. applyChanges with sale_return on another device -> onHand goes up by qty, replay -> skipped & onHand unchanged
{
  const storage = memStorage();
  const outbox = createOutbox(storage);
  const ledger = createLedger(storage);
  // Note: hasSale / addSale omitted to verify sale_return does not require them
  const wire = createWire({ storage, outbox, ledger });

  assert.equal(ledger.onHand('p1'), 0);

  const change = {
    entity: 'sale_return',
    id: 'srv-ret-1',
    deleted: false,
    data: {
      returnId: 'srv-ret-1',
      clientReturnId: 'r-remote-1',
      saleInvoiceId: 'inv-100',
      items: [{ productId: 'p1', qty: 4 }]
    }
  };

  const first = wire.applyChanges([change]);
  assert.deepEqual(first, { applied: 1, skipped: 0 });
  assert.equal(ledger.onHand('p1'), 4);

  const replay = wire.applyChanges([change]);
  assert.deepEqual(replay, { applied: 0, skipped: 1 });
  assert.equal(ledger.onHand('p1'), 4);
}

// 4. applyChanges on originating device (already has return:<id> movement) -> skipped
{
  const storage = memStorage();
  const outbox = createOutbox(storage);
  const ledger = createLedger(storage);
  const wire = createWire({ storage, outbox, ledger });

  const sale = {
    id: 'inv-300',
    lines: [{ barcode: 'p1', name: 'Product 1', unit: 'box', unitFactor: 1, qty: 5, price: 15 }]
  };
  wire.afterSale(sale);
  wire.afterReturn(sale, { id: 'r-orig-1', lines: [{ idx: 0, qty: 2 }] });
  const before = ledger.onHand('p1');

  const pulledOwnReturn = {
    entity: 'sale_return',
    id: 'srv-ret-2',
    deleted: false,
    data: {
      returnId: 'srv-ret-2',
      clientReturnId: 'r-orig-1',
      saleInvoiceId: 'inv-300',
      items: [{ productId: 'p1', qty: 2 }]
    }
  };

  const res = wire.applyChanges([pulledOwnReturn]);
  assert.deepEqual(res, { applied: 0, skipped: 1 });
  assert.equal(ledger.onHand('p1'), before);
}

// 5. endpoint.send with return payload posts kind:'ledger' & entity:'sale_return'; invoice posts no kind; SYNC_SALE_NOT_SYNCED stays pending
{
  const storage = memStorage();
  const outbox = createOutbox(storage);
  const postedBodies = [];
  let nextStatus = { status: 'applied' };

  const fakeFetch = async (url, opts) => {
    postedBodies.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      async json() {
        return { results: [nextStatus] };
      }
    };
  };

  const client = createBackendClient({
    storage,
    fetch: fakeFetch,
    outbox,
    getToken: () => 'test-token'
  });

  const ep = client.endpoint;
  assert.ok(ep && typeof ep.send === 'function', 'client exposes its sync endpoint');

  // Send return payload
  const retRes = await ep.send({
    key: 'ret:r-500',
    payload: {
      id: 'ret:r-500',
      op: 'return',
      clientReturnId: 'r-500',
      saleInvoiceId: 'inv-500',
      lines: [{ code: 'p1', qty: 1, price: 20 }]
    }
  });
  assert.equal(retRes.ok, true);
  assert.equal(postedBodies[0].ops[0].key, 'ret:r-500');
  assert.equal(postedBodies[0].ops[0].kind, 'ledger');
  assert.equal(postedBodies[0].ops[0].entity, 'sale_return');

  // Send invoice payload
  const invRes = await ep.send({
    key: 'inv-500',
    payload: {
      id: 'inv-500',
      lines: [{ code: 'p1', qty: 1, price: 20 }]
    }
  });
  assert.equal(invRes.ok, true);
  assert.equal(postedBodies[1].ops[0].key, 'inv-500');
  assert.equal('kind' in postedBodies[1].ops[0], false);
  assert.equal('entity' in postedBodies[1].ops[0], false);

  // Verify SYNC_SALE_NOT_SYNCED returns error so outbox keeps it pending
  nextStatus = { status: 'conflict', code: 'SYNC_SALE_NOT_SYNCED' };
  outbox.enqueue({
    id: 'ret:r-501',
    op: 'return',
    clientReturnId: 'r-501',
    saleInvoiceId: 'inv-501',
    lines: [{ code: 'p1', qty: 1, price: 20 }]
  });
  await outbox.sync(ep);
  assert.equal(outbox.all().length, 1);
  assert.equal(outbox.all()[0].key, 'ret:r-501');
  assert.equal(outbox.all()[0].status, 'pending', 'not synced yet: stays pending for retry');
}

console.log('sync-returns-client OK');
