# Environments and release record (FND-05)

## Separation
| Env | Worker | D1 / KV / R2 | Purpose |
|---|---|---|---|
| dev | `nova-rx-api` (local `wrangler dev`) | `nova-rx-dev` | local work, no real data |
| staging | `nova-rx-api-staging` | `nova-rx-staging` | pre-release verification |
| production | `nova-rx-api` | `nova-rx-production` | live; owner-approved deploys only |

Each environment has its own bindings in `backend/wrangler.toml` (placeholder ids only until the owner creates resources). Secrets are referenced by NAME only (see `SECRETS-MAP.md`); never share secrets between environments. `NOVA_ENV` selects the environment; `BUILD_SHA` carries the build sha (see `backend/src/version.js`, exposed at `GET /api/v1/version`).

## Migrations
- Files `backend/migrations/NNNN_name.sql`, numbered from 0001, no gaps or duplicates.
- Additive only: no DROP / TRUNCATE / DELETE FROM. Destructive changes need owner approval.
- Lint: `node tools/backend/check-migrations.mjs`.
- Apply order: dev -> staging -> production, never skipping.

## Deploy record
`docs/backend/releases.json` holds `live` ({version, sha, env, at}) and `history`. Before any deploy run:
`node tools/backend/stale-artifact-guard.mjs <version>` — it refuses a version older than the recorded live one. After a deploy (owner-approved), update the record in a reviewed PR.

## Rollback
1. Redeploy the previous entry from `history` (the guard must be bypassed explicitly by the owner, since it is older).
2. Migrations are additive, so the old Worker keeps working against the newer schema; no schema rollback.
3. Record the rollback in `history` with reason.
4. The client feature flag defaults OFF; turning it off returns the app to local mode instantly.
