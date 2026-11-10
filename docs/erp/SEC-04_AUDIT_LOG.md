# SEC-04: Immutable Security & Operational Audit Logging

**Status:** APPROVED SPECIFICATION  
**Track:** SEC (Security & Access Control)  
**Task ID:** SEC-04  
**Dependencies:** FND-03, SEC-01, SEC-02, SEC-03  

---

## 1. Overview & Objectives

**SEC-04** defines the immutable audit trail (`AuditEvent`) for NOVA Rx ERP. Every security-sensitive action, permission denial, authentication event, financial posting, inventory adjustment, and controlled substance dispensation is recorded in an append-only, tamper-evident log stream with automatic PII/secret masking.

---

## 2. Canonical `AuditEvent` Schema

Every audit record conforms to the following deterministic JSON structure:

```json
{
  "eventId": "aud_01J9Z8K4M2N3P4Q5R6S7T8U9V0",
  "timestamp": "2026-11-10T19:00:00.000Z",
  "tenantId": "tenant_1001",
  "branchId": "branch_east_01",
  "actor": {
    "userId": "usr_901",
    "roles": ["Pharmacist"],
    "deviceId": "dev_tablet_pos_01",
    "ipAddress": "192.0.2.10"
  },
  "action": "prescription.controlled.dispense",
  "category": "CLINICAL_CONTROLLED",
  "resource": {
    "type": "invoice",
    "id": "inv_5501"
  },
  "outcome": "ALLOWED",
  "statusCode": 200,
  "requestId": "req_882190",
  "changes": {
    "before": { "status": "PENDING" },
    "after": { "status": "DISPENSED", "qty": 1 }
  },
  "metadata": {
    "reason": "Verified prescription #RX-992"
  },
  "prevHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "entryHash": "sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4"
}
```

---

## 3. Mandatory Auditable Event Categories

| Category | Trigger Events | Severity | Retention |
| :--- | :--- | :--- | :--- |
| `AUTH_SESSION` | Login success/failure, PIN lockout, token rotation reuse anomaly, forced logout | High | 2 Years |
| `ACCESS_CONTROL` | `403` RBAC denial, cross-tenant mismatch (`SEC-03`), cross-branch violation, role elevation | Critical | 5 Years |
| `FINANCIAL_LEDGER` | Invoice void/refund, cash drawer override, credit limit change, journal entry reversal | High | 7 Years |
| `INVENTORY_SENSITIVE` | Manual stock write-off, expiry date modification, controlled substance dispense | Critical | 7 Years |
| `SYSTEM_CONFIG` | Tenant setting update, API key rotation, webhook/integration toggle, data export | Critical | 5 Years |

---

## 4. Sensitive Data Redaction & PII Masking Rules

Before any `AuditEvent` is hashed or persisted, the payload scrubber (`maskSensitiveFields`) recursively redacts sensitive keys:
- **Redacted Keys (`[REDACTED]`):** `password`, `pin`, `pinHash`, `accessToken`, `refreshToken`, `authorization`, `apiKey`, `secret`, `clientSecret`, `cvv`, `cardNumber`.
- **Partially Masked Keys:** `phone` / `mobile` (retains last 4 digits: `*******1234`), `nationalId` (retains last 4 digits).

---

## 5. Immutability & Tamper-Evidence (Hash Chaining)

1. **Append-Only Enforcement:** Audit records disallow `UPDATE` and `DELETE` operations at the storage adapter and database trigger levels.
2. **Per-Tenant Hash Chain:** Each audit event computes `entryHash = SHA-256(canonicalJson(eventWithoutEntryHash) + "|" + prevHash)`. Any mutation or deletion of a historical record breaks the hash chain verification (`verifyAuditChain`).
