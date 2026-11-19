# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-19 (PERF-02). App merge @ bb4eb4d. Index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same reviewed PR.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines) and Issue #87 since your last checkpoint  4. docs/skills/nova/SKILL.md  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when acceptance or scope matters.
Nothing new for you here or on #87? Stop and report IDLE. Governance (owner, 2026-11-11): only two Claude sessions work here; ChatGPT, Gemini, Kimi and Grok are out (old instructions: docs/archive/retired-agents/, not active).

## Priorities (newest first)
- PERF-02 (2026-11-19, branch cloud/PERF-02): index.html split into a 68 KB shell + app/NNN-*.js|css (edit these) served as content-hashed /assets/app-* (immutable cache, SW precache, CACHE v7-<hash>); run `node tools/split-index.mjs` after edits (see AGENTS.md). Preview artifact perf-02 adds the /assets/app-* route. No behaviour change intended. Not deployed.
- SEC-01 / S1-07 (2026-11-19, branch cloud/SEC-01): staff login gate before /, /whatsapp, /?app=whatsapp (staff-gate.js, Arabic RTL; auth-local 8 h session + trusted device; first run = owner creates the first account, no built-in password). Conversations API (history/send/media/names/push) needs a Bearer staff session on every env; X-Nova-Pin accepted only until PIN_TRANSITION_UNTIL 2026-12-31 (backend/src/inbox-history.js). UX400 pinless staging/preview opening removed. Accounts card owner/manager only. Preview artifact sec-01. Staging needs at least one staff account (owner, via /api/v1/staff) before anyone can open chats on preview: owner action, not done here. Not deployed.
- PUR-04 (2026-11-19, branch cloud/PUR-04): preview artifact pur-04 rebuilt from main so /purchases history (PUR-03) is live again (pur-01b had overwritten pur-03); one session banner (duplicate warning status hidden); receive tab full width; dashboard PIN optional on staging/preview only (frontend PINLESS flag + server NOVA_ENV rule; production still gated). Server side needs Worker secret NOVA_STOCK_SOURCE_PIN on staging/preview (name only; not created here) and the artifact does NOT change Worker code, so preview needs-autoload stays blocked until the backend carries http.js. Not deployed.
- PUR-01b (2026-11-19, branch cloud/PUR-01b): receive-invoice confirm stays disabled until every used line has an item, qty > 0 and a valid MM/YY expiry; the «ناقص» hint lists الكمية / الصلاحية from the start (leftover `&& false` removed). Test tests/ux/receiving-confirm.mjs (not yet a workflow step). Preview artifact pur-01b.
- PUR-02 (2026-11-19, branch cloud/PUR-02): /purchases is one screen with tabs طلب | استلام | سجل الفواتير (deep links /purchases#receive, #history; no reload on switch). استلام embeds the existing receiving screen via same-origin iframe `/?embed=receiving#receiving` (index.html hides its top bar in embed mode); /#receiving in the app is unchanged. Needs auto-load on open, session banner with «جدّد الجلسة» (opens read-only settings), «بيانات تجريبية» moved into the settings dialog. History tab = placeholder (PUR-03). Preview artifact pur-02. Test tests/purchases-hub-browser.mjs (not yet a workflow step).
- PUR-01 (2026-11-19, branch cloud/PUR-01): receive-invoice dialog in index.html: supplier is a select + «+ مورد جديد», required markers, MM/YY expiry, confirm disabled with «ناقص: …» hint. Preview artifact pur-01. Draft save and barcode scan not done (TODO).
- UX-P40 (2026-11-19, owner-approved mockup): sale side rail on wide landscape screens: four invoice tiles (new, hold, customer, clear), last 3 held invoices with resume + «more», stickers at the bottom; attached customer = header chip that opens the customer card as a window. Narrow screens keep the header buttons. Test tests/ux/sale-rail.mjs (passes locally; not yet a step in playwright-smoke.yml, web upload cannot change workflows); UX-P40c (owner-approved 2026-11-19): fixed customer card on top of the rail (empty = «تسجيل عميل F3» bar; attached = name, phone, tier·points, red debt, chronic medicine; tap = history window, × removes); no «الفاتورة» label; clear is a wide separate button; customer search: unknown phone number (9-15 digits, not a barcode) → «مش مسجل» + register dialog (phone prefilled, name required, saved on this browser) → attached; unknown name never offers registration (names repeat). Preview bundle s3-04c. Gemini Neon reviewed P40c (5 fixes applied, 1 rejected: suggestions already reset). Earlier: Gemini review done with Neon (Argon no longer offered; owner switched the rule to Neon 2026-11-19): applied aria-label/translator fix, aria-keyshortcuts + hidden F-key badges, inert POS behind the customer window, focus rings, badge contrast, held rows rebuilt only on language change, storage clear(), resume fallback; rejected «elements parsed after the script» (the card is inside the aside, above the block).
- Issue #550 receiving controls on ux/receiving-controls, stacked on #549. Local logic/auth checks passed. Browser CI and review pending. See the receiving-controls checkpoint in HANDOFF.md.
- Sale stickers: branch `ux/sticker-print-ready` implements direct printing of ready labels from the instructions screen. Owner review and release are pending.
- Draft #549: local purchasing through receiving and stock passed browser checks at tablet and desktop sizes. GitHub CI and review pending. See the 2026-11-18 checkpoint in HANDOFF.md.
- POS invoice UX: owner-requested customer-first entry and invoice lookup. Scoped PR from `ux/invoice-search-and-returns`; local browser checks passed. See HANDOFF for evidence and release status.
- UX-AHMED: PR #537 merged bb4eb4d after exact-head independent review + all 5 CI PASS. Preview deployed run 43941072035; SHA256 a14f7676d19d6e7a297a5f197d618d96ba21ceec52ce75cf082846d708d06df5. Live browser verified search, split checkout, clear confirmation and purchases UI; no sale saved. WhatsApp unchanged. Physical keyboard/printer untested.
1. **Sale readiness (2026-11-15): sell today from preview/app.** Operator guide: docs/ops/SALE_DAY.md (Arabic). Cloud queue tasks SALE-01–06 and UX3xx/UX4xx run via the cloud scheduler (state: .nova/cloud-queue.json; scheduler opens PRs and squash-merges on green CI).
2. Merged on main (not necessarily deployed to preview): UX420 design tokens, UX421/UX422 Black Edition pages, UX400 conversations without PIN on staging/preview (superseded by SEC-01 once merged: staff session required), SALE-02 VAT default 14% + static assets + demo text hidden, UX323/UX324 sticker and emergency-sales fixes.
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

