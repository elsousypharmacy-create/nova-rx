# FND-02 — local invariant harness (read-only options; NO storage decision)

Roadmap FND-02, issue #87, ADR draft `FND-02_STORAGE_ADR_DRAFT.md` §4. This is the **local, free part** of the measurement plan. The ADR stays `PROPOSED`; nothing here chooses D1, Postgres or anything else, and nothing here needs an account, a network call, a secret or live data.

## What it runs
`node --no-warnings tests/bench/fnd02-ledger-sqlite.mjs` (Node 22, `node:sqlite`, in-memory plus a temp file for the multi-connection case).
It builds the ADR §4 mini-schema (`invoice`, `invoice_line`, `payment`, `batch`, `stock_balance`, append-only `stock_movement`, `return_line`, `journal_entry/line`, `idempotency_key`) with money in integer piastres and quantities in whole base units, and one transactional write (`sell`) that does: idempotency check → FEFO batch allocation → invoice + lines + payments → movements + balances → balanced journal → idempotency record, all in one `BEGIN IMMEDIATE` transaction.

## What it proves (12 cases)
FEFO order and expired stock never sold; oversell refused with nothing left behind; payments must equal the document; same idempotency key returns the same invoice once, a different payload is refused, duplicate invoice number refused; a crash injected after the movements or after the journal rolls back **every** table and the retry succeeds; `stock_movement` refuses UPDATE and DELETE; returns restore stock, post a balanced entry and cannot exceed what was sold; the schema itself refuses bad rows (CHECK, FOREIGN KEY); the invariant checker detects tampering; 1000 sequential invoices keep all invariants; 5 connections × 40 sells on 150 units sell exactly 150 and reject 50, none oversold.
The harness was mutation-checked: 15 deliberate breakages (no idempotency, no payload hash, expired sellable, LIFO, no payment check, no rollback, deferred `BEGIN`, no `on_hand` CHECK, update allowed, delete allowed, no return trigger, balance not updated, journal debit missing, no line-total CHECK, invoice number not unique) are each caught.

## Numbers it printed (this sandbox, SQLite in memory — NOT evidence about D1 or Postgres)
1000 sequential invoices: p50 ≈ 0.15 ms, p95 ≈ 0.3 ms, p99 ≈ 0.4–0.6 ms per invoice (varies per run). 5 writers on a temp file: 200 attempts, 150 sold, 50 rejected for stock, 0 busy retries (the 5 s `busy_timeout` absorbed the waits). These only show that the logic and the single-writer lock discipline are sound.

## What it does NOT prove (still unmeasured, needs owner-approved trial accounts)
Cloudflare D1: request latency, `batch()` atomicity limits and size caps, behaviour of interactive transactions from a Worker, cost. Postgres via Hyperdrive: p95 from Cairo/Riyadh, connection limits, RLS, point-in-time restore. Restore drills (RPO/RTO). Real data volume (ADR §9 question 3). Cross-region behaviour. Offline sync conflicts. Multi-tenant RLS. **No recommendation follows from this file**; the ADR weights and the owner's answers to ADR §9 are still required.

## How a real measurement would reuse it
The invariant list (`checkInvariants`) and the scenarios (idempotent replay, injected failure, concurrent writers) are written against plain SQL and a small `sell`/`returnLine` API, so the same scenarios can be pointed at a D1 or Postgres adapter later; only the connection and transaction primitives change.

## Known simplifications
One account pair (`cash`/`receivable` vs `sales`), no tax, no COGS, no partial payment of credit sales, no version column conflict test (`invoice.version` exists but is not exercised), no tenant isolation tests (SEC-03 owns that), `date('now')` for expiry. These are scope limits, not design decisions.
