# DATA-MAP — local module → future table owner (FND-01/02)

Today every module is pure logic with injectable storage (localStorage/IndexedDB). Future: D1 tables owned by one Worker module each; the browser keeps local storage as the source when the backend flag is OFF. "Write path" = how data reaches D1; "Read path" = how clients read it. All writes idempotent and append-only where noted. Table names are proposals.

| Local module | Future tables (owner module) | Write path | Read path |
|---|---|---|---|
| `offline-outbox.js` | `outbox_inbox` (idempotency key = invoice id, status pending/synced/review/resolved), `sync_conflicts` (price/balance/lot) — `backend/sync` | Client outbox POSTs batches to `/sync`; server upserts by idempotency key inside one `batch()`; never deletes | `GET /sync/status`, conflicts list for review screen |
| `stock-ledger.js` | `stock_movements` (append-only; kind sale/return/receive/adjustment), `stock_on_hand` (derived snapshot, rebuildable) — `backend/inventory` | Sync of sale/return/receive movements; adjustment needs reason+approver | On-hand derived from movements/snapshot; paginated movement history |
| `journal-ledger.js` | `journal_entries` (id `<type>:<event id>` UNIQUE), `journal_lines` (integer piastres, debits=credits check in code) — `backend/finance` | Posted in same `batch()` as the originating business event; reversal = mirror entry | Trial balance / reports endpoints (read-only) |
| `credit-ledger.js` | `credit_movements` (opening/charge/collection/reversal, append-only), `credit_limits` — `backend/finance` | Charge idempotent on sale id; collection FIFO computed server-side | Customer balance + aging endpoints |
| `customer-directory.js` | `customers`, `customer_consents` (append-only history), `customer_merges` (immutable audit) — `backend/crm` | Upsert by normalized phone; merge only after review; consent changes append | Permission-gated statements (deny by default, access logged) |
| `purchase-orders.js` | `purchase_orders`, `po_lines`, `grn_receipts` (lot/expiry/cost) — `backend/purchasing` | State change only with `confirmed:true`; receiving writes `stock_movements(receive)` in same batch | PO list/detail; no supplier contact from this table |
| `auth-local.js` | `users` (salted password hash, role), `devices` (trusted), sessions in **KV** — `backend/auth` | Account changes need fresh re-auth; legacy owner bootstrap via `NOVA_API_PIN` | Session lookup in KV; roles from `users` |
| `audit-local.js` | `audit_log` (seq, hash chain, financial rows undeletable) — `backend/audit` | Appended on every server write; PII/secrets redacted before storage | Owner-only filtered read; chain verification endpoint |
| `auth-permissions.js` | role/permission matrix (code, not data) | — | Enforced in Worker middleware |
| `finance-shifts.js`, `finance-coa.js` | `shifts`, `chart_of_accounts` — `backend/finance` | Shift open/close with cash count, append-only | Shift reports |
| `supplier-accounts.js`, `supplier-lookup.js`, `supplier-provider.js` | `suppliers`, `supplier_operations` (fail-closed state) — `backend/procurement` | Connectors server-side only (AUMET_*/PO_*), mock adapter until owner enables | Read-only lookup; real cart/order writes owner-only |
| `purchases*.js`, `stock-count.js` | `purchase_drafts`, `stock_counts` | Via same sync path | Review screens |
| `backup-schedule.js` | Local encrypted sales snapshots (IndexedDB / files) | Client-side schedule (OFF-04) | Owner restore drill (`docs/OFF-04_BACKUP_DRILL.md`) |
| Staging D1 (`nova-rx-staging`) | D1 Time Travel bookmarks (30 days) + encrypted GitHub Actions SQL artifact (30 days) | Daily workflow `d1-backup-staging.yml`; bookmark recorded before migrate | `docs/ops/backup-restore.md` (new DB only for artifact import; Time Travel restore is owner-approved in-place) |
| Sessions, rate limits, flags | **KV** (`sess:*`, `rl:*`, `flag:*`) | Worker only | Worker only |

Not mapped yet (later phases): BI modules, clinical/Rx modules, messaging (`msg-policy.js`, `unified-inbox.js`), loyalty, attendance — each gets an entry when its backend task starts.
