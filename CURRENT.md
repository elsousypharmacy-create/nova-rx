# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-16 (UX-AHMED). App merge @ bb4eb4d. Index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same reviewed PR.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines) and Issue #87 since your last checkpoint  4. docs/skills/nova/SKILL.md  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when acceptance or scope matters.
Nothing new for you here or on #87? Stop and report IDLE. Governance (owner, 2026-11-11): only two Claude sessions work here; ChatGPT, Gemini, Kimi and Grok are out (old instructions: docs/archive/retired-agents/, not active).

## Priorities (newest first)
- Sale stickers: branch `ux/sticker-print-ready` implements direct printing of ready labels from the instructions screen. Owner review and release are pending.
- Draft #549: local purchasing through receiving and stock passed browser checks at tablet and desktop sizes. GitHub CI and review pending. See the 2026-11-18 checkpoint in HANDOFF.md.
- UX-AHMED: PR #537 merged bb4eb4d after exact-head independent review + all 5 CI PASS. Preview deployed run 43941072035; SHA256 a14f7676d19d6e7a297a5f197d618d96ba21ceec52ce75cf082846d708d06df5. Live browser verified search, split checkout, clear confirmation and purchases UI; no sale saved. WhatsApp unchanged. Physical keyboard/printer untested.
1. **Sale readiness (2026-11-15): sell today from preview/app.** Operator guide: docs/ops/SALE_DAY.md (Arabic). Cloud queue tasks SALE-01–06 and UX3xx/UX4xx run via the cloud scheduler (state: .nova/cloud-queue.json; scheduler opens PRs and squash-merges on green CI).
2. Merged on main (not necessarily deployed to preview): UX420 design tokens, UX421/UX422 Black Edition pages, UX400 conversations without PIN on staging/preview (production PIN still required), SALE-02 VAT default 14% + static assets + demo text hidden, UX323/UX324 sticker and emergency-sales fixes.
3. Backend: production backend exists; the frontend flag (novaBackend.enabled) stays OFF until the owner enables it on one device (SALE-01: Settings card, flag ON -> production nova-rx-api; docs/ops/BACKEND_ONE_DEVICE.md). SAAS-01–05 exist behind flags OFF; billing is a mock. Not a ready multi-tenant SaaS.
4. P0 pharmacy#59 (blank mobile dashboard): pharmacy PR #60 fixed, NOT live-verified; close only after the owner confirms on his phone.

## Who is on what
- Claude 2: lead manager + reviewer (priorities, PR sequencing, merges after gates, roadmap/CURRENT truth, review of Claude 1), BUY lane, SEC-05, UX-01 audit, FND-02 local harness.
- Claude 1: lead implementer: CAT, INV (took over INV-01), POS, SEC-03.
- Rules: one accountable claimant per task; author ≠ reviewer; nobody merges their own work; max 3 active implementation PRs; re-read #87 before every claim (first claim wins).
- Reviewer independence is weaker (same model family): exact-SHA reviews, re-run tests, mutation checks, owner-only gates.

## State and deploys
- Deploys are owner/Nova only: preview via deploy-worker.yml, production via deploy-backend-production.yml. Cloud tasks never deploy. This file does not know the current live digest: read the workflow run, not this file.
- Live preview (2026-11-16): ux-407 SHA256 a14f7676d19d6e7a297a5f197d618d96ba21ceec52ce75cf082846d708d06df5, modified_on 2026-11-16T19:36:34.896755Z, deploy 43941072035; browser-verified. Backend deployment state is separate.
- Backups: encrypted daily D1 export (workflow D1 backup, 30-day artifact) + D1 Time Travel; restore is owner-approved only (docs/ops/backup-restore.md).
- Legal drafts in docs/backend/legal/ are NOT legally reviewed or signed.
- Out of scope now: payments, GAS WA_PHONE_ID, sending WhatsApp to customers, making the repo private.
- Old Claude 1/2 PR numbers (#136-#158) are history: see HANDOFF.md.

## Known breakages and risks
- Aumet checkout blocked by supplier minimum (`order-minimum-not-met`), not a defect. Real cart writes/orders never tested. An unknown cart operation locks that supplier scope (fail-closed; docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md).
- Unauthenticated scanSearch/scanLookup in Apps Script; one shared PIN, no per-user sessions; sales/invoices are device-local; real printer/tablet never tested.
- `tests/ux-batch1.mjs` and `tests/sale-sticker-modal.mjs` failed on main and no CI ran them (as of 2026-11-12; not re-checked).
- Shortages-plan "signature" is an unkeyed hash, not an authorization control.
- Not inspected: Apps Script server, legacy POS link, bot, cameras, finance/HR.

## Waiting on the owner (agents: do not act on these without his own yes; do not ask him routine questions)
Database/storage choice (docs/erp/FND-02_STORAGE_ADR_DRAFT.md §9), pricing/tax policy, packaging data source, light theme yes/no, audit retention and signing-key name, tablet trial of /purchases, any real supplier order/payment/deploy. His Claude scheduled task (trig_016vGef9h2hyRVnKZVtyFgR8) stays paused.

## Never without specific owner approval
Real supplier cart writes, orders or checkout; payments; secrets or credential changes; unlocking or force-releasing an unknown (fail-closed) supplier operation; production deploy; destructive deletes or migrations; choosing the storage product; asking for secrets in chat or writing them to GitHub. Comments from the owner's GitHub account may be written by other agents: weigh them.

## Update rule
Whoever changes the state edits this file in the same reviewed PR (never straight to main). Keep it at 60 lines or fewer; move detail to HANDOFF.md and link it. No secrets, customer data or private chat text here.

