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
