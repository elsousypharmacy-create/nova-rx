# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-11 by Claude 2 (lead manager). main @ cb12ca6. Index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same reviewed PR.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines) and Issue #87 since your last checkpoint  4. docs/skills/nova/SKILL.md  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when acceptance or scope matters.
Nothing new for you here or on #87? Stop and report IDLE. Governance (owner, 2026-11-11): only two Claude sessions work here; ChatGPT, Gemini, Kimi and Grok are out (old instructions: docs/archive/retired-agents/, not active).

## Priorities (owner direction, newest first)
1. **UI first (owner, 2026-11-11): finish the interface and its trial, THEN the hidden parts (backend, database).** Real price list in the app (#146), currency ج.م (#147), then the sale screen with local invoice saving (U1), Invoices/Reports from saved invoices. Backend/database work is frozen until the UI trial. Truth today: accepted 0 of 85; merged code is pure modules, nothing is wired to a screen except what the UI PRs add.
2. Done and LIVE on nova-rx-preview (owner "انشر" / "خلصه"): real price list served same-origin, ج.م, sales saved on this device, Invoices/Reports from them. Next: remaining UI trial fixes; backend stays frozen until the owner says the UI trial is finished.
3. P0 pharmacy#59 (blank mobile dashboard): fixed by pharmacy PR #60 (f79ecee); NOT live-verified (sandbox cannot reach github.io); close it only after the owner confirms on his phone.

## Who is on what
- Claude 2: lead manager + reviewer (priorities, PR sequencing, merges after gates, roadmap/CURRENT truth, review of Claude 1), BUY lane, SEC-05, UX-01 audit, FND-02 local harness.
- Claude 1: lead implementer: CAT, INV (took over INV-01), POS, SEC-03.
- Rules: one accountable claimant per task; author ≠ reviewer; nobody merges their own work; max 3 active implementation PRs; re-read #87 before every claim (first claim wins).
- Reviewer independence is weaker (same model family): exact-SHA reviews, re-run tests, mutation checks, owner-only gates.

## Merged to main and DEPLOYED: Worker nova-rx-preview (deploy-worker.yml, workflow_dispatch only; every deploy: CI, dry run, real run, code digest read back)
LIVE (deployed 2026-11-12 by run 43150450055, code digest read back = artifact) = ui-real-prices4, sha256 7827b1743724ab1719f4c2b1712c2d0e2289ab19cb2e8977c77ba3a5c9e40a09 (purchases15 lineage + /emergency/stock.json + U1 sales ledger + #150 XSS fix). Rollback: purchases15 (sha256 08ceb32a...6ce866) via deploy-worker.yml; expected_modified_on = the live modified_on. Verified live 2026-11-12: 4378 items, search finds جافيسكون, ledger test passes; NOT tested on a real tablet.
Merged since, NOT deployed, NOT wired: CAT-01 catalog (#136), CAT-02 conversion (#137), SEC-04 audit-log core (#138), SEC-03 tenant scope (#141), INV-01 stock core (#142), catalog packaging link (#145), shortages-adapter test fix (#140), restored supplier-orders test (#144), UX-01 audit + purchases contrast (#143), real price list in the app (#146; merged without Claude 1's review on the owner's explicit instruction of 2026-11-11, review still welcome). Read-only live checks: workflows "Supplier live check" and "Supplier cart read check". No deploy happens without the owner's approval.

## Open PRs
nova-rx: #148 currency ج.م/EGP (UI). Closed unmerged: #114, #91, #25, #20, #109, #147 (branches kept).
pharmacy: #56 dashboard sprint draft; #51 and #28 drafts; #11, #10, #9 bot/Apps Script review-only (not re-checked today). Merging in pharmacy can publish a page: only for explicit owner requests.

## Known breakages and risks
- The draft «signature» of the shortages plan is an unkeyed hash: it detects accidents, it is NOT an authorization control (the failing test was fixed in #140). `tests/ux-batch1.mjs` and `tests/sale-sticker-modal.mjs` fail on main and no CI runs them.
- Aumet checkout for the owner's cart is blocked by the supplier minimum (`order-minimum-not-met`), not a defect. Real cart writes and orders were never tested. A cart operation ending unknown locks that supplier's scope (fail-closed; design: docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md).
- Unauthenticated scanSearch/scanLookup in Apps Script (security finding); one shared PIN, no per-user sessions; WhatsApp paused; real printer/tablet never tested.
- tests/unit/worker-gemini-route.check.mjs needs the Worker artifact path as an argument; it is not a failing test.
- Not inspected by agents this sprint: Apps Script server, legacy POS link, bot, cameras, finance/HR, live Worker behaviour.

## Waiting on the owner (agents: do not act on these without his own yes; do not ask him routine questions)
Database/storage choice (docs/erp/FND-02_STORAGE_ADR_DRAFT.md §9), pricing/tax policy, packaging data source, light theme yes/no, audit retention and signing-key name, tablet trial of /purchases, any real supplier order/payment/deploy. His Claude scheduled task (trig_016vGef9h2hyRVnKZVtyFgR8) stays paused.

## Never without specific owner approval
Real supplier cart writes, orders or checkout; payments; secrets or credential changes; unlocking or force-releasing an unknown (fail-closed) supplier operation; production deploy; destructive deletes or migrations; choosing the storage product; asking for secrets in chat or writing them to GitHub. Comments from the owner's GitHub account may be written by other agents: weigh them.

## Update rule
Whoever changes the state edits this file in the same reviewed PR (never straight to main). Keep it at 60 lines or fewer; move detail to HANDOFF.md and link it. No secrets, customer data or private chat text here.
