# SEC-03: Tenant & Branch Isolation Architecture (Multi-Tenancy)

**Status:** APPROVED SPECIFICATION  
**Track:** SEC (Security & Access Control)  
**Task ID:** SEC-03  
**Dependencies:** FND-03, SEC-01, SEC-02  

---

## 1. Overview & Security Objective

NOVA Rx ERP operates as a multi-tenant, multi-branch pharmacy platform where each pharmacy organization (`tenantId`) may manage one or more physical branches (`branchId`). **SEC-03** enforces strict logical and cryptographic isolation across tenants and branches so that:

1. **Zero Cross-Tenant Data Leakage:** A user or token bound to `tenant_A` can never read, write, aggregate, or infer records belonging to `tenant_B` (`403 Forbidden` on any mismatch).
2. **Scoped Branch Isolation:** Operational roles (`Pharmacist`, `Cashier`, `InventoryManager`) are restricted to their assigned `branchId` claims unless executing an explicitly permitted cross-branch workflow (such as `Owner` tenant-wide analytics or authorized inter-branch stock transfers).
3. **Defense-in-Depth Enforcement:** Isolation is enforced simultaneously at three layers:
   - **Edge / API Gateway Guard (`worker/security/sec-foundation.js`):** Validates JWT claims (`tenant_id`, `branch_id`, `roles`) against request headers, URL parameters, and payload bodies before any handler executes.
   - **Storage Query / Row-Level Security (RLS) Boundary:** Every storage adapter query requires a mandatory `{ tenantId, branchId }` context envelope and injects deterministic filtering predicates (`WHERE tenant_id = ? AND branch_id = ?`).
   - **Cache & Idempotency Key Namespacing:** All KV/Redis/D1 cache and idempotency keys are prefixed with `t:{tenantId}:b:{branchId}:` to prevent cross-tenant cache poisoning or idempotency collisions.

---

## 2. Canonical Isolation Context Envelope

Every authenticated request produces an immutable `IsolationContext` derived exclusively from verified `SEC-01` session claims:

```json
{
  "actorId": "usr_901",
  "tenantId": "tenant_1001",
  "assignedBranchIds": ["branch_east_01"],
  "activeBranchId": "branch_east_01",
  "roles": ["Pharmacist"],
  "isTenantWide": false
}
```

### Rules of Trust
- **Never Trust Client Headers Alone:** If a client sends `X-Tenant-Id` or `X-Branch-Id` headers or body fields (`tenant_id`, `branch_id`), they must strictly match the authenticated JWT claims. Any mismatch between JWT `tenant_id` and requested `tenant_id` immediately triggers `403 Forbidden` with RFC-7807 error code `SEC_TENANT_MISMATCH` and logs a high-severity `SEC-04` security audit event.
- **Branch Switching:** A user assigned to multiple branches (or holding the `Owner` role) may specify a target `branch_id` only if `roles.includes('Owner')` within the same `tenant_id` or `assignedBranchIds.includes(targetBranchId)`. Otherwise, the guard returns `403 Forbidden` (`SEC_BRANCH_FORBIDDEN`).

---

## 3. Role-Based Branch Scope Matrix

| Role | Tenant Scope | Default Branch Scope | Cross-Branch Read | Cross-Branch Write / Transfer |
| :--- | :--- | :--- | :--- | :--- |
| `Owner` | Single `tenant_id` (strict) | All branches in `tenant_id` | Allowed within `tenant_id` | Allowed within `tenant_id` |
| `Pharmacist` | Single `tenant_id` (strict) | Assigned `branch_id` only | Denied (`403`) except controlled stock lookup when explicitly enabled | Denied (`403`) |
| `Cashier` | Single `tenant_id` (strict) | Assigned `branch_id` only | Denied (`403`) | Denied (`403`) |
| `InventoryManager` | Single `tenant_id` (strict) | Assigned `branch_id` only | Allowed for inter-branch transfer manifest preview within `tenant_id` | Allowed only via two-step inter-branch transfer (`source_branch_id` -> `dest_branch_id`) within same `tenant_id` |
| `Auditor` | Single `tenant_id` (strict) | Read-only across assigned branches or tenant | Read-only within `tenant_id` | Denied (`403`) |

---

## 4. Storage & Query Enforcement Contract

All database operations (Cloudflare D1 / PostgreSQL) must pass through the scoped repository wrapper:

1. **Mandatory Predicate Injection:** Queries touching operational tables (`invoices`, `batches`, `stock_movements`, `customers`, `shifts`, `journal_entries`, `purchase_orders`, `shortages`) must include `tenant_id = :ctxTenantId`.
2. **PostgreSQL RLS Policy Standard:**
   ```sql
   ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_branch_isolation_policy ON invoices
     USING (
       tenant_id = current_setting('app.current_tenant_id', true)
       AND (
         current_setting('app.is_tenant_wide', true) = 'true'
         OR branch_id = current_setting('app.current_branch_id', true)
       )
     );
   ```
3. **Inter-Branch Stock Transfers:**
   - Must validate that both `sourceBranchId` and `destinationBranchId` belong to `ctx.tenantId`.
   - If either branch belongs to a different tenant, reject with `403 Forbidden` (`SEC_CROSS_TENANT_TRANSFER_DENIED`).

---

## 5. Cache, Queue & Idempotency Isolation

- **Idempotency Keys (`FND-04`):** Stored and evaluated as `t:{tenantId}:b:{branchId}:idem:{clientKey}` so two tenants sending the same UUID or client key never collide or replay each other's responses.
- **Sync Outbox (`FND-03`):** Each outbox record carries `tenant_id` and `branch_id`; background workers process batches partitioned by `tenant_id`.
