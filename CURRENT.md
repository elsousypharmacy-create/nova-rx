# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-11 by Claude 2 (lead manager). main @ caf4aa6. Index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same reviewed PR.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines) and Issue #87 since your last checkpoint  4. docs/skills/nova/SKILL.md  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when acceptance or scope matters.
Nothing new for you here or on #87? Stop and report IDLE. Governance (owner, 2026-11-11): only two Claude sessions work here; ChatGPT, Gemini, Kimi and Grok are out (old instructions: docs/archive/retired-agents/, not active).

## Priorities (owner direction, newest first)
1. Finish the core four, accepted and integrated, not just coded: CAT (catalog/units/price), POS (sale/returns), INV (stock ledger), BUY (shortages → PO → receipt). Truth today: accepted 0 of 85; merged code = CAT-01, CAT-02, SEC-04 (pure modules); nothing is wired to a screen; storage is undecided.
2. PR order now: #139 (this governance PR, needs Claude 1's cross-review), then INV-01, CAT packaging link, SEC-03, CAT-05, BUY core, UX-01 audit, FND-02 local harness (branches already exist; see #87).
3. P0 pharmacy#59 (blank mobile dashboard): fixed by pharmacy PR #60 (f79ecee); NOT live-verified (sandbox cannot reach github.io); close it only after the owner confirms on his phone.

## Who is on what
- Claude 2: lead manager + reviewer (priorities, PR sequencing, merges after gates, roadmap/CURRENT truth, review of Claude 1), BUY lane, SEC-05, UX-01 audit, FND-02 local harness.
- Claude 1: lead implementer: CAT, INV (took over INV-01), POS, SEC-03.
- Rules: one accountable claimant per task; author ≠ reviewer; nobody merges their own work; max 3 active implementation PRs; re-read #87 before every claim (first claim wins).
- Reviewer independence is weaker (same model family): exact-SHA reviews, re-run tests, mutation checks, owner-only gates.

## Merged to main and DEPLOYED: Worker nova-rx-preview (deploy-worker.yml, workflow_dispatch only; every deploy: CI, dry run, real run, code digest read back)
LIVE (as recorded 2026-11-10, not re-verified today) = purchases15, sha256 08ceb32af224b076492b5d70f35960e828b7081b40d8ac97e9b83faadd6ce866, modified 2026-11-10T13:21:42Z. Rollback: the previous artifact in worker/live/ with expected_modified_on set to the live modified_on. Recipe and the id lesson are in the skill.
Merged since, NOT deployed, NOT wired: CAT-01 catalog (#136, 28a3724), CAT-02 unit/price conversion (#137, 595b2a8), SEC-04 audit-log core (#138, caf4aa6). Read-only live checks: workflows "Supplier live check" and "Supplier cart read check". No deploy happens without the owner's approval.

## Open PRs
nova-rx: #139 governance/CURRENT/roadmap (docs), #109 FND-05 draft (claim "no migrations" conflicts with the D1 journal; unreviewed). Closed unmerged as obsolete on 2026-11-11: #114, #91, #25, #20 (branches kept).
pharmacy: #56 dashboard sprint draft; #51 and #28 drafts; #11, #10, #9 bot/Apps Script review-only (not re-checked today). Merging in pharmacy can publish a page: only for explicit owner requests.

## Known breakages and risks
- tests/unit/shortages-adapter.check.mjs FAILS on main (merged in #132, no workflow runs it): its tamper fixture is a no-op. The draft «signature» is an unkeyed hash: it detects accidents, it is NOT an authorization control. Fix is in the BUY lane.
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
