# NOVA Rx — Architecture

## Verified current architecture

- `index.html`: browser-local POS prototype; no central transactional persistence.
- `sticker-studio.html` and `sticker-six-layout.css`: standalone RTL Sticker Studio using localStorage drafts and browser printing.
- `worker/`: integration helpers for medication-label generation and print settings. The live Cloudflare Worker source may be newer than GitHub and must be reconciled before deployment.
- Tests: static Node regression checks and Playwright Chromium acceptance checks.

## Target architecture

Use a versioned backend API and relational database before representing sales, stock or balances as centrally committed. Tenant, branch, product, batch, sale, payment and movement records require server-side authorization and transaction boundaries. Sale completion must atomically create the invoice, payments, inventory movements and audit event; idempotency prevents duplicate submission.

AI is an adapter behind a server route. Credentials remain server-side. Clinical drafts require explicit pharmacist approval, which is invalidated by subsequent clinical edits. Offline mode may preserve drafts, but must not claim central sale commitment until conflict-safe synchronization exists.

## Deployment boundary

Pull requests do not deploy Cloudflare. Never overwrite the live Worker with stale GitHub HTML. Export and reconcile the current Worker, deploy an isolated preview, run browser QA and retain rollback.
