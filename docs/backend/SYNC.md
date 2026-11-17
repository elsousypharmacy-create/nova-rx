# SYNC — POST /api/v1/sync/push (N101)

Flag `NOVA_SYNC=1` (default OFF; also needs the `DB` binding and a `NOVA_AUTH` bearer session). Off → `404 SYNC_DISABLED`; the client stays in local/offline mode and any error falls back to it.

Request: `{ "ops": [ ... ] }` (max 200; `changes` accepted as alias). Each op is what `offline-outbox.js` sends:
`{ key, payload }` (no `kind` → ledger entity `invoice`, record id = `key`) or the explicit form
`{ key, kind: "ledger"|"master", entity, id?, payload, baseVersion? }`.

Response `200`: `{ ok, results: [{ key, status, ... }], requestId }`, one result per op, in order. A bad op never fails the batch.
`status`: `applied` | `conflict` | `rejected` | `error` (retryable). Errors carry stable `code` + `message_ar`.

## Idempotency
`(tenant, op.key)` is stored in `sync_ops` with its result. A replay returns the stored result with `duplicate: true` and changes nothing (safe after a lost response). Only definitive results (applied/conflict/rejected) are stored; `error` is not, so it can be retried.

## Conflict policy
- **Ledgers are append-only** (`sync_ledger`, UPDATE/DELETE blocked by triggers). Same id + identical payload = duplicate no-op; same id + different payload = `rejected SYNC_LEDGER_EXISTS`. Corrections are new ledger ops.
- **Master data is last-writer-wins with a version check** (`sync_master.version`). `baseVersion` equal to the server version → applied, version+1 (compare-and-set). `baseVersion` stale → `conflict SYNC_VERSION_CONFLICT` with `serverVersion`; nothing is overwritten and the client reviews/resubmits with the new base. `baseVersion` omitted → explicit last-writer-wins overwrite. New record: base 0/omitted.

Tenant comes from the session (`tenant`) or `NOVA_TENANT_ID`, default `default`.

## S1-02 — push applies the sale, pull returns it (flags default OFF)
- **Client:** `backend-client.js` pulls `GET /api/v1/sync/pull?cursor=` -> `{ changes:[{seq,entity,id,deleted,data}], nextCursor, hasMore }` (the old `/sync/feed` route never existed).
- **Push:** with `NOVA_SYNC=1` + `NOVA_SALES_WRITES=1`, an outbox invoice op (entity `invoice`, payload with `lines`) is applied as a real sale (`sales`, `sale_items`, `payments`, `inventory_movements`, journal) in ONE `db.batch()` together with its `sync_ledger`, `change_feed` (entity `sale`) and `sync_ops` rows: all-or-nothing, so a replay of the same `op.key` returns the stored result and never decrements stock twice.
- **Mapping (POS line -> sale item):** `productId = String(line.productId || line.code)`, `qty = line.qty` (positive integer), `unitPriceMinor = round(line.price * 100)` (the POS stores major units); invoice discount = `round(payload.discount * 100)`; payments = `payload.payments[{method, amount}]` or one cash payment = total. An invoice op without `lines` stays a plain ledger record.
- **Conflicts:** not enough stock -> `{status:'conflict', code:'SYNC_STOCK_CONFLICT'}`, nothing written and the result is NOT cached, so the same op can succeed after stock is received. A bad invoice -> `rejected / SYNC_INVOICE_INVALID`.
- **Scope:** sessions with scope data use the isolation check; a KV owner session acts for `NOVA_TENANT_ID` on that tenant's only branch (`backend/src/sync-scope.js`); zero or several branches -> `SCOPE_INVALID`.
- **Not in this task:** returns/cancel through sync (S1-03/04), staff sessions with branch data (S1-06).
- Tests: `tests/unit/backend-sync-sales.check.mjs`.

## S2-01 — returns / cancels sync (same flags; nothing new is enabled by default)
- POS: a return (a cancel = return of all remaining qty) whose sale was sendable (whole boxes) is queued AFTER that sale as
  `{ key:'ret:<retId>', kind:'ledger', entity:'sale_return', payload:{ id:'ret:<retId>', op:'return', clientReturnId, saleInvoiceId, lines:[{code,qty,price}] } }`.
  It is never sent as an invoice. A return of a non-box sale stays local and is listed in `nova.sync.skipped`.
- Server (`applyReturn` in `backend/src/sync.js`): finds the sale through `sync_ops` (op_key = invoice id) and calls `returnSale` with
  `opts.extra`, so return rows + stock movement + `sync_ledger` + `change_feed` (entity `sale_return`) + `sync_ops` are ONE batch.
  Sale not synced yet => `conflict SYNC_SALE_NOT_SYNCED` (not cached, the outbox retries). Over-return => `rejected SYNC_RETURN_REJECTED`, nothing written.
- Other devices: `applyChanges` appends a `return` ledger movement with ref `return:<clientReturnId>` (the same ref the selling device used),
  so it is applied exactly once per device. Flag OFF (`novaBackend.enabled`) => zero network calls, as before.
- Tests: `tests/unit/backend-sync-returns.check.mjs`, `tests/unit/sync-returns-client.check.mjs`, `tests/unit/pos-outbox-wire.check.mjs`.

## S2-02 — strip/tablet units sync as integer base units
- Base unit of a product = its finest packaged unit (tablet, else strip, else box); box-only products are unchanged.
  POS line -> `{ code, qty: qty * basePerBox / perBox[unit], price: ceil(lineTotal / baseQty), unit, perBox }`; the invoice discount keeps the server total equal to the POS total.
- The server counts stock in base units (`sale_items.qty` stays an integer). `change_feed` sale items carry `unit`/`perBox` so other devices show the line in that unit.
- A product without packaging info is NOT dropped: the invoice (and its returns) wait in `nova.sync.review` with an Arabic reason and are queued once by `retryReview` after the packaging is set (outbox is idempotent by sale id).
- Test: `tests/unit/sync-units.check.mjs`.

## S2-05 — credit (آجل) sync
- Every local `nova.credit` movement is queued once as `{ key:'cr:<moveId>', kind:'ledger', entity:'credit_move', payload:{ id, op:'credit', move } }`.
- Server: `sync_ledger` + `change_feed` (entity `credit_move`) + `sync_ops` in ONE batch; replay = duplicate; invalid move = `SYNC_CREDIT_INVALID`.
- Other devices import the movement AS-IS (same id, same FIFO allocations), so balances and aging match; imported ids are never pushed back.
  Opening/reversal ids now carry a random suffix so two devices never collide.
- Tests: `tests/unit/credit-sync.check.mjs`, case 7 of `tests/unit/backend-sync-returns.check.mjs`.

## S2-06 — shift close sync (one source of truth)
- The reports screen's closings list `nova-rx-shift-closings-v1` is the ONLY shift ledger on the POS (records are immutable;
  `finance-shifts.js` / `nova.shifts` is retired for the POS screen). Closing ids are `SC<ms>-<6 random>` so devices never collide.
- Each closing is queued once as `{ key:'sh:<id>', kind:'ledger', entity:'shift_close', payload:{ id, op:'shift', record } }`.
- Server: `sync_ledger` + `cashier_sessions` (id `cs:<recordId>`, status `closed`, float/counted in minor units) + `change_feed`
  (entity `shift_close`) + `sync_ops` in ONE batch; replay = duplicate; invalid = `SYNC_SHIFT_INVALID`.
- Other devices insert the record by id (sorted by time), so "آخر إقفال" and "من آخر إقفال" match everywhere; imported records are never pushed back.
- Test: `tests/unit/shift-sync.check.mjs`.

## S2-03 — goods receipt (GRN) sync
- After a confirmed receive on the purchases page, `receipt-sync-wire.js` queues ONE op to the shared outbox:
  `{ key:'rcv:<poId>:<fnv32>', kind:'ledger', entity:'stock_receipt', payload:{ id, op:'receipt', poId, ref, lines:[{ code, qty (base units), price (cost per base unit), lot, expiry, unit, perBox }] } }`
  (the id hashes PO id + PO createdAt + GRN ref, so Arabic refs and repeated PO numbers on two devices never collide).
- Server (`applyReceipt`): product row created if missing (`INSERT OR IGNORE`, id = code), lot batch upserted (`qty_on_hand += qty`),
  `inventory_movements` receipt row, `sync_ledger`, `change_feed` (entity `stock_receipt`), `sync_ops`: ONE batch. Invalid = `SYNC_RECEIPT_INVALID`.
- Other devices append `receive` ledger movements (base units, lot/expiry/cost) once; the receiving device skips its own receipt
  (already in its ledger in boxes) via `nova.receipts.local`. The POS scheduler runs it as an extra; the purchases page only enqueues.
- Test: `tests/unit/receipt-sync.check.mjs`.

## S2-04 — purchase orders on the server (no supplier contact)
- `po-sync-wire.js` (POS scheduler extra) queues a snapshot of every local PO that left `draft` whenever its state / history / GRN count changes:
  `{ key:'po:<fnv32>:<historyLen>', kind:'ledger', entity:'purchase_order', payload:{ id, op:'po', key:'po:<fnv32>', po:{ id, supplier, state, createdAt, lines, historyLen } } }`
  (key = hash of PO id + createdAt, because `PO-n` numbers repeat across devices).
- Server: supplier (`<tenant>:sup:<fnv32(name)>`), `purchase_orders` upsert (status: draft | sent (sent/accepted/partial) | received | cancelled),
  products and `purchase_order_items` (OR IGNORE), `sync_ledger`, `change_feed` (entity `purchase_order`), `sync_ops`: ONE batch. Invalid = `SYNC_PO_INVALID`.
- Other devices keep a read-only remote copy (`remote:true`, id `PO-n@<key part>`, newest history wins) next to their own POs; remote copies are never pushed back.
  Nothing here calls a supplier, writes a supplier cart or places an order.
- Test: `tests/unit/po-sync.check.mjs`.