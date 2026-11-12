# FIN-02 — Double-entry journal (local, frontend only)

Module: `journal-ledger.js` (`window.NovaJournal` / Node `createJournal`). Not wired to a screen yet; backend untouched (frozen).

## What it does
Each local event posts one balanced entry (debits = credits, integer piastres). Entry id = `<type>:<event id>`, so re-posting the same sale/purchase/etc. returns the stored entry (idempotent).

| Event | Debit | Credit |
|---|---|---|
| sale | cash, bank (card), AR (credit), COGS | sales revenue, inventory (cogs) |
| purchase | inventory | cash (paid), AP (rest) |
| return | sales returns, inventory (cogs) | cash, AR, COGS |
| collection | cash or bank | AR |
| expense | expense | cash (paid), AP (rest) |
| revaluation | inventory / revaluation account | revaluation account / inventory |

Nothing is deleted or edited: `reverse(entryId, reason)` posts the mirror entry (idempotent; a reversal cannot be reversed — post the event again). `verify()` and `trialBalance()` are read-only integrity checks.

## Costing rule (single, consistent)
**Moving weighted average cost per product.** On receipt: `newAvg = (qtyOnHand × avg + qtyIn × costIn) / (qtyOnHand + qtyIn)` (`weightedAverage()`, 4 decimals). Sales and returns are costed at the *current average at the time of the event*; the caller passes that as `cogs` (qty × avg). A return is costed at the original sale's cogs, not today's average. Purchases post at invoice cost.

## Revaluation gate
Changing stock value outside normal receipts (`revalue`) requires a non-empty `reason` AND `approvedBy`; otherwise it throws (`reason-required` / `revaluation-not-approved`). It posts its own visible entry; past entries are never rewritten. `approvedBy` is a name, not an authenticated approval (SEC wiring is later).

## Not covered
No screen wiring, no tax/VAT, no multi-currency, no period close/lock, no auto-link to `novaSales`/`credit-ledger` (callers post per event; reconciliation against those ledgers is a follow-up). JS-number input, validated to whole piastres.
