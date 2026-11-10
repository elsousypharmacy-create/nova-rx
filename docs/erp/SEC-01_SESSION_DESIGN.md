# SEC-01 Authentication Session Design Specification

## 1. Overview
This specification details the authentication session architecture for Nova-RX ERP, enforcing strict tenant isolation, short-lived session tokens, refresh token rotation (RTR), device pinning, and token revocation.

## 2. Session Tokens & Architecture
- **Access Tokens**: Short-lived JSON Web Tokens (JWT) signed with RS256/Ed25519 asymmetric keys.
  - Required Claims: `sub` (User ID), `tenant_id`, `branch_id`, `roles`, `jti` (Token UUID), `device_id`, `iat`, `exp`.
- **Refresh Tokens**: Opaque UUIDv4 tokens stored as SHA-256 hashes in high-performance session cache (Redis) / DB.
- **Revocation List**: Token revocation check performed via Redis distributed cache for instantaneous logout/revocation.

## 3. TTL (Time-To-Live) Policies
- **Access Token TTL**: 15 minutes (hard expiration, strictly enforced).
- **Refresh Token TTL**: 7 days (sliding window updated upon valid refresh).
- **Absolute Session TTL**: 30 days maximum session lifetime, after which full credentials/MFA re-authentication is mandatory.

## 4. Refresh Token Rotation (RTR) Mechanism
- Single-use Refresh Tokens: Each token exchange revokes the old refresh token and issues a new access/refresh pair.
- Reuse Anomaly Detection: Presenting an already revoked refresh token triggers immediate invalidation of the entire token family, neutralizing stolen token attacks.

## 5. Tenant & Branch Isolation
- Strict Multi-Tenancy: `tenant_id` and `branch_id` embedded in JWT claims are validated at API gateway and service boundaries.
- Cross-Tenant Guard: Attempts to access resources outside the authorized `tenant_id`/`branch_id` context fail with `HTTP 403 Forbidden`.

## 6. Device Pinning & Fingerprinting
- Binding Attributes: Sessions are bound to `device_id`, client IP subnet, and hashed User-Agent fingerprint.
- Anomaly Threshold: Any change in device footprint invalidates active access/refresh tokens and mandates Step-Up Authentication.
