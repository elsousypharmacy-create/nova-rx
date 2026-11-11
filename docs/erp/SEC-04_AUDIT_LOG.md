# SEC-04: Security and operational audit log

**Status: PROPOSED** (was labelled "APPROVED SPECIFICATION" by its first author; nobody approved it). Task SEC-04. Depends on FND-03, SEC-01, SEC-02, SEC-03.
Implemented as a pure module, **not wired** into the Worker: `worker/security/audit-log.js`, tests `tests/unit/security-audit-log.check.mjs` (21 cases, 14 safeguard mutations each caught).
Revised by Claude 1 after Claude 2's security-gate findings (Issue #87, comment 6786485245). The first draft is preserved in the history of branch `gemini/sec-03-04-05-foundation`.

## 1. Event (built only from an allowlist; unknown input fields are dropped)
`tenantId`, `branchId` (or null), `actor{userId, roles[], deviceId?, ipAddress?}`, `action` (`invoice.void`), `category`, `outcome` (`ALLOWED|DENIED|FAILED`), `resource{type,id}`, `statusCode?`, `requestId` (required), `timestamp` (UTC ISO, set by the server clock only; a caller-supplied timestamp is refused), `changedFields[]`, `changes?{before,after}`, `metadata{}`. Chain fields added on append: `seq`, `prevHash`, `entryHash`.
Categories: `AUTH_SESSION`, `ACCESS_CONTROL`, `FINANCIAL_LEDGER`, `INVENTORY_SENSITIVE`, `SYSTEM_CONFIG`, `CLINICAL_CONTROLLED` (the first draft's own example used this one without listing it).
Ids (`tenantId`, `branchId`, `userId`, `deviceId`, `requestId`) match `^[A-Za-z0-9_-]{1,64}$`; a separator such as `:` is refused so keys built from them cannot collide.

## 2. Privacy
- Secrets are redacted by key name: any key CONTAINING `secret, password, passwd, token, credential, privatekey, apikey, cookie, authorization, session, signature, jwt` (any case, any separator), and short names `pin/otp/cvv/cvc` exactly or with `code/number/hash/value/digits` (so `shipping` and `spinach` are kept). Over-redaction is the safe direction and inside free text (bearer tokens, JWTs, PEM private keys, URL credentials, `key=value`). Prototype keys (`__proto__`, `constructor`, `prototype`) are dropped.
- `phone`, `mobile`, `nationalId` keep only the last 4 characters. `ipAddress` is stored masked (IPv4 `a.b.c.0`, IPv4-mapped IPv6 as IPv4, IPv6 first 3 groups); an unusual format drops the IP but keeps the event.
- `changes`: the log always records WHICH fields changed (`changedFields`). Values are stored only for fields explicitly allowlisted for that resource type, and still masked. Customer and prescription data never enter the log by default.
- A key-name denylist cannot catch everything; the allowlist for `changes` and `metadata` size cap (4 KB) are the real controls.

## 3. Tamper evidence
- `canonicalJson`: keys sorted by UTF-16 code unit, strings and keys emitted exactly as stored (no normalisation inside the hash: different bytes never hash the same; text is normalised to NFC once when the event is built, and keys that collide after NFC are refused), finite numbers, depth capped at 64, no `undefined`, dates, maps, functions or cycles (they throw instead of hashing something unreproducible). Hash input is the record without `entryHash`, with `seq` and `prevHash` included.
- `entryHash` = hex HMAC-SHA-256 over that canonical JSON. **The key must live outside the database** (a Worker secret, name to be decided by the owner; never committed, never logged). A plain SHA-256 chain is not enough: anyone who can edit the table could recompute it. Tested: a forged plain-SHA chain fails verification.
- Per-tenant `seq` starting at 1 and `prevHash` (genesis = 64 zeros). `verifyAuditChain` reports the first bad index and one of `entry-invalid`, `tenant-mismatch`, `seq-gap`, `prev-hash-mismatch`, `hash-mismatch`. A deleted, duplicated, reordered or dropped-head entry is a `seq-gap`.
- **Single writer per tenant.** `appendAuditEvent` is pure and returns a new state; two writers holding the same state would fork the chain. `expectedSeq` is **required** (`expectedSeq-required` otherwise) and a stale value fails with `chain-fork`, but the pure function cannot see the store: the storage layer must serialise appends (a Durable Object per tenant or an equivalent compare-and-swap on the head). Claude 2's branch `claude/sec-04-audit-log` has a tested in-memory compare-and-swap contract that can be lifted when storage is chosen. Choosing the mechanism depends on FND-02 (undecided).
- Truncation at the tail is detected only against a stored head: `verifyAuditChain(..., {expectedHead:{seq,hash}})` returns `head-mismatch`.
- Rotation/retention: a truncated log verifies only against an anchor `{seq, hash}` of the last removed entry; keep the anchor with the archive. Periodic external anchoring of the head hash is recommended.

## 4. Open decisions (not made here)
1. HMAC key name, storage and rotation procedure (owner; no secret is created or changed by this change).
2. Retention periods. The first draft's 2/5/7 years were not sourced; this is a legal/owner decision. Append-only conflicts with expiry unless removal is a documented partition-drop with a new anchor.
3. Storage and the single-writer mechanism (FND-02).
4. Rate limiting and aggregation of denial events (a flood of denials must not become a log-flood DoS): SEC-05.
5. Whether `ipAddress` should be stored at all.

## 5. Not covered
Wiring into any request path, persistence, export, tenant isolation (SEC-03), CSP/HSTS and rate limits (SEC-05).

## 6. Known limits (review by Claude 2)
- The key denylist and free-text scrubber cannot catch every secret or personal datum (a note like `patient ... national id 2900...` passes); `changes` is allowlisted, `metadata` is only masked and capped at 4 KB. Prefer scalar codes in `metadata`.
- Free-text patterns covered: bearer tokens, JWT (also unsigned), PEM blocks, URL credentials (including `@` in the password), `key=value` (quoted values too), `sk-live-...`/`AKIA...` provider keys.
- Persistence, the single-writer mechanism and the HMAC key are not decided or implemented here.

