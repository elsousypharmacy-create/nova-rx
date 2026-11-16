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
