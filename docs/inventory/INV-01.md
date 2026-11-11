# INV-01 stock ledger core (+ FEFO and expiry from INV-02) and the cross-module cycle check

Status: CODE_PUSHED on branch `claude/inv-01-stock-ledger` (stacked on CAT-02, which is stacked on CAT-01). Pure and in memory: no storage, no UI, no network, not wired. **Not accepted, not integrated, not deployed.**

## What exists (`worker/inventory/stock-ledger.js`)
- Append-only, frozen **movements** (`receive`, `sale`, `sale_return`, `adjust`) with `seq`, lot, expiry, signed whole-unit `qty`, `unitCostCents`, `ref`, `actor`, `idempotencyKey`. There is no setter and no update/delete API: **balances are always derived** (`balance`, per lot, with expired stock reported separately).
- **FEFO sale**: earliest expiry first across lots, all-or-nothing, never uses expired stock (the expiry date itself is still sellable; the next day it is not); reports `available` and `expiredOnHand` when short. The last unit can be sold once.
- **Returns**: back to the same lot, capped per invoice and lot at what was sold minus what was already returned (repeat returns count), atomic across lines, reason required.
- **Adjustments**: reason (5+ chars) and a **different** approver required, never below zero, only on an existing lot (expired stock leaves only through an approved write-off).
- **Receipts**: a lot's expiry and cost cannot silently change (`lot-conflict`); already expired stock is refused.
- **Idempotency**: same key + same payload replays the first result (`replayed: true`) without a new movement; same key + different payload is `idempotency-conflict`; failures do not burn the key.
- `shortages(policy)` (expired stock does not count; suggestion up to the target), `expiring(days)`, `cogs(invoiceId)` (lots sold minus returned, at lot cost), `verify()` / `verifyMovements()` (sequence, signs, lot consistency, negative lots, over-returns, cost drift).

## Cross-module cycle check (`tests/unit/erp-cycle.check.mjs`)
Real export (4378 rows) -> CAT-01 product -> CAT-02 packaging, units and exact money -> receipt -> sale of 2 strips + 3 tablets (split lines add up to the one-line price) -> stock deducted -> retried sale does not deduct twice -> 1 strip returned (refund within one cent of the charge) -> more sales -> shortage with a suggestion rounded up to whole boxes -> purchase receipt -> FEFO uses the older lot first -> invariants hold -> expired lots are blocked. 9 steps, all green.

## Limits found while building it (decisions for CAT-03 / FIN / FND-02, not made here)
1. **Cost per base unit must be whole cents.** A box costing 96.50 over 24 tablets is not a whole number of cents per tablet. A finer cost unit (or lot-level total cost with an allocation rule) is needed before real costing; the ledger refuses fractional cents instead of rounding silently.
2. **Packaging is not on the catalog product** (no data source: the export has only `units` stock). The cycle test declares it explicitly.
3. **No reservation or real concurrency** (INV-03): operations are synchronous in one process; two writers need the storage layer's transactions (FND-02).
4. No locations, counts (INV-04), branch transfers (INV-05), batch recall, or per-branch balances yet; no persistence.
5. POS invoice documents and payments (POS-02/04), PO/GRN matching (BUY-05) are not built; the cycle test only chains the pure modules.
6. Return of expired stock goes back into an expired lot (not sellable); quarantine/disposal flow is not modelled.

## Run
`node --no-warnings tests/unit/inventory-stock-ledger.check.mjs` (20 cases) and `node --no-warnings tests/unit/erp-cycle.check.mjs` (9 steps). 21 mutations of the safeguards were each caught by these tests (two survived at first and got tests).
