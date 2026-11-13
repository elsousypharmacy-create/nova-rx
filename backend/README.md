# NOVA Rx backend (Cloudflare Worker)

ES modules, no npm dependencies. Skeleton only (N90): tiny router, `GET /api/v1/health`, `GET /api/v1/version`.

- Error envelope: `{ ok:false, code, message_ar, requestId }` (Arabic message, stable code). `X-Request-Id` header on every response.
- CORS: allow-list from env `CORS_ALLOW_ORIGINS` (comma separated); unlisted origins get no CORS headers.
- `wrangler.toml`: placeholder ids only for dev/production (bindings `DB`, `KV`; staging ids are real). R2 is not bound (card required; owner declined). Backups: D1 Time Travel + encrypted GitHub artifact (`docs/ops/backup-restore.md`). Do not deploy or create resources without owner approval.
- The client uses this backend only behind a feature flag that defaults OFF; any backend error falls back to local mode.
- Tests: `node tests/unit/backend-router.check.mjs` (no network).

## Auth (SEC-01)
`/api/v1/auth/login|logout|refresh|reauth` — flag `NOVA_AUTH=1`, defaults OFF (404 `AUTH_DISABLED` otherwise). KV-stored hashed sessions, PBKDF2-SHA256 passwords, owner bootstrap via `NOVA_API_PIN` only while no owner exists.
