# INV-01 — stock ledger + the CAT→POS→INV→BUY cycle (code, PROPOSED, not accepted)

Roadmap INV-01 (ledger), with the glue that makes it the integration spine for CAT-01/02, POS-02 (atomic invoice), POS-04 (returns, core only), BUY-05 (receiving, core only). Issue #87. **Pure, isolated, not wired to the Worker or UI. No storage product is chosen.**

## What exists
- `worker/inventory/stock-core.js`: `createStockCore(db)` over a tiny **sync** SQLite-style store (`exec`, `prepare().run/get/all`; tested with `node:sqlite`). Append-only `stock_movement` (UPDATE/DELETE refused by trigger), `stock_balance` with `CHECK(on_hand >= 0)`, batches with expiry, per-tenant+branch scope on every call (`scope-invalid` otherwise), integer cents and whole base units.
  `receiveGoods` (optionally against a purchase order: partial delivery tracked, over-receipt and foreign products refused, lot expiry cannot change), `sell` (FEFO, expired stock not sellable, payments must equal the total, one transaction), `returnItems` (back to the same batches, refund exact to the cent over any number of partial returns), `setPolicy` / `shortages` (need = max − sellable stock), `registerPurchaseOrder` / `poStatus`, `getInvoice`, `reconcile` (the invariants). Every write takes an idempotency key (namespaced per kind, scoped per tenant): the same key and payload returns the stored result, a different payload is refused.
- `worker/inventory/glue.js`: `buildSaleLines` (real CAT-01 lookup + CAT-02 conversion and exact price allocation → sale lines), `planReplenishment` (shortage → whole purchase packs, rounded up), `poLinesFromDraft` (approved `po-draft.js` draft → PO lines in base units).
- `tests/integration/core-cycle.check.mjs` (11 cases): the full cycle in one run on the real committed catalog export (4378 rows) with fixture packaging, mock supplier offers (no supplier call), plus isolation, crash injection, replay, tamper detection.

## Run
`node --no-warnings tests/integration/core-cycle.check.mjs` and `node --no-warnings tests/unit/procurement-po-draft.check.mjs`. CI: `.github/workflows/core-cycle.yml` (runs on a PR).
Safeguards were mutation-checked (28 deliberate breakages; the survivors of the first pass got tests; one remaining mutant is an unreachable defensive branch).

## What is proven vs not
Proven on isolated fixtures: the logic, the invariants and the idempotency/atomicity/isolation rules above.
**Not done / not claimed:**
1. Not wired to any route, UI or Worker; the POS screen still sells demo data.
2. Production storage (D1 vs Postgres, FND-02) is an owner decision. The core's store interface is synchronous; D1 is asynchronous, so a D1 adapter needs an async port of the same SQL (follow-up, no behaviour change intended).
3. Tenant/branch comes from the `scope` argument. In production it must come from a verified session through the SEC-03 wrapper, which is blocked on review findings; SEC-01 sessions do not exist in the running Worker (one shared PIN).
4. Packaging (pack/strip/tablet) is a fixture: the real export has only `units`, and the CAT-01 product has no `packaging` field yet (CAT follow-up). Where the packaging data comes from is open.
5. No audit events yet (SEC-04 module exists but is not hooked in), no reservations/holds (INV-03), no stock counts/adjustments (INV-04), no transfers/recalls (INV-05), no tax (CAT-03), no credit-sale ledger (CRM-02), no void/cancel (POS-04 rest), no sale hold/draft (POS-03), no device/printing.
6. Shortage → supplier flow uses the existing `buildDrafts` with mock offers only. No real cart write, order or checkout, and none is possible from this code.
