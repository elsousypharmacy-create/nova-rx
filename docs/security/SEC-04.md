# SEC-04 — audit log core (code, PROPOSED, not accepted)

Roadmap SEC-04, issue #87. Pure module `worker/security/audit-log.js` + `tests/unit/audit-log.check.mjs`. It is **not wired** to the Worker, storage or any route.

## What it does
- `canonicalJson`: deterministic bytes; refuses undefined, NaN/Infinity, bigint, Date/Map/class instances, depth > 32.
- `maskSensitiveFields` / `scrubInlineSecrets`: redacts secret keys at any depth (case/separator-insensitive: `Authorization`, `X-Api-Key`, `refresh_token`, `PIN`...), keeps the last 4 of phone / national id, scrubs Bearer tokens, JWTs, private keys, URLs with credentials and `password=...` in free text. Returns a new object.
- `prepareEvent`: validates the event (tenant/branch id charset without `:`, action, category, outcome, requestId, actor, resource, ISO timestamp). The raw IP is replaced by a keyed 16-hex hash.
- Chain: per tenant, `seq` from 1, `prevHash`, `entryHash = HMAC-SHA256(key, canonicalJson(entry without entryHash))`. Entries are frozen.
- `appendAuditEvent` + store contract (`head`, `append` with compare-and-swap, `list`; no update/delete). A stale head is refused and retried, so concurrent writers give one linear chain.
- `verifyAuditChain` detects edit, delete, reorder, duplicate, splice from another tenant, wrong key, and (with `expectedHead`) truncation.

## Limits (read before relying on it)
1. It does not make storage append-only. The real store (FND-02, undecided) must enforce no UPDATE/DELETE and atomic compare-and-swap (a Durable Object or a DB transaction).
2. The HMAC key must be a Worker secret outside the audit storage. Whoever has the key can forge a chain. Rotation = start a new chain epoch (not implemented).
3. Truncating the newest entries is only detected against an `expectedHead` stored elsewhere (for example a daily anchor).
4. Redaction is by key name and string pattern: defence in depth. Log fewer fields; keep customer and prescription data out of `changes`.
5. Retention (2–7 years in the draft spec) is a legal/owner decision and needs a partition/expiry procedure; not decided here.
6. No tenant-claim exists in the running Worker yet (it uses one shared PIN header), so nothing here is enforced anywhere.

## Run
`node --no-warnings tests/unit/audit-log.check.mjs` → `PASS audit-log unit checks (SEC-04): 18 cases`.
Safeguards were mutation-tested (18 deliberate breakages, all caught).
