# SEC-05: System Hardening, Rate Limiting & Secrets Protection

**Status:** APPROVED SPECIFICATION  
**Track:** SEC (Security & Access Control)  
**Task ID:** SEC-05  
**Dependencies:** FND-04, SEC-01, SEC-03, SEC-04  

---

## 1. Overview & Objectives

**SEC-05** defines the edge and runtime hardening controls for NOVA Rx ERP across Cloudflare Workers and POS clients, covering:
1. **Tiered Rate Limiting:** Protecting authentication, PIN recovery, POS mutations, and supplier integrations against brute-force and flooding attacks.
2. **HTTP Security Headers (CSP, HSTS, CSRF, Frame Protection):** Mitigating XSS, clickjacking, MIME-sniffing, and cross-site request forgery.
3. **Secrets Hygiene & Zero-Leak Guardrails:** Ensuring API keys, supplier credentials, and JWT signing keys never leak into client responses, error payloads, or logs.

---

## 2. Tiered Rate Limiting Policy

Rate limits are evaluated using a sliding-window counter scoped by composite keys (`ip`, `tenantId`, `userId`, or `deviceId`):

| Tier | Target Endpoints | Partition Key | Limit / Window | Block Duration | HTTP Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `AUTH_PIN` | `POST /api/v1/auth/pin`, `/api/v1/auth/login` | `ip + deviceId + userId` | 5 attempts / 5 min | 15 min lockout | `429 Too Many Requests` |
| `TOKEN_REFRESH` | `POST /api/v1/auth/refresh` | `deviceId + tenantId` | 20 requests / 5 min | 5 min cooldown | `429 Too Many Requests` |
| `POS_MUTATION` | `POST /api/v1/invoices`, `/api/v1/stock-movements` | `tenantId + branchId + userId` | 120 requests / 1 min | 1 min throttle | `429 Too Many Requests` |
| `REPORT_EXPORT` | `GET /api/v1/reports/export`, `/api/v1/audit/export` | `tenantId + userId` | 10 requests / 10 min | 10 min cooldown | `429 Too Many Requests` |
| `PUBLIC_WEBHOOK` | `/api/v1/webhooks/*` | `ip + provider` | 60 requests / 1 min | 5 min throttle | `429 Too Many Requests` |

All `429` responses include standard headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) and emit a `SEC-04` security audit event.

---

## 3. Mandatory HTTP Security Headers & CSRF Policy

Every Worker HTTP response injects the following hardened headers:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`

### CSRF & Origin Verification
- State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an allowed `Origin` header matching the tenant's configured origin whitelist AND either a valid `Authorization: Bearer <jwt>` header or a matching double-submit `X-CSRF-Token`.

---

## 4. Secrets Management & Leak Prevention

1. **Runtime Environment Isolation:** Secrets (`JWT_PRIVATE_KEY`, `SUPPLIER_API_SECRET`, `DB_URL`) are injected exclusively via Worker `env` bindings (`wrangler secret put`)—never hardcoded in repository files or committed to `.env`.
2. **Outbound Payload Secret Scanner:** Error responses (RFC-7807) and diagnostic payloads pass through a secret pattern detector (`scrubInlineSecrets`) that strips bearer tokens, private keys (`-----BEGIN`), connection strings (`postgres://`), and environment secret values before serialization.
