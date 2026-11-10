# SEC-02 Permissions and Authorization System Specification

## 1. Overview
This specification details the Role-Based Access Control (RBAC) and authorization framework for Nova-RX ERP, enforcing a zero-trust, deny-by-default permission model with explicit tenant and branch scoping.

## 2. Security Architecture Principles
- **Deny-by-Default Policy**: Access is strictly denied unless an explicit permission grant is matched for the requesting principal's role, tenant, and branch scope.
- **Hierarchical Context Enforcement**: Permissions are evaluated in order: `Tenant Level` -> `Branch Level` -> `Role Level` -> `Resource Action`.

## 3. Defined Roles & Capabilities Matrix
- **Owner**: Full access across all tenant branches, financial reports, user management, audit logs, and systemic configuration.
- **Pharmacist**: Full access to clinical prescriptions, dispensing, inventory lookup, controlled substance registers, and customer health profiles.
- **Cashier**: Access to Point-of-Sale (POS) terminal, processing customer checkout transactions, issuing standard receipts, and opening/closing cash drawers.
- **InventoryManager**: Access to inventory stock intake, supplier purchase orders, stock transfers between branches, batch expiry tracking, and stock audits.

## 4. Tenant and Branch Scoping Rules
- **Tenant Scoping**: All API requests require a matching `tenant_id` header verified against JWT claims.
- **Branch Scoping**: User permissions are dynamically restricted to assigned `branch_id` contexts (except Owner who possesses multi-branch tenant-wide scope).
- **Cross-Scope Enforcement**: Requests targeting resources outside assigned `tenant_id` or `branch_id` automatically fail with `HTTP 403 Forbidden`.
