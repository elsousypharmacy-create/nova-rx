# NOVA Rx — API Contracts

## Existing integration

`POST /api/ai/medication-label` accepts medication context, patient context and locale from Sticker Studio. Unknown pregnancy or breastfeeding values are JSON `null`, never `false`. Responses may be complete or partial drafts; the browser preserves manual edits and requires pharmacist approval before printing. Actual provider availability requires deployed-Worker verification.

## Required future API conventions

Use `/api/v1` for operational resources. Validate request schemas server-side and return consistent success/error envelopes with stable error codes. Support pagination, filtering and sorting for collections. Enforce tenant, branch and role authorization on every request. Never trust browser totals, prices, stock or permissions.

Sale and payment creation require idempotency keys. Purchase receiving, returns, transfers and adjustments require transactional endpoints that update inventory and financial obligations together. Rate-limit authentication and AI routes. Logs must exclude credentials and unnecessary patient data.
