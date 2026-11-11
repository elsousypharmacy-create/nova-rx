# SEC-03: Tenant and branch isolation

**Status: PROPOSED** (the first draft said "APPROVED SPECIFICATION"; nobody approved it). Task SEC-03. Depends on FND-03, SEC-01, SEC-02.
Implemented as a pure module, **not wired**: `worker/security/tenant-scope.js`, tests `tests/unit/security-tenant-scope.check.mjs` (23 cases on a real in-memory SQLite with two tenants; the safeguard mutations are each caught).
Revised by Claude 1 after Claude 2's security-gate findings (Issue #87, comment 6786485245). The first draft stays in the history of branch `gemini/sec-03-04-05-foundation`.

## 1. Reality check
The live Worker authenticates with one shared PIN and has no tenant concept; there is no `worker/security/sec-foundation.js` and no `/api/v1/...`. This document and module describe the isolation layer for the future session and storage design (SEC-01, FND-02). The storage engine is **undecided**.

## 2. Context (`createIsolationContext`)
Built only from claims already verified by SEC-01: `actorId`, `tenantId`, `roles`, `tenantBranchIds` (**the branches that belong to this tenant**, required), `assignedBranchIds`, `activeBranchId`. Every branch a context can name must be in `tenantBranchIds`, Owner included: a tenant-wide role is wide inside its tenant, never across tenants (`activeBranch-not-in-tenant`, `assignedBranch-not-in-tenant`; a branch added after login needs a session refresh). Ids match `^[A-Za-z0-9_-]{1,64}$` (no `:`). Roles come from SEC-02 only: `Owner`, `Pharmacist`, `Cashier`, `InventoryManager`. **`Auditor` (used by the first draft) is not defined in SEC-02 and is refused until SEC-02 defines it.** `isTenantWide` is derived from the role (`Owner`) and is **refused as input**. A user who is not tenant-wide must have an assigned active branch; a missing branch list never widens access. The context is frozen and branded: the repository accepts only contexts built by this function, never a hand-made object.

## 3. Request scope (`checkRequestScope`)
Any tenant or branch the client names (headers `X-Tenant-Id`/`X-Branch-Id`, query, params, body, nested, arrays, any case or separator) must equal the verified context: `403 SEC_TENANT_MISMATCH`, `403 SEC_BRANCH_FORBIDDEN`. Non-array, non-string or object values (`{"$ne":..}`) are mismatches. A non-wide user may name only an assigned branch; an Owner may name any branch id of its own tenant (the repository still filters by tenant). The resolved branch is returned; nothing is trusted from the request beyond that. **The scan fails closed**: nesting deeper than 6 levels (or a cyclic object) returns `400 request-too-deep` instead of ignoring what lies below. Only `tenantId`/`branchId` (any case or separator) and `X-Tenant-Id`/`X-Branch-Id` are recognised names; other spellings (`org_id`, `tenant`) are not. An Owner may name only branches in its own tenant's `tenantBranchIds`.

## 4. Scoped repository (`createScopedRepository`)
The only way to reach operational tables. Each table is declared in a schema (`columns`, `branchScoped`); names are plain identifiers and `tenant_id`/`branch_id` are reserved.
- Every statement filters `tenant_id = ?` (and `branch_id = ?` for branch-scoped tables unless the context is tenant-wide and no branch is chosen). Values are parameters; identifiers come from the schema allowlist, never from the caller.
- `tenant_id` and `branch_id` in `where`, `row` or `patch` are refused (`scope-field-not-allowed`). Inserts are stamped from the context. This is the equivalent of PostgreSQL `WITH CHECK`.
- `update` and `delete` require a `where`. There is no raw SQL method.
- **A row of another tenant looks exactly like a missing row** (`not-found`), so existence is not leaked (the first draft's `403` would reveal it).
- `looksTenantScoped(sql)` is an **advisory heuristic** (renamed from `isTenantScoped`): it requires `tenant_id = ?` and refuses OR, comments, UNION and extra statements, but a regex cannot prove isolation. **Do not use it in CI as proof;** the barrier is the repository, which never accepts caller SQL.
- `validateTransfer`: role `Owner` or `InventoryManager`; both branches must be in the tenant's branch list and exist in a **tenant-only** `branches` table (`repo.describe('branches')` is checked; a branch-scoped table returns `branches-table-must-be-tenant-only` instead of a misleading denial), else `SEC_CROSS_TENANT_TRANSFER_DENIED`; the source must be an assigned branch unless tenant-wide.
- `scopedKey(ctx, kind, clientKey)` -> `t:{tenant}:b:{branch|*}:{idem|cache|queue}:{encodeURIComponent(clientKey)}`: ids cannot contain `:` and the client part is encoded, so two tuples cannot produce the same key. The encoded client part is capped at 256 characters so the whole key stays under the 512 byte KV limit.

## 5. Storage contract (when FND-02 decides)
- **Cloudflare D1 (SQLite) has no row level security.** The wrapper is the only barrier there; add the lint gate and a test that every statement touching an operational table is scoped.
- **PostgreSQL**, if chosen: per-request context must be `SET LOCAL app.current_tenant_id = ...` **inside the transaction** (never session level; a pooled connection such as Hyperdrive would leak tenant A's context into tenant B's next request); `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and `FORCE ROW LEVEL SECURITY`** (the table owner bypasses RLS otherwise); a non-superuser application role; policies on **every** operational table with `USING` and `WITH CHECK`.

## 6. Role scope (from SEC-02, unchanged)
| Role | Branches | Cross-branch |
|---|---|---|
| Owner | all branches of its tenant | read and write inside the tenant |
| Pharmacist, Cashier | assigned branch(es) | none |
| InventoryManager | assigned branch(es) | only the two-step transfer, validated by `validateTransfer` |
Undefined in the first draft and still open (owner/SEC-02): the "controlled stock lookup when explicitly enabled" for pharmacists, and an Auditor role.

## 7. Not covered
Wiring, D1/PostgreSQL adapters, session and JWT verification (SEC-01), audit events for denials (SEC-04 hook, with rate limiting so denials cannot flood the log), rate limits/CSP/HSTS (SEC-05).
