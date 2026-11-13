# ADR-001 — Backend storage stack (FND-01/02)

Status: accepted with backup amendment (2026-11-13). Date: 2026-11-13. Owner approval for the *storage product* is owner-only (see NEEDS-OWNER.md); nothing here creates resources or deploys.

## Decision
Cloudflare Workers (ES modules, no npm deps) with:
- **D1** (SQLite, SQL) — system of record: ledgers, customers, POs, audit, users. Atomic multi-statement writes via `env.DB.batch([...])` (a batch is one implicit transaction).
- **KV** — sessions, rate-limit counters, feature flags (eventually consistent; never used for money/stock).
- **R2** — backups (nightly D1 export JSON/SQL) and private files (prescription images, attachments). Private bucket, access only through the Worker.

Rationale: matches the existing Worker deployment (`docs/DEPLOY_WORKER.md`), zero fixed cost on the free tier, SQL gives constraints/indices for append-only ledgers, and the local modules are already pure logic with injectable storage so they can be ported behind an adapter.

## Free-tier limits and when they bite (verify against current Cloudflare docs before relying on them)
| Service | Approx. free limit | When it bites |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU/request | Chatty sync (per-line calls); heavy JSON/hash work (audit chain) per request. Batch client sync. |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB total | Unindexed scans on stock/ledger tables burn reads; bulk catalog import burns writes. Always index, paginate, derive onHand from indexed sums or a maintained snapshot. |
| KV | 100k reads/day, 1k writes/day | Writing a rate-limit counter on every request exhausts writes fast; keep counters coarse, sessions long-lived. |
| R2 | 10 GB storage, 1M class-A / 10M class-B ops per month | Daily full backups of growing data; keep retention (e.g. 14 daily + 8 weekly). |
If limits bite, the fallback is the Workers Paid plan — a **spending decision, owner-only**. Until then everything stays behind flags, default OFF.

## Consistency rules
- Money in integer piastres; ledgers append-only (no UPDATE/DELETE on ledger tables); reversals are new rows.
- Idempotency key per write (invoice id / `<type>:<event id>`) as a UNIQUE column; replays return the stored row.
- Multi-table writes only through one `batch()`; never split a money/stock change across requests.
- Every error: Arabic message + stable `code` + `requestId`.

## Migration and rollback
- `backend/migrations/NNNN_name.sql`, numbered, applied in order, **additive only** (CREATE TABLE/INDEX, ADD COLUMN). No DROP/TRUNCATE/DELETE FROM (CI blocks them).
- A `schema_migrations(id, applied_at)` table records applied files; the runner is idempotent.
- Rollback = *forward-fix*: code is rolled back by redeploying the previous Worker version (old code ignores new columns/tables), data is never dropped. Destructive cleanup needs owner approval and a separate reviewed plan.
- Before any production migration: R2 backup export, then apply, then verify row counts. Production apply is owner-only.
- Feature flag (default OFF) gates the client; with it OFF the app is local/offline and makes zero calls to the backend; any backend error falls back to local mode.

## Rejected alternatives
Durable Objects as primary store (harder reporting/SQL); external Postgres/Supabase (new paid account, off-platform secrets); KV-only (no transactions).

## Amendment 2026-11-13 — backups without R2
R2 will not be enabled: the Cloudflare dashboard requires a payment card, and the owner declined. The R2 row above is retained as the rejected-for-now object-store option, not as the backup plan.
- **Backups:** D1 Time Travel (30-day point-in-time) plus a daily `wrangler d1 export` uploaded as an encrypted GitHub Actions artifact (30-day retention). See `docs/backend/BACKUP-RESTORE.md`.
- **Before any staging/production migration:** record a Time Travel bookmark, then apply, then verify. Do not take an R2 export.
- **Private files:** deferred or size-capped in D1 until a card-free object store exists. Do not add an R2 binding.
