# NOVA Rx — Data retention policy (SEC-05)

| Data | Retention | Notes |
|---|---|---|
| Sales, returns, payments, journal entries | 10 years | Financial/tax record; never hard-deleted. |
| Inventory movements, batches | 10 years | Needed for pharmacy traceability. |
| Customers (contact data) | While active + 2 years | Anonymise on request; keep sale totals. |
| Audit logs | 5 years | Append-only. |
| Sessions / refresh tokens | Access 1 h, refresh 12 h, trusted device 30 d | KV TTL expiry; revoked on logout. |
| Rate-limit buckets | ≤ 1 h | KV TTL expiry. |
| Idempotency keys | 24 h | Replay window only. |
| Application logs | 30 days | Redacted: no passwords, tokens, cookies, card numbers. |
| D1 Time Travel bookmarks | 30 days | Built-in Cloudflare point-in-time restore window. |
| Encrypted D1 export artifacts | 30 days | GitHub Actions artifact; ciphertext only (repo is public). |

Export: owner only, `GET /api/v1/export`, requires recent re-authentication (5 min), rate-limited to 3/hour, secrets and hashes stripped.
Deletions are owner-approved and performed by an explicit, reviewed migration; nothing is auto-deleted from D1.
