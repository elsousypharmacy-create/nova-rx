# NOVA Rx — CURRENT (snapshot, 60 lines max; read this, not all of HANDOFF.md)
Last updated: 2026-11-28 (PR #584 merged; main @ c806e47, last app commit f3c3e1a; preview still rcv29). If this disagrees with GitHub, GitHub wins: fix this file in the same reviewed PR. Old state log: docs/archive/current-history/CURRENT-until-2026-11-23.md.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue/PR number, or last 60 lines) and Issue #87 since your last checkpoint  4. docs/skills/nova/SKILL.md  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when acceptance or scope matters.
Nothing new for you here or on #87? Stop and report IDLE. Governance: AGENTS.md (Antigravity lead manager + primary implementer; Claude on request; owner-only gates below).

## Status words (never mark done on CODED alone)
CODED = written/pushed, nothing proven · TESTED = named tests passed (command + result) · MERGED = on main after review · DEPLOYED = preview/prod artifact published · LIVE_VERIFIED = checked in the live app · ACCEPTED = roadmap `verified` + evidence (AGENTS.md). Unproven = UNVERIFIED. (AGENTS.md names CODE_PUSHED/CI_PASS/REVIEWED/INTEGRATED too.)

## 1. Current State
- Stages 1-2 of docs/product/STAGES.md: MERGED, closed 2026-11-22. Next = go-live checklist with the owner (docs/product/GO-LIVE.md).
- Latest main: Q24 look polish (544e1e9), preview artifact rcv29 (f27ecb1). Auto-deploy preview for f27ecb1: success (DEPLOYED; LIVE_VERIFIED UNVERIFIED).
- CI on main (2026-11-22): Perf budget + Secret scan pass; **Playwright POS smoke FAILS** on 544e1e9, f27ecb1, 7b0fbd6; QA loop and Supplier sessions scheduled runs failed on f27ecb1. Cause UNVERIFIED.
- Backend: production backend exists; frontend flag novaBackend.enabled OFF until the owner enables it on one device. SAAS-01..05 behind flags OFF; billing is a mock; not a multi-tenant SaaS.

## 2. Completed & Verified
Evidence: HANDOFF.md, Issue #87, the git log; per-item detail in the archive file above.
- TESTED + MERGED (browser/unit tests, mutation-checked; not on a real phone/printer): sale rules (SALE-B1: wallet/InstaPay, rounding, manager approval, credit limit, controlled-drug capture), offers/coupons, lot prices, stock count, item card/limits, shift open/close, profit/slow stock, Excel export, supplier accounts/cheques/notes, ops logs, backup (encrypted), staff gate (SEC-01).
- MERGED + DEPLOYED to preview: UX batch 1, owner UI decisions (Q17: auto-print, no-PIN shortages, theme by time, unit toggle), design system phases 1-3, startup diet (JS/CSS 1,336,135 -> 839,032 B), Q24 look polish.
- LIVE_VERIFIED: UX-AHMED PR #537 (preview 2026-11-16, SHA256 a14f7676…6df5, deploy 43941072035). Later preview artifacts: UNVERIFIED live.
- ACCEPTED: roadmap status in reports/erp-roadmap.json only (not re-audited here).

## 3. Open Issues & Blockers
- P0 pharmacy#59 (blank mobile dashboard): pharmacy PR #60 fixed, NOT LIVE_VERIFIED; close only when the owner confirms on his phone.
- Playwright POS smoke red on main (see section 1); POS spec «blank customer search» known failing; tests/ux/shift-close.mjs, ui-ux432/434/436 failed before recent changes and are not in CI.
- Perf size budget: index.html +4.82% / JS-CSS +4.94% of 5%: new screens must be lazy or appended inside app/594-ops-screens.js; never raise budget.json without the owner.
- worker/live holds more than the newest-10 artifacts rule (pruning left to the owner). Drawer pulse needs the local print agent/device gateway (not installed).
- Aumet checkout blocked by supplier minimum (`order-minimum-not-met`), not a defect; real cart writes/orders never tested; an unknown cart operation locks that supplier scope (fail-closed; docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md).
- Not tested: real phone, real printer/tablet, light theme, SW offline. Loading fresh stock still needs the PIN (server-side; changing it = credentials, owner-only).
- Risks: one shared PIN on legacy paths; sales/invoices device-local; unauthenticated scanSearch/scanLookup in Apps Script; shortages-plan «signature» is an unkeyed hash. Not inspected: Apps Script server, legacy POS link, bot, cameras, finance/HR.
- Stale-looking open items, UNVERIFIED: PR #553 (draft), #566, Issues #545, #550 (draft PR #551/#549 chain). Check on GitHub before acting.

## 4. Active Work (updated 2026-11-28 per owner decision)
- Antigravity: lead manager and primary implementer (Phase 1 core pharmacy features only: POS, credit, discount limits, inventory/expiry, purchases/receiving, customers, shifts, reports, RBAC, backup, offline).
- Claude sessions: secondary implementer/reviewer on request only. Frozen until Phase 1 finishes: AI, WhatsApp, stickers, loyalty, multi-branch/SaaS.
- Rules: one accountable claimant per task; author ≠ reviewer (independent review before push/merge); owner-only gates below unchanged.

## 5. Next Actions (Phase 1 order)
1. Build & publish preview `rcv30` from `main` (includes Nov 23 audit fixes) and re-verify live.
2. Fix `/purchases` hang, receiving mouse/layout overlap, settings form overlap, and live inventory/customer refresh.
3. Fix `Playwright POS smoke` on `main` and run go-live checklist on owner phone/printer (`docs/product/GO-LIVE.md`).
4. Close stale PR/Issue chain (#553/#566/#545/#550) after Phase 1 stabilizes; prune `worker/live` (owner).

## Waiting on the owner (do not act on these or ask routine questions)
Database/storage choice (docs/erp/FND-02_STORAGE_ADR_DRAFT.md §9), pricing/tax policy, packaging data source, light theme yes/no, audit retention and signing-key name, tablet trial of /purchases, any real supplier order/payment/deploy. Never without his specific approval: supplier cart writes/orders/checkout, payments, secrets/credentials, unlocking an unknown supplier operation, production deploy, destructive deletes/migrations, storage product, spending money.

## Update rule
Edit this file in the same reviewed PR as the change (never straight to main). Update the existing line instead of appending a new dated entry; 60 lines max. Detail and evidence go to HANDOFF.md or a specialist doc/archive and are linked. No done without evidence; unsure = UNVERIFIED. No secrets, customer data or private chat text.
