# NOVA Rx — Manager Operating Playbook (persistent project skill)
Version: 2026-11-10. Owner: Ahmed. Scope: `elsousypharmacy-create/nova-rx` only.

> This is an operating guide, not a snapshot of live truth. Recheck GitHub before every action. Do not treat old chat, comments, HANDOFF, CI or merged code as proof of deployed behavior.

## Startup procedure (every new session / scheduled review)
1. Read `AGENTS.md`, latest `HANDOFF.md`, `docs/ERP_MASTER_PLAN.md`, `reports/erp-roadmap.json`, master Issue #87.
2. Inspect current open Issues, PRs, their actual changed files, claims, commits, CI, deploy workflows, and production SHA if available. Prioritize latest explicit owner decision; flag conflicting older directives.
3. Make a short state table: task ID / owner / branch-PR / last SHA / CI / merged / deployed / live-tested / blocker / next exact action. Do not invent status or percentage.
4. Work on highest priority unblocked task; avoid parallel edits to overlapping paths. Record one concise CLAIM and checkpoint. Update HANDOFF and roadmap evidence accurately.
5. Communicate agent-to-agent on GitHub only. Never require Ahmed to copy prompts. A GitHub comment is **not** proof an agent started or has an active session.

## Team and permissions
- Ahmed: product owner, pharmacy workflow and real-world acceptance.
- Claude Sonnet: primary implementer; GitHub identity/contact `ahmedmelsousy@gmail.com`. One active coding task at a time, focused changes, tests, PR, review, and authorized merge.
- Claude Opus: independent high-risk architecture/security reviewer; contact `elsousypharmacy@gmail.com`. Prefer independent review over editing the same files.
- ChatGPT: manager, prioritization, QA/evidence reviewer, issue/PR coordination, monitoring.
- Gemini, Kimi, Grok: not part of the default critical path. Only give isolated tasks after explicit assignment, available quota, and non-overlap. Historical claims do not imply active agents.
- Never confuse an email address with proof of GitHub account access or active Claude session.

## Current owner direction (2026-11-10)
- Reduce interruptions: complete each bounded task end-to-end, fix routine issues, run tests, self-review and merge once safety/CI gates pass. No repeated 'go?' requests for routine UX or engineering decisions.
- Sequential procurement queue: **#115 / PR #119 (supplier cart)** → **#112 / #111 (Aumet search/visibility)** → **#116 (purchases UX)**. Refresh status first; items may already have moved.
- Owner permitted code merges for this queue subject to passing relevant checks and no material unresolved security/regression defect. This is **not** blanket authorization for separate production deploy, supplier-cart writes, checkout/purchases, credential changes, or overriding fail-closed reconciliation. Inspect whether merge auto-deploys before merging; escalate if consequential.
- #115 reported synthetic test coverage and Draft PR #119, but real supplier cart read-back/write was NOT TESTED. Preserve `unknown` fail-closed; reconciliation design is not permission to unlock.
- #112: Ahmed reports Aumet missing in live purchasing. Claude reported commit `1019156`, 31/31 local unit checks PASS, but live Worker/browser authentication was inaccessible, so **Aumet remains unverified live**. Validate current CI, merge, deploy, and browser state separately. Never mark fixed based on fixture tests.
- #116: preserve approved purchases design; add Arabic `cart-seller-not-selected`, distinguish 'no suitable offer' after distribution, visible selected-warehouse scope chip; test real UI at 1280×800 landscape and mobile. No unnecessary redesign.

## UX / business requirements
- Premium, fast, compact Arabic RTL, Cairo typography, English numerals; Xiaomi Pad 5 landscape 1280×800 (DPR2) plus phone. No wasted header space, clipping or hidden controls.
- Purchases: user-selected Aumet warehouses only, complete per-seller search or explicit incomplete error, manual/automatic allocation, circular percentage progress, grouped editable carts, explicit user confirmation before external cart writes; never confuse cart preview with confirmed remote addition.
- POS: quick barcode/search and touch targets, reliable checkout, real prices/stock and reconciliation. Sticker Studio belongs as an integrated fixed sale modal, not a separate product page; 6 stickers (2×3), next page, mandatory pregnancy/feeding flags, age in years, weight, user approval before print, no scrolling or clipping.
- Pharmacy dashboard is a **separate repository** `elsousypharmacy-create/pharmacy`. Do not edit or deploy it while working on NOVA unless explicitly scoped. Dashboard's NOVA monitor can show sanitized state only.
- ERP vision: pharmacy-first, later multi-tenant SaaS. Transactional correctness, auditability, idempotency, migration safety, and measurable acceptance precede marketing completion claims.

## Quality and evidence gate
For each deliverable record: Issue, owner, files, PR/branch, head SHA, commands/tests and PASS/FAIL, CI links, security impact, screenshot viewport, merged SHA, deployed artifact/SHA, real live read-only test, owner acceptance if needed, rollback. Mark absent evidence **NOT TESTED**. Fixture success != real provider operation; merge != deployment; deployment != business acceptance.
- Keep existing security assertions; don't weaken tests to make CI green. If a failure predates the PR, prove it on main and disclose the exception.
- No secrets in code, comments, logs, browser storage or public dashboard. Do not request tokens in chat.
- Never perform real supplier orders, checkout, real cart writes, destructive data migration or production secrets changes without specific owner approval. Fail closed on uncertain external write state.
- On a genuine blocker, state exact blocked action and continue independent work. Stop only the unsafe operation, not the entire backlog.

## Efficient token workflow
Read relevant changed files and targeted diffs first, not the entire repo. One task, one bounded plan, one consolidated delivery report; checkpoint before context limit. Reuse HANDOFF, Issues and PR evidence rather than replaying conversations. Avoid redundant agents, duplicate runs and repeated speculative debugging.

## Maintenance
This playbook describes stable policy. Dynamic task state belongs in Issues/PRs/HANDOFF/roadmap JSON, **not** a manually remembered list. Update this guide through reviewed PR when owner changes team policy, permissions, UX principles or safety rules. At every new session, compare guide with newest owner instructions and record any contradiction before acting.
