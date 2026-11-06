# NOVA Rx — Master Product Requirements

NOVA Rx is an Arabic-first, RTL pharmacy POS and ERP product for landscape tablets, desktop and mobile. The initial market is Egypt; the commercial architecture must eventually isolate independent pharmacy tenants and support multiple branches.

## Product principles

- Complete, measurable workflows rather than decorative placeholder screens.
- Deterministic money and inventory calculations, transactional writes, idempotency and audit trails.
- Fast bilingual product search and keyboard/barcode operation.
- Explicit loading, empty, validation, permission, failure and success states.
- Pharmacist review of patient-facing AI instructions; unanswered safety questions remain unknown.
- No secrets in browser code and no expired-stock sales by default.

## Delivery phases

1. Premium POS and Sticker Studio UX with durable browser-local drafts.
2. Transactional persistence for catalog, sales, payments, batches and returns.
3. Purchasing, suppliers, customers, expenses, cashier sessions and staff permissions.
4. Tenant/branch isolation, accounting, reporting, backup and security hardening.
5. Configured AI providers, import/export, safe offline drafts and commercial readiness.

The current repository is a frontend prototype with Worker integration helpers. Later phases are requirements, not claims of implemented functionality.
