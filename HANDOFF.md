# NOVA Rx — HANDOFF (living project state)

> **Start with `CURRENT.md`** (about 40 lines: priorities, who is on what, open PRs, breakages, what waits on the owner). This file is the history and evidence archive: read only the section for your task (search its issue or PR number, or read the last 60 lines), not the whole file. Nothing here is deleted.

Last documented: 2026-11-05 (Asia/Riyadh). This document is a handoff, not proof of current CI status. Verify GitHub before making changes.

## Checkpoint 2026-11-10 — FND-05 [3/5] environments/deploy/rollback design draft (docs-only, review pending)
- New file `docs/erp/FND-05_ENVIRONMENTS.md`: current-vs-required inventory (only `nova-rx-preview` exists; dev/production missing), secrets isolation, numbered-migrations spec (PROPOSED, none exist), stale-artifact gap (`modified_on` blocks concurrent overwrite but not older-artifact-over-newer; two proposals), backup/restore/rollback checklist reusing the existing deploy guard (`.github/workflows/deploy-worker.yml` + `.github/scripts/deploy_worker.sh`), proven vs NOT-implemented vs NOT-TESTED sections, 6 open decisions.
- Verification: code reading + manual reference-consistency check only; no new JS/JSON (node --check / json.tool N/A); no dry run, deploy, or migration. Full entry at top of BUILD_REPORT.md.
- Roadmap/HANDOFF status untouched: FND-05 stays `queued`; no acceptance percentage change. ChatGPT reviews before merge.
- Next exact step: owner/ChatGPT review of the draft and decisions on the 6 open questions; do not implement workflows/migrations/deploy from this draft without explicit approval.

## Checkpoint 2026-11-10 — FND-03 domain model draft (Kimi, task 1/5, NOT committed)
- Created `docs/erp/FND-03_DOMAIN_MODEL.md` (DRAFT, docs only): entity/key/constraint map for tenant/branch/user/product/variant/unit/batch/stockMovement/invoice/payment/return/purchaseOrder/receipt/journal, document state machines, six invariants (mirroring FND-02 §4), single-writer source ownership until G1, synthetic JSON example, ten unsettled storage decisions (D1 vs Postgres pending FND-02 measurement, money representation, key shape, unit conversion, batch mandatoriness, receipt semantics, tax, customer key, …).
- Linked to FND-01 reality (current owner per entity: legacy system E / STOCK LIVE snapshot vs proposed NOVA master). Roadmap status unchanged (`queued`); no `verified`, no acceptance increase. No migrations, no DB, no code.
- Evidence: synthetic JSON block validated with `python3 -m json.tool` (exit 0); no JS created so `node --check` n/a; manual key/state consistency review. Full details in `BUILD_REPORT.md` top entry.
- Next exact step: ChatGPT reviews the draft; then delegation tasks 2/5–5/5 (queued). `DATABASE_SCHEMA.md` deep-read was out of scope this run.

## Checkpoint 2026-11-09 — Issue #84 emergency mobile sales (MVP, Draft PR, NOT deployed)
- Files: `emergency-sales.html`, `emergency-core.js`, `docs/EMERGENCY_SALES.md`, tests `tests/unit/emergency-core.check.mjs` + `tests/emergency-sales-browser.mjs` (both PASS), samples in `reports/`.
- Source of truth: STOCK LIVE sheet via Apps Script `scanSearch/scanLookup` (`price` = public price). Live call NOT tested (network blocked). Finding: those two actions need no PIN. Details in the doc.
- Built: read-only snapshot lookup, basket, authorised discount, temporary invoice + Arabic PDF + share/download, local queue (pending/needs-review/synced, audit, idempotent), conflict detector, JSON export.
- Not built (needs owner approval): Worker read API, durable storage, POS import. Not tested: real phone, share sheet, live prices.
- Deploy artifact: `worker/live/nova-rx-preview.with-emergency2.js` = aumet-search1 + public `/emergency` page + `/emergency/stock.json` (prices from STOCK LIVE, no stock levels; exportedAt = sheet modifiedTime). Refresh: read STOCK LIVE from Drive as CSV, `python3 tools/build-emergency-stock.py CSV data/emergency-stock.json <modifiedTime>`, `node tools/patch-worker-emergency.mjs <base> <out>`, deploy.
- Next exact step: run Deploy NOVA Worker (dry run first), then open /emergency on a phone.

## Checkpoint 2026-11-08 — Supplier lookup deploy prepared (owner: "نفذ")
- PR #65 merged into main (64bc813). Live Worker was exactly stickers27 (dry run: live code sha 1018c42a… = artifact, modified_on 2026-11-08T07:32:37Z; token secret present).
- New artifact `worker/live/nova-rx-preview.with-suppliers1.js` sha256 `f208296786ac709e111d46bd4a0866c7c050b502d089156c451997c8e8ae2af9` = stickers27 + supplier UI packed into the page + `/api/suppliers/*` routes (built by `tools/build-supplier-artifact.mjs`, deterministic). Tests: `procurement-worker-artifact` (fake Worker: PIN, ingest, encrypted storage, search with a fake supplier, `/` still serves the app, 404 elsewhere), `worker-gemini-route` PASS, ux-batch1/2/3 PASS on the new page.
- New workflow `set-worker-supplier-secrets` (file `set-worker-secrets.yml`): copies repo secrets NOVA_API_PIN / NOVA_INGEST_SECRET onto the Worker. Owner still has to add repo secrets NOVA_API_PIN, NOVA_INGEST_SECRET, NOVA_WORKER_URL.
- Rollback: stickers27 (1018c42a…).

## Checkpoint 2026-11-08 — Server side + packaging built, NOT deployed
- Kimi #79 (run 42474421099): `worker/procurement/provider/{session-store,hub,http}.js` (AES-GCM encrypted sessions in KV, search + status API, rate limit). Claude review fixes: wrong-PIN lockout (8/min then 429), sessions job sends ISO `expiresAt`. 12 procurement checks pass.
- Claude: `supplier-provider.js` (app -> `/api/suppliers/*`, PIN asked once, kept in the browser), `tools/inject-supplier-ui.mjs` (packs css+js+model into ONE html for the Worker; works on repo index.html and on HTML extracted from a live artifact), `tools/sessions/push-sessions.cjs` + `supplier-sessions.yml` (real-browser login every 10 h, posts sessions to the Worker; not run yet).
- Aumet text search parameter is UNKNOWN (search box not found in 3 tries, public JS had no hint). Aumet live search will not work until that is found.
- To go live (owner): merge PR #65 into main; create a new Cloudflare API token; add Worker secrets `NOVA_INGEST_SECRET`, `NOVA_API_PIN` (long PIN) and repo secrets `NOVA_WORKER_URL`, `NOVA_INGEST_SECRET`; then Claude: port the API route into the live Worker (diff onto the extracted live artifact), pack the UI with the inject tool, dry-run deploy, verify, run `supplier-sessions.yml`, try a real search.

## Checkpoint 2026-11-08 — Worker login attempt STOPPED (do not spoof a browser)
- Wrote `worker/procurement/auth/pharmaoverseas-login.js` (plain-HTTP OAuth code + PKCE, 5 steps, unit test passes with a fake server). On GitHub it fails at step 2 (`/authorizationserver/csrf` returns 400 without a browser).
- The fix I was about to apply (fake browser User-Agent and headers) is bot-check circumvention. NOT applied. Do not add it. The module stays as is and is NOT used live.
- What does work: a real browser login (Playwright on the GitHub runner) gives a 12 h token; searches with that token over plain HTTP work (134 offers, 27 s). Plan to propose to the owner: log in with a real browser on a schedule, store the token encrypted in the Worker (KV), let the Worker search with the token and refresh it with the standard refresh grant. Needs owner approval and the Worker deploy token.

## Checkpoint 2026-11-08 — Supplier lookup UI built (Kimi #61), tried in a browser
- `supplier-lookup.js/.css` + `worker/procurement/ui-model.js`; index.html only gets one link + one script tag. Data comes from `window.NOVA_SUPPLIER_PROVIDER` (undefined by default; tests inject a fake). Claude checked on tablet 1280x800 with real PharmaOverseas prices + fake Aumet sellers: row unit, empty-search button, popup, +/- , add to draft (localStorage `novaSupplierDraft`), suppliers screen, add-supplier form (password field autocomplete=off), phone has no horizontal overflow. 9 procurement checks pass.
- NOT done: the real provider (Worker route that logs in to suppliers and returns compare results), encrypted credential storage, Worker artifact with the UI inlined, deploy. Prices in the app are still fake until the provider exists.
- Next exact step: build the provider. Decide how the Worker logs in (plain HTTP vs a browser service).

## Checkpoint 2026-11-08 — Aumet connector built (Kimi #78), NOT tested live
- `connectors/aumet.js` + optional `sellerId`/`sellerName` in schema and compare tie-break (run 42463828819). 9 procurement checks pass on fixtures only.
- Known limitation: `netEffectivePrice` is null for Aumet (best_price meaning unconfirmed), so compare ranks Aumet by `unit_price`, which can make Aumet look dearer than it is. Confirm best_price vs the screen on 3 products before showing "net".
- Risk: Aumet login body has `confirm_logout_others`; discovery ran twice (the 2nd by mistake). Capture script now forces it to false. Waiting for the owner: other devices in use? Prefer a dedicated NOVA user on Aumet. No more Aumet logins until decided; `aumet-discovery.yml` now triggers only on branch `run/aumet-discovery`.

## Checkpoint 2026-11-08 — Aumet discovery done
- Run 42463602885 (workflow `aumet-discovery.yml`, branch discovery/aumet): login OK, no CAPTCHA. Findings in `docs/procurement/discovery/aumet.md`. Aumet = marketplace, one offer per distributor, numeric stock, barcode, active ingredient.
- Leak found and fixed: entity/cart ids in paths; sanitizer now templates 4+ digit ids; discovery/aumet branch rewritten without the leaked files.
- Next exact step: Kimi builds `connectors/aumet.js` (+ seller field in schema/compare); owner decides on the Suppliers screen and the supplier button.

## Checkpoint 2026-11-08 — matching + comparison engine done (Kimi #57, #59)
- #57 normalize.js (Kimi run 42454746907): 134/134 real names parse. Claude review fixes: products without stated strength get a key; parse cache; tablet vs vial (different form) is never 0.8, only 0.5 + needsReview (found on real data: Nexium tab vs I.V. vial).
- #59 compare.js (Kimi run 42455536138): 200 items x 10,000 offers in ~0.5 s. Checked on real PharmaOverseas prices.
- All 6 procurement checks pass on the epic branch.
- #60 po-draft.js (Kimi run 42456014609): drafts per supplier, unmatched list, approval needs a name, Arabic WhatsApp text. Checked on real prices. 7/7 procurement checks pass.
- Next exact step: owner decision on merging to main (needed for the 2-hour schedule, #58); then #61 UI; Aumet discovery (#63).

## Checkpoint 2026-11-08 — PharmaOverseas live prices working
- Owner added repo secrets `PO_USERNAME` / `PO_PASSWORD`. Logged-in discovery run 42450090854: login = OAuth code+PKCE, 12 h token, search returns pharmacy price per product, stock status only.
- Kimi #56 (run 42450298609) built `worker/procurement/connectors/pharmaoverseas.js`; reviewed, merged into the epic branch with #54/#55 work. All 4 procurement checks pass.
- First live collection (`collect/pharmaoverseas`, `tools/collectors/pharmaoverseas-prices.mjs`): 8 queries -> 134 valid offers in 27 s, 0 errors, no AI. Output: `data/supplier-prices/pharmaoverseas-latest.json` on that branch. Example: Panadol Megraine 33.75 vs public 51 (33.82 % off).
- Search returns related products too (e.g. Augmentin -> Curam, Hibiotic): matching to NOVA items is Task 04 (#57).
- Next exact step: Kimi #57 (pack parsing + product matching), then #59 comparison, then a scheduled collector (every 2 h) writing to Worker storage, then Aumet.

## Checkpoint 2026-11-08 (later) — owner decision: build our own integration
- Owner: suppliers have no official API; NOVA Rx builds its own connectors on top of their websites using the pharmacy's own accounts (`owner-account`). Docs updated in `docs/procurement/` (assessment decisions 1-6, architecture rules, discovery protocol now includes login + cart).
- Limits kept: own account only, low rate, stop on CAPTCHA/block, credentials only in Worker secrets, supplier cart filled only after owner approves a draft, checkout stays human.
- #55 done by Kimi (run 42447687991) → draft PR #69. Claude review found 3 leaks (email/token in URL path, free text in sample values); fixed in `0bc33bc` with a permanent leak test. PR #66 now includes the `owner-account` kind.
- Next exact step: owner does the PharmaOverseas capture (#68) and sanitizes it with PR #69's tool; then Kimi builds `connectors/pharmaoverseas.js` (#56) from the sanitized output.

## Checkpoint 2026-11-08 — Claude (Technical Director): Supplier Integration epic started
- Branch `claude/nova-rx-supplier-integration-8pv5ix` (draft PR, base `main`). Docs only + workflow fixes; nothing deployed, nothing merged.
- Added `docs/procurement/ARCHITECTURE.md` (pipeline, connector contract, unified offer schema), `SUPPLIER_ASSESSMENT.md` (PharmaOverseas blocked on permission per PR #25; Aumet needs discovery + partnership request; DrugEye reclassified as reference catalog, not a supplier), `DISCOVERY_PROTOCOL.md` (Grok rules + owner permission-request template).
- Fixed `kimi-task.yml`: generic task prompt (was hard-coded to UX defects), excludes `node_modules` (run 42309042760 committed 71 node_modules files), PR base = dispatch ref so Kimi PRs stack on this branch. Added `.gitignore` node_modules and `procurement-unit.yml` CI.
- Known: Actions cannot create PRs in this repo (run 42309042760 pushed `kimi/issue-28-…-clean` but PR creation failed). Claude opens the draft PR manually from the pushed branch.
- Kimi run 42446526229 (dispatched from this branch, issue #54): about 5 minutes. It pushed `kimi/issue-54-42446526229-clean` (5 files, no node_modules) and failed only at PR creation, as expected. Claude re-ran the tests locally (both pass) and opened draft PR #66 with base = this branch.
- Epic #53; tasks #54 (in review), #55 to #62 (not started); Grok discovery #63 (Aumet) and #64 (DrugEye) wait for Grok. Owner actions: supplier permission requests; optionally allow Actions to create PRs.
- Next exact step: owner reviews #65/#66. Then label #55 (discovery sanitizer) `kimi-ready` and dispatch from this branch. Task 04 (normalization) follows.

## Checkpoint 2026-11-07 — Cloudflare deploy (nova-rx-preview)
- Deploy operator only: checksum-guarded KV staging keys `__nova_deploy_b64_0`…`_20`, then `final.js` multipart PUT with `keep_bindings: [secret_text, kv_namespace]`.
- Live: https://nova-rx-preview.elsousypharmacy.workers.dev/#sale — HTTP 200; markers present (`sale-screen sticker studio`, `nlMedTabs`, `#novaLabelsPanel`, `NOVA_STICKER_MODAL_PREMIUM_V95`).
- Deployment `c2488159-0f76-4848-87b9-35da280664f6` / version `33fe0516-2931-40cb-93a4-808e3c4f7724` @ 2026-11-07T01:57:40Z (100%).
- Bindings retained (names/types only): GEMINI_API_KEY (secret_text), NOVA_SECRET_ENCRYPTION_KEY (secret_text), NOVA_SECRETS_KV (kv_namespace).
- Evidence: `/cursor/stores/bc-38d259f0-fb6a-53af-98a3-a07d13177439/internal/releases/sale-sticker-merge-2026-11-07/deploy-result.json`.
- Next exact step: browser QA on live `#sale` sticker studio; no further Worker publish pending from this deploy batch.

## Checkpoint 2026-11-06 (uncommitted, per run instructions — no self-commit)
- Sale-screen sticker modal upgraded to the premium sticker-studio layout: `index.html` `#novaLabelsPanel` replaced (stepper, compact patient block with سنة/شهر age + حامل/رضاعة radios, med tabs with one visible editor, hero preview + selectable grid, collapsed print settings, approval-gated print bar). Standalone `sticker-studio.html` untouched; invoice-flow auto-open and Issue #4 new-sale close preserved.
- New `tests/sale-sticker-modal.mjs`: 21/21 PASS (desktop Chromium). `npm run check` PASS. Evidence: `reports/sale-sticker-modal.png`. Full details in `BUILD_REPORT.md` top entry.
- Not tested: tablet/mobile hand-held, real printer, live AI/Worker.
- Next exact step: review + commit this batch (index.html, tests/sale-sticker-modal.mjs, BUILD_REPORT.md, this file; do NOT commit `node_modules/`), then continue Issue #4 P1: UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile.

## Owner priorities and non-negotiables
- Phase 1: finish premium, responsive pharmacy POS frontend and UX. Database/backend integration comes later.
- Preserve the existing implementation and UX decisions. Never restart a task from scratch without checking saved work and explicit owner approval.
- **Kimi 2 is the default for routine UI coding, bug fixes and Playwright work; Kimi 3 only for demonstrably complex architecture or broad redesign.** This is a policy, NOT a verified statement of the currently configured runtime model.
- Kimi quota is precious: minimal file reads, narrow scope, small batches, no repetitive repo audits or unnecessary agent calls/tests.
- Keep credentials in secrets; never commit tokens, passwords, or keys.
- Do not merge or deploy without the established review/approval workflow.

## Current project context (verify live before acting)
- Repository: elsousypharmacy-create/nova-rx.
- Existing README describes desktop POS prototype, 72/28 invoice/customer layout, keyboard-first search, discounts and checkout.
- Active work tracked by issue #4: [Kimi TASK 002] remaining Grok-confirmed POS UX defects in batches. Areas: label panel blocking next sale, language switching/i18n, mobile FAB overlap, empty search, discount feedback, AI retry, product filter empty state, and size/reorder shortcuts. Strategy and statuses in `BUILD_REPORT.md`.
- Issue #2 (invoice template switch) and Issue #3 (README refresh) closed.
- Models (for reference; config may differ): Kimi k2-thinking via Groq default; Groq `openai/gpt-oss-120b` fallback. Web Search and Playwright MCP. Copilot for review only.

## Archived checkpoints (older history, kept for reference)

### NOVA ownership publication + first Kimi result — 2026-11-06
- Kimi ownership layer published at `docs/ownership.md`: rights/limits for owner vs manager vs coding agent; Kimi must not change workflows/secrets/migrations/deploy or merge; the manager must not execute code.
- Kimi current task: UX fixes batch 1 of 5 on `main` (from issue #4), target files index.html, style.css, BUILD_REPORT.md, tests/ux-batch1.spec.mjs; workflow `Kimi Task Runner` dispatches with explicit task_id.
- First Kimi run completed on main: run 42301231506 / PR #36 (branch `kimi/issue-4-42301231506-clean`). It implemented 4 of 5 UX defects: dual-search Enter/keyboard fix, discount button real-time feedback, AI failure banner with safe retry, product-filter empty state with recovery. It skipped the clear-sale blocked step by design (needed owner confirmation on cancel vs discard). It added test `tests/ux-batch1.spec.mjs` and documented in BUILD_REPORT.md.
- Local validation of that PR: `npm run check` PASS (9 unit/integration); new browser test needed a small local runner fix (fresh page per test + waitForFunction) and then PASS (7/7 on Chromium desktop, not mobile/tablet). It explicitly reports AI backend not tested and mobile/tablet not tested.
- Kimi commit hygiene: one commit `2f23c7f…` on the PR branch, files index.html, BUILD_REPORT.md, tests/ux-batch1.spec.mjs only. No merge yet: PR #36 remains open for owner/manager review.
- Kimi run limitation confirmed again: the run also failed to auto-create a PR (it logs HTTP 422 on the PR step) but successfully pushed the branch; the PR was opened manually. Follow-up removes brittlefixed10-review/4queued...