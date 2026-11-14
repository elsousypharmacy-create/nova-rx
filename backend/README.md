# NOVA Rx backend (Cloudflare Worker)

ES modules, no npm dependencies. Skeleton only (N90): tiny router, `GET /api/v1/health`, `GET /api/v1/version`.

- Error envelope: `{ ok:false, code, message_ar, requestId }` (Arabic message, stable code). `X-Request-Id` header on every response.
- CORS: allow-list from env `CORS_ALLOW_ORIGINS` (comma separated); unlisted origins get no CORS headers.
- `wrangler.toml`: placeholder ids only for dev/production (bindings `DB`, `KV`; staging ids are real). R2 is not bound (card required; owner declined). Backups: D1 Time Travel + encrypted GitHub artifact (`docs/ops/backup-restore.md`). Do not deploy or create resources without owner approval.
- The client uses this backend only behind a feature flag that defaults OFF; any backend error falls back to local mode.
- Tests: `node tests/unit/backend-router.check.mjs` (no network).

## Auth (SEC-01)
`/api/v1/auth/login|logout|refresh|reauth` — flag `NOVA_AUTH=1`, defaults OFF (404 `AUTH_DISABLED` otherwise). KV-stored hashed sessions, PBKDF2-SHA256 passwords, owner bootstrap via `NOVA_API_PIN` only while no owner exists.

## WhatsApp bot bridge (pharmacy bot <-> NOVA Rx)
All flags default OFF; with them off nothing changes.
- `POST /api/v1/webhooks/whatsapp-bridge` — bot forwards messages `{source,v,messages:[…]}` with `Authorization: Bearer <NOVA_WA_BRIDGE_TOKEN>`. Flag `NOVA_WA_BRIDGE_INTAKE=1` (404 `WA_INTAKE_DISABLED` otherwise). Token >= 32 chars, constant-time compare. `direction:'in'` items are queued (dedup by message id) in the same queue as the Meta webhook; `'out'` and unrepresentable items (no text, not image/document) are counted in `skipped`. Returns `{ok,queued,duplicates,skipped}`.
- The queue is drained by the existing processor only when `NOVA_WA_INTAKE=1`, and the tenant is resolved from the non-secret config `WA_TENANT_MAP` (`{"<phone_number_id>":"<tenantId>"}`); an unmapped `phone_number_id` ends dead-lettered.
- `GET|POST /api/v1/whatsapp/auto-reply` — session-authenticated, behind `NOVA_INBOX=1` (+ `DB`, `KV`). Proxies Apps Script `novaWhatsAppBridge` `autoReplyGet` / `autoReplySet {enabled}` using `WA_BACKEND_URL` + `NOVA_WA_BRIDGE_TOKEN`; 503 `WA_AUTOREPLY_NOT_CONFIGURED` (Arabic) when either is missing/short.
- Flags: `NOVA_WA_BRIDGE_INTAKE`, `NOVA_WA_INTAKE`, `NOVA_INBOX`. Config: `WA_TENANT_MAP`. Secrets (names only): `NOVA_WA_BRIDGE_TOKEN`, `WA_BACKEND_URL`.
- Tests: `node tests/unit/backend-whatsapp-bridge.check.mjs` (no network; fetch is injected as `env.NOVA_FETCH`).
