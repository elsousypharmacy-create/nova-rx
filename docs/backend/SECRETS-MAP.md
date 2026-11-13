# SECRETS-MAP — secret NAMES only (never values)

All secrets are Worker env bindings or GitHub secrets set by the owner. Never print, log, or commit values. The browser never receives any of these.

| Name | Purpose | Where used | Flag / status |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy / migrations (CI or owner machine) | Deploy tooling only, not runtime | Owner-set; no agent deploys |
| `NOVA_API_PIN` | Legacy owner bootstrap login before individual accounts | Worker `auth` | Legacy; remove after accounts exist |
| `NOVA_INGEST_SECRET` | HMAC signature for signed ingest and webhooks; also the passphrase that encrypts daily D1 export artifacts (`docs/ops/backup-restore.md`) | Worker `ingest`; GitHub Actions `d1-backup-staging.yml` | Required before ingest flag ON, and for encrypted backups |
| `KIMI_MODEL_API_KEY` | Optional AI model (paid) | Worker `ai` adapter | Flag OFF; mock in tests |
| `AUMET_*` | Supplier connector credentials | Worker `procurement`, server-side only | Mock adapter; flag OFF |
| `PO_*` | Purchase-order supplier connector credentials | Worker `procurement`, server-side only | Mock adapter; flag OFF |

Rules: bindings referenced as `env.NAME`; tests use mock values injected in-process; audit redaction strips matching keys (see `audit-local.js`).
