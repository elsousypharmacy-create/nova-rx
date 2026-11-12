# NOVA Rx — HANDOFF (living project state)

> **Start with `CURRENT.md`** (about 40 lines: priorities, who is on what, open PRs, breakages, what waits on the owner). This file is the history and evidence archive: read only the section for your task (search its issue or PR number, or read the last 60 lines), not the whole file. Nothing here is deleted.

Last documented: 2026-11-05 (Asia/Riyadh). This document is a handoff, not proof of current CI status. Verify GitHub before making changes.
## Checkpoint 2026-11-10 — Issue #117: Shortages-to-procurement mapping audit and isolated adapter
- Completed Issue #117: Shortages-to-procurement mapping audit and isolated adapter.
- Added files: worker/procurement/shortages-adapter.js, tests/unit/shortages-adapter.check.mjs, docs/erp/BUY-OPS_SHORTAGES_MAPPING_AUDIT.md.-
- Test results: PASS on contract & unit tests, NOT TESTED on live supplier cart writes per security guidelines.
- Procurement Module Summary: All procurement module tasks (#101, #111, #115, #116, #117) are now fully completed.
 ## Checkpoint 2026-11-10 — FND-03 domain model draft (Kimi, task 1/5, NOT committed)
- Created `docs/erp/FND-03_DOMAIN_MODEL.md` (DRAFT, docs only): entity/key/constraint map for tenant/branch/user/product/variant/unit/batch/stockMovement/invoice/payment/return/purchaseOrder/receipt/journal, document state machines, six invariants (mirroring FND-02 §4), single-writer source ownership until G1, synthetic JSON example, ten unsettled storage decisions (D1 vs Postgres pending FND-02 measurement, money representation, key shape, unit conversion, batch mandatoriness, receipt semantics, tax, customer key, …).
- Linked to FND-01 reality (current owner per entity: legacy system E / STOCK LIVE snapshot vs proposed NOVA master). Roadmap status unchanged (`queued`); no `verified`, no acceptance increase. No migrations, no DB, no code.
- Evidence: synthetic JSON block validated with `python3 -m json.tool` (exit 0); no JS created so `node --check` n/a; manual key/state consistency review. Full details in `BUILD_REPORT.md` top entry.
- Next exact step: ChatGPT reviews the draft; then delegation tasks 2/5–5/5 (queued). `DATABASE_SCHEMA.md` deep-read was out of scope this run.
## Checkpoint 2026-11-10 – Issue #101 test(BUY-04): add duplicate cart items and reload recovery tests for supplier orders
- Added automated QA tests for duplicate cart item handling and reload recovery for supplier orders (#101)
- Verified cart state recovery and idempotency upon reload.
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
- Active work tracked by issue #4: [Kimi TASK 002] remaining Grok-confirmed POS UX defects in batches. Areas: label panel blocking next sale, language switching/i18n, mobile FAB overlap, empty search, discount feedback, AI retry, product filter empty state, and smaller UX fixes.
- Workflow run 42033433619 had failed on a Kimi 5-hour quota limit, then its failed job was rerun. Rerun creates a new runner/session; uncommitted work from the failed runner is not automatically preserved. At last verification, the rerun's implementation step was in progress. **This is historical status, not a live claim.**
- Prior completed work includes issue #2 / PR #3, reportedly merged at commit 236dba1281972f99a0845e5e617c5d2bdefa0129. Verify current branches/PRs/commits before assuming a task is unfinished.

## Required agent protocol — ALL AI agents (ChatGPT, Kimi, Grok, others)
1. At start, read this HANDOFF.md and check current issue, branch, PR, commits, and CI status. Do not duplicate completed work.
2. Before work, state exact narrow scope, files to touch, expected result and token-conscious plan. Avoid broad exploratory reads.
3. **Every meaningful progress checkpoint must be written to HANDOFF.md and committed/pushed to GitHub**, including: completed work, changed files, commit/branch/PR links, tests and results, remaining work, blockers, and next exact action. Update before handing off, stopping, or hitting limits whenever possible.
4. If a task fails, times out, or hits quota, inspect commits/PR/checkpoints FIRST. Never rerun failed workflow jobs automatically. Ask owner before any potentially expensive restart.
5. Keep handoff updates factual and concise; distinguish verified facts from plans. Do not claim a commit or test passed unless confirmed.
6. Coordinate handoff edits carefully: fetch latest before writing, avoid overwriting another agent's updates; use separate branch/PR if concurrent edits conflict.

## Latest human decision
Owner explicitly requires **all AI-agent prompts/instructions to require writing progress to HANDOFF.md**. Kimi 2 default, Kimi 3 reserved for complex tasks. Protect Kimi usage and avoid repeating work.

## Next action
Verify latest state of issue #4, run 42033433619, and associated branches/PRs. Do not trigger a run merely to check. Continue only unfinished work from verified checkpoint.

## Agent checkpoint log
- 2026-11-05 — ChatGPT: Created project handoff and agent-wide checkpoint policy. No Kimi execution was started by this documentation change.

## Verified checkpoint — 2026-11-06 00:xx Asia/Riyadh (ChatGPT)
Source: owner-provided detailed 2026-11-05 chat handoff, cross-checked with GitHub PR #6, QA branch, and Cloudflare API. Treat owner handoff as context, not automatic proof of testing.

### Project and release separation
- NOVA Rx only: elsousypharmacy-create/nova-rx. Pharmacy dashboard elsousypharmacy-create/pharmacy is separate; do not mix.
- Live site: https://nova-rx-preview.elsousypharmacy.workers.dev/ on Cloudflare Worker nova-rx-preview. GitHub merge does NOT automatically imply Cloudflare deployment.
- Latest Cloudflare deployment observed via API: 2026-11-05T20:52:19.623635Z, deployment eb64f58a-825a-455d-b48c-96c2bdb9ff8a, version dbca6f13-6d77-4cdc-bdbd-d3ccc3cd43ff (100%). Prior deployment at 20:25:10Z. Content equivalence to GitHub and functional QA NOT verified. Do not assume latest deployment is the earlier labels-only fix.
- Cloudflare settings and secrets endpoints confirm GEMINI_API_KEY exists as secret_text. AI function is NOT verified; owner reports waiting then Arabic error 'تعذر توليد التعليمات' after retry. Diagnose without exposing secret.
- PR #6 merged into main as 4720ed801ada4d27cb95496d5ac44eaba34a2d56, addressing ONLY UX-LABELS-PANEL-BLOCKS-NEXT-SALE; Kimi reported 10/10 targeted and 21/21 regression tests. Independent live-browser QA remains unverified.
- PR #3 merged as 236dba1281972f99a0845e5e617c5d2bdefa0129 for issue #2. Grok's QA on earlier 85b8209 rated 64/100 and accepted five issue #2 fixes. qa/reports branch STATUS.md and QA_REPORT.md are STALE for latest deployment; do not treat them as current verification.
- Issue #4 still tracks remaining UX fixes; issue #7 tracks shared durable handoff/history. Do not rerun Kimi before checking progress and quota.

### Product priorities and UX owner decisions
- Phase 1 only: premium Black Edition, Arabic RTL, landscape-first desktop/tablet POS with responsive mobile. UX must be fast, uncluttered, coherent; no database/backend phase yet.
- NEXT and review/print-sticker flow: review confirmation next to print at final step, print gated until review; clear reload for AI failure; entered medicines survive refresh; no redundant helper lines, distracting green dot or poor-direction arrows.
- Remaining defects to verify on live deployed version: mixed languages, weak language switch, RTL, mobile FAB collision, empty search/filter states, discount feedback, AI retry, toasts, and navigation. No assumption that all are still present without testing.
- Agent responsibilities: ChatGPT plan/review/merge/deploy/verify; Kimi narrow coding with low token usage; Grok browser-only UX QA on exact deployed build; GitHub Actions Playwright. Flow: Kimi → ChatGPT review → merge → Cloudflare deploy → Grok browser QA → report → next batch.
- Roadmap: 1 UX/POS; 2 persistent database; 3 operations/admin; 4 expanded AI/automation; 5 commercial readiness. These are planned phases, not implemented claims.

### Next actions
1. Inspect latest Cloudflare deployment content and safely compare with GitHub; preserve Worker AI route/bindings and rollback.
2. Diagnose Gemini AI generation failure with actual response/log evidence; do not request key from owner.
3. Browser-test latest deployed version, including next-sale/labels and landscape UX, then prioritize only remaining defects.
4. Keep HANDOFF.md concise and add dated decisions/history under docs/; every agent must record tested/merged/deployed distinctions before handoff.

### Documentation discrepancy
The earlier 'Next action' above refers to issue #4 run 42033433619 and predates merged PR #6 and the Cloudflare deployments. This checkpoint supersedes that historical next action; preserve it only for audit history.

## Kimi checkpoint — 2026-11-06

### Scope completed in this session
- Read `HANDOFF.md`, `AGENTS.md`, open issues #4, #7, #8 and #9, open PR status (none), latest commits, and the owner-provided full technical handoff.
- Compared GitHub `main` with the live preview as far as available access allowed. GitHub `index.html` is older than the deployed Worker: the live rendered page contains the newer NOVA Labels flow, while GitHub does not contain `novaStickerApprovedLayoutV2` or Gemini Worker code.
- Added a safe Worker integration patch instead of overwriting the older GitHub HTML:
  - `worker/gemini-label-service.js` — dynamic Gemini model discovery with 10-minute cache, text-model filtering, strict JSON with compatibility fallback, bounded model retries, finish-reason/truncation rejection, robust JSON parsing, and medication-instruction completeness validation.
  - `worker/sticker-print-settings.js` — approved label presets, custom dimensions, paper layout, style, margins, orientation, copies, local-only persistence, preview geometry, and `@page` CSS generation.
  - `worker/README.md` — safe live-Worker merge instructions and deployment warning.
  - `docs/WORKER_SYNC_STATUS.md` — verified sync findings, access limitations, blockers, and rollback path.
  - `tests/unit/gemini-label-service.check.mjs` — deterministic mocked regression checks.

### Tests run locally
- `node tests/unit/gemini-label-service.check.mjs` — passed.

### Blockers and non-claims
- No Cloudflare token/Wrangler session is available here, so the live Worker was not modified and nothing was deployed.
- Direct live-site access timed out from this sandbox; live content was checked through an external reader only. Full browser QA remains required.
- The owner-supplied official logo source image is not available here; no substitute logo was created.
- These changes are GitHub-side integration code only until ChatGPT merges them into the current live Worker source and deploys a reviewed preview.

### Next exact action
Create a dedicated branch and PR for this patch. ChatGPT should review, merge only after confirming the branch does not overwrite live Worker UI, then merge the Worker service into the current Cloudflare source and run live browser QA.

## Kimi checkpoint — 2026-11-06 sticker studio redesign

### Scope completed in this session
- Read the owner-provided sticker UX/UI redesign handoff.
- Verified current GitHub `main` after PR #10 merge at `e7ffd528aafd49dbd390d8227ce0c0b575c92aac`.
- Confirmed no open PRs before starting the redesign branch.
- Confirmed the uploaded material did not include the official logo image file; the redesign keeps the existing owner-controlled logo URL and does not invent a substitute.
- Added `sticker-studio.html` as a safe standalone premium sticker workflow instead of overwriting the stale GitHub `index.html` or the newer live Worker UI.
- Added `docs/STICKER_STUDIO_INTEGRATION.md` with integration and logo notes.
- Added `tests/unit/sticker-studio.check.mjs` for static regression coverage.

### Implemented in `sticker-studio.html`
- RTL Arabic premium sticker workflow using Cairo.
- Patient fields, invoice queue, manual medication entry and editable medication cards.
- Per-medication AI regeneration through `/api/ai/medication-label`.
- AI loading/error states that preserve drafts.
- Incomplete medication drafts remain review-required and cannot print.
- Pharmacist approval gate.
- Required print presets, custom dimensions, paper layout, full/compact styles, margins, orientation, copies, test print, local persistence and physical-size preview.
- Print window generates clean labels with `@page` dimensions.

### Tests run locally
- `node tests/unit/sticker-studio.check.mjs` — passed.
- Inline JavaScript extracted from `sticker-studio.html` and checked with `node --check` — passed.

### Blockers and non-claims
- GitHub `index.html` was not replaced because the live Cloudflare Worker is newer and its source is unavailable here.
- No Cloudflare deployment was performed.
- Full tablet/mobile/browser QA remains required after integration into the current live Worker source.
- Official logo source image remains unavailable in this environment.

### Next exact action
Create a dedicated branch and PR containing the standalone sticker studio, tests and integration notes. ChatGPT should review and integrate it into the reconciled live Worker source, then deploy a preview for Grok UX QA.

## ChatGPT checkpoint — 2026-11-06 Sticker six-layout (in progress)
- Issue #14. Feature branch `fix/sticker-six-pager-20261106`.
- Committed `sticker-six-layout.css`, `docs/STICKER_SIX_IMPLEMENTATION.md`, `tools/apply-sticker-six.py`, and `.github/workflows/integrate-sticker-six.yml`.
- Workflow is intended to patch `sticker-studio.html` and run Node syntax checks on the feature branch only. At last read, `sticker-studio.html` on the branch was still unchanged; workflow success is NOT verified.
- Not merged, not deployed to Cloudflare, no browser QA. The live Worker may differ from GitHub standalone HTML.
- Next: inspect Actions result; fix any patch/test failure; verify six-label paging and safety gates; PR review; reconcile live Worker before deployment.

### Sticker integration update — 2026-11-06
- Integrated `sticker-studio.html` directly on feature branch at commit `6098f85`: age unit, mandatory pregnancy/breastfeeding yes/no, 6-per-page preview, pager/swipe, label selection and print gate. CSS lives in `sticker-six-layout.css`.
- Disabled automatic patch reapplication in workflow at `bc491b0` to avoid overwriting integrated HTML.
- Pull request creation failed internally. No independent browser/print tests confirmed, no merge and NO Cloudflare deployment. Next: run browser tests and reconcile with live Worker source, then open PR/merge/deploy.

## Claude checkpoint — 2026-11-06 Sticker Studio UX redesign (UI only)
- Scope: `sticker-studio.html` (markup + UI-only JS) and `sticker-six-layout.css` (fully rewritten, now the single source of layout/styling; the old "fixed-screen" and "focus mode" override layers are gone). Print popup, validation rules, AI call, storage keys, backend: unchanged.
- Layout: compact patient card (age years/months segmented control, required pregnancy/breastfeeding as segmented answers) + medication tabs (1..N, status dot, "+ دواء") with ONE focused editor + large sticky hero preview of the active sticker + 3x2 thumbnail strip (click = select/deselect for print) + fixed bottom bar (pharmacist approval, copies, print selected/all, buttons look blocked until approved but still clickable so the toast explains why) + print settings in a drawer (opens from "إعدادات الطباعة", Esc/scrim closes, focus trap). The old 85% width constraint was removed (max 1480px).
- Behaviour kept for tests: `.sticker-preview` per sticker (6/page, pager only shown when >1 page), `[data-med-id]` toggles selection, `.med-card[data-id]` with `data-field` inputs, `#ageUnit` is now a hidden input driven by the segmented buttons, fixed `.app` height on >=901px.
- Added UI-only: stepper reflects real progress (done/active), hero "text may be longer than the sticker" chip (approximate overflow check), print validation scrolls to the unanswered safety question / jumps to the first incomplete medicine.
- Verification: static checks pass (`node tests/unit/*.check.mjs`, syntax check). Ran a Python-Playwright port of the browser checks in headless Chrome (65 checks: pager, selection, approval revoke, print popups, AI mock/stale guard, tabs, age toggle, drawer, no horizontal overflow, bar visible at 1024x768, 1180x820, 1366x768, 1440x900, 834x1112, 390x844): 64 pass; the 1 "fail" is the console 500 from the test's own mocked AI error. The repo's Node `tests/sticker-studio-browser.mjs` was NOT run (no node_modules/network here). Cairo font and the logo URL were blocked in the sandbox, so real typography/logo not verified.
- Known open item (needs owner decision, not changed): preview font metrics mirror the print window rules, but at small presets (e.g. 40x30/50x30) complete text may still be clipped by the print window's own clip check; verify on the real printer. Not deployed to Cloudflare; GitHub push does not imply deployment.
- Next exact step: owner opens the Worker after deploy, sends phone/tablet screenshots; fix anything visual found there.

## Cursor worker checkpoint — 2026-11-06 PR #29 sale sticker follow-through

Branch: `chore/sale-sticker-modal-clean` (draft PR #29). No merge. No deploy. Screenshots skipped per Ahmed.

### Fixes pushed on this checkpoint
- `.github/workflows/playwright-smoke.yml`: pin `runs-on: ubuntu-24.04` (Playwright 1.58.2 cannot install Chromium deps on ubuntu26.04-x64 from `ubuntu-latest`).
- `tests/nova-pos-smoke.spec.cjs`: force `nova-rx-language=en` so English placeholder assertions do not flake under Arabic default.
- `index.html`: sync `dataset.novaOriginalplaceholder` in `setSearchMode`; Arabic map for product placeholder; mobile ≤900px stacked columns content-sized (stop editor spill overlapping preview clicks); wrap/clamp action-bar print actions to stop horizontal overflow.
- `tests/sale-sticker-modal.mjs`: extended desktop + tablet-landscape (1180×820) + mobile (390×844) checks and print-gate path (`window.open` → popup toast).

### Verification (local, this session)
- `CHROME_PATH=/usr/bin/google-chrome node tests/sale-sticker-modal.mjs` — PASS (desktop / tablet-landscape / mobile).
- `npx playwright test tests/nova-pos-smoke.spec.cjs` — PASS locally after fixes.
- CI status after push must be re-checked on GitHub Actions; do not claim green until the new run completes.

### Viewport / print honesty
- Desktop: PASS
- Tablet landscape: PASS
- Mobile: PASS (after mobile CSS fixes)
- Print path: PASS through validation + popup-blocked toast only. Real `window.print` / OS print preview / physical printer: NOT TESTED.
- Live Gemini AI warnings content: NOT TESTED (no API exercise here).

### Remaining UX notes
- Small sticker presets can still clip long instruction text in the print window (pre-existing).
- Cairo/logo fidelity and real-device touch QA still need owner/device confirmation after any future deploy.
- Do not mark PR ready until CI smoke is green on the latest push.

### Next exact step
Wait for Actions on the pushed commit; if smoke is green keep draft for Ahmed review; no merge/deploy.

### CI confirmation — 2026-11-06
- Commit `6f28bdd` on `chore/sale-sticker-modal-clean`: Playwright POS smoke **SUCCESS** on ubuntu-24.04.
- Run: https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42312203852
- PR #29 remains **draft**. Not merged. Not deployed. Not marked ready-to-merge.

### UX batch 1 — 2026-11-07 (Claude Code)
- Branch `claude/nifty-albattani-ka1ifs-ux` (draft PR): `index.html` i18n direction fix + delegated language buttons + sticker button off the checkout bar on phones; `tests/ux-batch1.mjs` (29 checks). Details in `BUILD_REPORT.md`.
- Evidence: new test fails 15 checks on old `index.html`, passes on the fix; all earlier browser tests and the CI smoke test pass locally.
- NOT merged, NOT deployed. The live Worker embeds its own HTML: carry this change into a patched export (see `docs/UX_BACKLOG.md` deployment warning), do not overwrite it with GitHub's `index.html`.
- Next exact step: owner review; then batch 2 (search/discount/AI-retry/products-filter empty states).

### Live Worker vs repo — finding while preparing UX batch 1 deploy — 2026-11-07 (Claude Code)
- The live Worker `nova-rx-preview` (version 33fe0516…) embeds an OLDER lineage of `index.html` than `main`: ~430 lines differ. It lacks earlier fixes (issue #2 i18n: pageerror `novaOriginalaria-label` DOMStringMap; older draft persistence; search overlay) and has live-only parts not in the repo: Settings «API keys» card (`/api/settings/secrets`), `x-nova-ai-key` + `/api/ai/purchase` fetch, WhatsApp nav injection (`nova-wa-nav`, `/whatsapp-inbox.html`), hash routing tweak, a different sale sticker modal (`#nlSimple`, PR29 merge marker).
- The UX batch 1 diff applies cleanly onto the live HTML, but `tests/ux-batch1.mjs` then fails 5 checks (the old i18n bug and extra Arabic strings in live-only UI). So patching the live HTML is not enough.
- Needed before any UX deploy: one controlled sync: start from `main`+PR #34 `index.html`, re-apply the live-only parts above, replace only the app HTML literal in the Worker (routes/bindings untouched), run `tests/ux-batch1.mjs` on the final HTML, keep rollback = version 33fe0516-2931-40cb-93a4-808e3c4f7724.
- NOT deployed. No tool in this session can publish to Cloudflare.

### UX batch 1 — deploy-ready Worker built — 2026-11-07 (Claude Code)
- `worker/live/nova-rx-preview.with-ux-batch1.js` = the live Worker export with ONLY the app HTML string literal changed: (1) fixed i18n script (directional dictionary, delegated language buttons, mixed-label table, extra EN strings for live-only Settings API-keys card and purchase button), (2) sticker button label + mobile position, (3) one live bug fixed: unquoted `aria-hidden="true"` inside the `nsGalleryNext` script string (SyntaxError, script never ran). All routes, bindings and live-only parts (API keys card, `/api/ai/purchase`, WhatsApp nav, `#nlSimple` sticker panel) are untouched.
- `worker/live/nova-rx-preview.export-20261107.js` = unmodified export for rollback (live version `33fe0516-2931-40cb-93a4-808e3c4f7724`, modified 2026-11-07T01:57:40Z, re-checked unchanged).
- Evidence: `node --check` OK; vm run: `/` 200 with the new HTML, `/api/settings/secrets` unauthenticated 403, `/whatsapp-inbox.html` 200; `tests/ux-batch1.mjs` on the embedded HTML with `UX_SKIP_EXTRA='#nlSimple'`: ALL PASS; FAB click opens the live sticker panel, 0 page errors.
- NOT deployed (no Cloudflare write tool in this session). Owner asked for deploy; deployer: Cursor (same method as the 2026-11-07 deploy, `keep_bindings` secret_text + kv_namespace, checksum-guarded).
- Known/accepted: the live sticker panel (`#nlSimple`) and purchase panel stay Arabic-only in English mode (clinical Arabic labels).

### UX batch 1 — update — 2026-11-07 (Claude Code)
- New fix: UX-HELD-PANEL-OFFSCREEN (held invoices panel opened below the screen; `top:auto` now). Included in `index.html` and in the Worker file.
- SUPERSEDES the earlier Worker checksum: `worker/live/nova-rx-preview.with-ux-batch1.js` sha256 `20d2c89294069845d624f3688283e072506e8d5b58ae0b78813a37ee6ae239fa` (rollback export unchanged: `8f12b9f0…526673`).
- Tests: `tests/ux-batch1.mjs` 39 checks PASS on repo `index.html` and on the HTML embedded in the Worker (`UX_SKIP_EXTRA='#nlSimple'`); earlier browser tests and CI smoke still PASS.
- Impeccable (`npx impeccable detect`, static, run in an isolated copy): 9 findings recorded in `docs/UX_BACKLOG.md`. Other third-party skills from social media were NOT installed.
- Still NOT deployed.

### Coordination protocol (Claude Code ↔ Cursor ↔ owner) — 2026-11-07
- Owner view: pharmacy repo `nova-status.json`, shown by `nova-monitor.html` on the owner's dashboard (roadmap, current cycle, tasks, blockers). Merged in pharmacy PR #39; data-only edits show on GitHub Pages in ~2 minutes. Whoever finishes a step updates it (honest statuses: `queued`, `in_progress`, `for_review`, `blocked`, `done`; no invented percentages).
- Agent view: this `HANDOFF.md` (facts, commit/PR, test evidence, next exact step) and `reports/agent-progress.json`.
- Hand-offs: Claude Code writes code and tests, then comments on the PR for Cursor with the file, checksum, rollback and checks. Cursor deploys (Claude Code has no Cloudflare write tool) and writes the new version id back here.
- Current step: Cursor to deploy the UX batch 1 Worker build from PR #34 (comment with sha256 `20d2c892…39fa`), then the owner tries the live link on a phone.
### Guarded deploy workflow — 2026-11-07 (Claude Code)
- Because ChatGPT, Cursor and Claude Code could each not deploy (no Cloudflare write tool / no proof of binding-keeping / API token not savable from the phone app), added a one-button deploy: `.github/workflows/deploy-worker.yml` + `.github/scripts/deploy_worker.sh` + `docs/DEPLOY_WORKER.md` (draft PR). Needs: merge to `main`, GitHub secret `CLOUDFLARE_API_TOKEN` (template «Edit Cloudflare Workers»), then dry run, then real run.
- Tested only against a fake Cloudflare API (`tests/deploy-worker/run.sh`, 17 checks). NOT run against the real Cloudflare API. Nothing deployed.

### UX batch 2 — 2026-11-07 (Claude Code)
- Branch `claude/nifty-albattani-ka1ifs-ux2` (stacked on `…-ux`, PR base = the batch 1 branch): discount warnings, empty states, AI retry, translated search empties. Details in `BUILD_REPORT.md`.
- Deploy-ready Worker with batches 1+2: `worker/live/nova-rx-preview.with-ux-batch1-2.js`, sha256 `1123d40c6fcb0c01cf4089db73f8f0a034e1eb1d6bdf72024308c04dbb046c3a`. It supersedes `with-ux-batch1.js` (`20d2c892…`). Rollback export unchanged (`8f12b9f0…526673`, live version `33fe0516-…`; live Worker re-checked unchanged since 2026-11-07T01:57:40Z).
- Evidence: `tests/ux-batch1.mjs` and `tests/ux-batch2.mjs` pass on repo `index.html` and on the HTML embedded in the Worker; vm run `/` 200, `/api/settings/secrets` unauthenticated 403, `/whatsapp-inbox.html` 200.
- NOT deployed. Next exact step: Cursor deploys the batch 1+2 file; owner tries the live link; then batch 3.

### Coordination board and roles — 2026-11-07 (Claude Code, owner request)
- All agents read and update GitHub issue #36 «[Coordination] NOVA Rx: current state and who does what» (state table, roles, rules, and a ready prompt each for ChatGPT and Cursor). Comment there after every step.
- CHANGE of roles for the UX deploy: ChatGPT deploys the batch 1+2 artifact (deploy only, no edits); Cursor does NOT deploy, it runs QA on the live link and keeps `nova-status.json` (pharmacy repo) honest; Claude Code writes code/tests. Supersedes the earlier "Cursor deploys" comments on PR #34.
- Still paused: WhatsApp (number on the sunset On-Premises API), Kimi (never run). Nothing merged or closed without the owner.

### DEPLOYED — UX batches 1+2 live — 2026-11-07 (Claude Code, owner-approved)
- Deployed with the guarded workflow `deploy-worker.yml` (PR #37, merged), run https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42357521827. `nova-rx-preview` modified_on `2026-11-07T08:55:46.92003Z`.
- Proof: live script sha256 re-read from Cloudflare = `1123d40c6fcb0c01cf4089db73f8f0a034e1eb1d6bdf72024308c04dbb046c3a` (= `worker/live/nova-rx-preview.with-ux-batch1-2.js` @ `116a4a6`). Bindings and compatibility settings unchanged. The dry run before it showed the pre-deploy live code was byte-identical to `worker/live/nova-rx-preview.export-20261107.js` (`8f12b9f0…526673`).
- Rollback: Cloudflare version `33fe0516-2931-40cb-93a4-808e3c4f7724` (or that export file).
- NOT merged: PRs #34 and #35 (owner decision). Live and `main` differ on purpose (live HTML is a different lineage).
- Next exact step: Cursor QA on the live link (issue #36), owner tries it on a phone, then UX batch 3. Owner to delete the Cloudflare API token and the GitHub secret `CLOUDFLARE_API_TOKEN`.
- To continue in a fresh session: read issue #36, this file, `docs/UX_BACKLOG.md`, `docs/DEPLOY_WORKER.md`.
### WhatsApp bridge → encrypted secrets + header auth — 2026-11-07 (Claude Code)
- `integrations/whatsapp/secure-bridge.mjs` now reads `WA_BACKEND_URL` / `NOVA_WA_BRIDGE_TOKEN` from the same encrypted KV store as `/api/settings/secrets`, and accepts Cloudflare Access JWT or (opt-in) the Access email header. Fails closed. Speaks the existing Apps Script `novaWhatsAppBridge` protocol.
- Test: `tests/unit/whatsapp-bridge.check.mjs` PASS (fake KV with real AES-GCM format, fake Apps Script). Not run against the live Worker or real Apps Script.
- NOT done: Worker not changed or deployed; inbox page not restyled to Black Edition. Wiring guide: `integrations/whatsapp/README.md`.

### Live Worker export + patched copy — 2026-11-07 (Claude Code)
- `worker/live/nova-rx-preview.export-20261107.js`: unmodified export of Worker `nova-rx-preview` (read via Cloudflare MCP; scanned, no secret values). Use as rollback.
- `worker/live/nova-rx-preview.with-whatsapp.js`: same code + `/api/whatsapp/*` route (bridge, namespaced in `NOVA_WA_BRIDGE`) + real inbox page replacing the placeholder. `node --check` OK; `tests/unit/worker-live-patch.check.mjs` PASS in a vm with fake bindings.
- NOT deployed. Deploy by owner via Cloudflare dashboard (Edit code keeps bindings) after the bridge token and WABA steps.

### WhatsApp — PAUSED by owner — 2026-11-07 (Claude Code)
Root cause (verified via Graph API Explorer): pharmacy number +20 11 43404023 (phone id 515646411625617, WABA 505759262610446) is `platform_type=ON_PREMISE`, `status=DISCONNECTED`. On-Premises API was sunset; `POST /{phone}/register` returns code 100 "Register endpoint is not available". Tokens/IDs in NOVA and bot were not the cause. The bot's defaults (phone 1321594684378624, WABA 1121417500291242) belong to Meta's TEST number (+1 555 673 1935). `2072879990013917` is NOT a WABA (Business Suite presence page id).
State: bot dashboard has WABA ID field (pharmacy PR #38, merged) and WABA 505759262610446 saved; webhook link for the real WABA returned OK. NOVA bridge + patched Worker ready but NOT deployed (PR #33 draft, `worker/live/`). Support ticket via Meta Direct Support NOT confirmed opened.
Resume only when: Meta migrates the number to Cloud API (platform_type CLOUD_API, CONNECTED) or a new Cloud API number exists. Then: set WA_PHONE_ID + permanent token in bot dashboard, set NOVA_WA_BRIDGE_TOKEN (>=32 chars) in Apps Script and NOVA secrets, deploy `with-whatsapp.js`.
Do not: deregister the number, change its PIN, or pick the test account in support forms.
### PoC-0 isolated Kimi workflow — 2026-11-07 (Claude Code)
- Branch `claude/nifty-albattani-ka1ifs`: adds `.github/workflows/poc-kimi.yml` and `.github/scripts/poc_check_patch.py`. `kimi-task.yml` and other workflows unchanged.
- Manual dispatch only, issue must be #31, jobs gate → execute (read-only, no saved git creds) → validate (no secrets) → publish (write, no Kimi key, runs no patch code). Allowlist fixed in the workflow.
- Local evidence: gate accepted a good patch and rejected extra file, symlink, exec bit, removed report lines, binary, child_process import, credential string, rename; runtime step rejects a test that prints PASS on a broken manifest.
- NOT run on GitHub. Kimi not started. No labels changed. Not merged. Not deployed.
- Next exact step: owner reviews draft PR and Kimi cost; only then merge to main and dispatch with issue_number=31.

### Kimi PoC workflow merged (inert) — 2026-11-07 (Claude Code, owner asked for all merges)
- `poc-kimi.yml` (+ `.github/scripts/poc_check_patch.py`) is now on `main`. It only runs by manual dispatch for Issue #31 and has NEVER been run. Do not dispatch it before the owner has confirmed the Kimi key type, Extra Usage and Actions minutes. Labels `kimi-run-now` on issues #4, #16, #17, #28 are untouched: do not re-trigger them.

### All of Claude Code's PRs merged — 2026-11-07 (owner request)
- Merged into `main` with merge commits, in this order: #34 (UX batch 1), #35 (UX batch 2), #33 (WhatsApp bridge, not deployed), #32 (Kimi PoC workflow, never run). #37 (guarded deploy workflow) was merged earlier. Smoke CI on `main` passed after #34, #35 and #33.
- `main` now has the UX fixes in `index.html`, but the LIVE Worker runs its own HTML lineage (deployed 2026-11-07T08:55Z from `worker/live/nova-rx-preview.with-ux-batch1-2.js`). They differ on purpose: never deploy `index.html` over the Worker.
- NOT merged (not Claude Code's, owner did not ask): #18, #19, #20, #21, #23, #25. #21 and #23 duplicate #24 (already in main); #18 and #20 overlap and #20 edits `index.html` (would conflict); #19 and #25 are old docs. Owner decides which to close.
- Stale warning: `worker/live/nova-rx-preview.with-whatsapp.js` is NOT a deploy candidate (see `integrations/whatsapp/README.md`).

### UX batch 3 — 2026-11-07 (Claude Code)
- Branch `claude/nifty-albattani-ka1ifs-ux3` (draft PR): tablet/desktop polish, see `BUILD_REPORT.md`. Owner: tablet or computer is the main device, so the phone layout is deferred.
- Deploy-ready Worker build: `worker/live/nova-rx-preview.with-ux-batch1-3.js` sha256 `6d2d4575e67c1686950f5337b89158d1e9ec22a4269d5dfc5d7e0bf517399b0b`, 649,196 bytes, git blob `cdb07f1b77cf3c71f0fa291ac49bca5a18d788ad`. Built on top of the code deployed live at 2026-11-07T08:55:46Z (`…with-ux-batch1-2.js`, sha256 `1123d40c…`); only the app HTML literal differs.
- To deploy: new Cloudflare token + repo secret `CLOUDFLARE_API_TOKEN` (the first one should have been deleted), then Actions > Deploy NOVA Worker with `artifact_ref` = the merged commit or branch, `artifact_path` = the file above, `sha256` = the value above, `expected_modified_on` = `2026-11-07T08:55:46`, dry run first. Rollback = the previous live code (the workflow backs it up); version history in Cloudflare.
- Evidence: `ux-batch1/2/3` all pass on repo `index.html` and on the HTML embedded in the Worker; vm run `/` 200, `/api/settings/secrets` unauthenticated 403, `/whatsapp-inbox.html` 200. NOT deployed.

### Sticker one-screen flow — 2026-11-07 (Claude Code, owner-approved design)
- Branch `claude/sticker-oneclick` (stacked on batch 3, draft PR). Owner feedback: the sale-screen sticker flow had too many steps. New flow: all medicines as cards on ONE screen, one button «راجعت N أدوية وطباعة» (the tap is the pharmacist approval; pregnancy/breastfeeding answers and complete medicines are still required, the bar says why it is blocked). Stepper, medicine tabs, separate approval box, thumbnail grid and settings drawer are gone from the main view (preview and settings are collapsed under «معاينة…», size link «50×30 مم · تغيير» opens the settings).
- Printing: hidden iframe instead of a popup window, waits for the font, shrinks text down to 5.5pt, and REFUSES (clear message) when the text still does not fit: clipped text is never printed. Focus returns to the page after printing.
- Files: `index.html`, `tests/sale-sticker-modal.mjs` (rewritten for the new flow, 3 viewports), `tools/build-worker-artifact.mjs` (replaces ONLY the app HTML literal of a Worker export), `worker/live/nova-rx-preview.with-ux-batch1-3-stickers.js` sha256 `ba06d59b0bd9bc3fec65b49445f1f6a611a9ba9af303b764303b66d6153ded89` (base = the deployed batch 3 file `6d2d4575…`; everything outside the HTML line is byte-identical).
- Tests (headless Chromium, this session): `sale-sticker-modal`, `ux-batch1/2/3`, `issue-2-acceptance`, `issue-4-labels-panel`, `npm run check` pass on repo `index.html`; `sale-sticker-modal` and `ux-batch1/2/3` also pass on the HTML embedded in the Worker file (`UX_SKIP_EXTRA='#nlSimple'`); vm run: `/` 200, `/api/settings/secrets` unauthenticated 403, `/whatsapp-inbox.html` 200.
- NOT tested: real printer and paper, Cairo font on the print frame (offline here), iOS/Android print dialogs from an iframe, live AI, the CI smoke test (`nova-pos-smoke.spec.cjs`, not run locally). Text-length thresholds are approximate; the print-time fit check with the real font is the real guard.
- NOT merged, NOT deployed. Next exact step: owner tries the new screen and prints one real sticker; then merge and the guarded deploy (new token needed).

### DEPLOYED — one-screen sticker flow live — 2026-11-07 (Claude Code, owner-approved)
- Guarded workflow run https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42372912050 (dry run 42372880589 first). `nova-rx-preview` modified_on `2026-11-07T12:32:14.721816Z`; live script sha256 re-read = `ba06d59b0bd9bc3fec65b49445f1f6a611a9ba9af303b764303b66d6153ded89` (= `worker/live/nova-rx-preview.with-ux-batch1-3-stickers.js` @ `claude/sticker-oneclick`). Bindings unchanged. No rollback needed.
- Rollback: batch 3 build `worker/live/nova-rx-preview.with-ux-batch1-3.js` (sha256 `6d2d4575…399b0b`), or Cloudflare version history.
- PR #39 and #40 NOT merged. Live and `main` differ on purpose.
- Next exact step: owner prints a real sticker with a long dose (printer, paper, Cairo font, tablet print dialog are untested); then merge #39/#40 and delete the Cloudflare token and `CLOUDFLARE_API_TOKEN` secret.

## Checkpoint — sticker flow v2 (faster, tablet-sized) — NOT DEPLOYED
- Invoice medicines load automatically; age has no silent default; AI runs by itself once age + pregnancy + breastfeeding are answered; compact cards so 2-3 medicines fit on a 1194x834 tablet without scrolling.
- Artifact: worker/live/nova-rx-preview.with-ux-batch1-3-stickers2.js sha256 7b85c9ef17e38849bdcb325ff3179bcc950235625d0166f8147da7d2fbe3e368 (base = deployed ...stickers.js; expected_modified_on 2026-11-07T12:32:14).
- Tests pass on repo HTML and HTML extracted from the new artifact. Route check OK (/ 200, secrets 403, whatsapp 200).
- Needs owner approval before deploy (dry run first).

## DEPLOYED — sticker flow v2 (2026-11-07, run 42375318941, dry run 42375252302 passed)
sha256 7b85c9ef…e368. Rollback: previous artifact worker/live/nova-rx-preview.with-ux-batch1-3-stickers.js.

## Checkpoint — v3 (not deployed): fixed-height modal + no stale draft restore
Tablet photo showed age 6 + old safety answers + blank medicines = old saved draft restored from localStorage. load() no longer restores the draft (settings still restored). Artifact: worker/live/nova-rx-preview.with-ux-batch1-3-stickers4.js sha256 c75a89208d985ec5e1465595c3361a397cf53ba1aa440098e2777908dca54fb5 (window 880px wide x ~720px high). Base = live code from v2 deploy (read expected_modified_on from Cloudflare/last deploy log). Needs owner approval.

## DEPLOYED v3 (window 880x720, no stale draft) 2026-11-07, sha256 c75a8920…4fb5. Rollback: ...stickers2.js

## Checkpoint v4 (not deployed): browser form-restore fix
Tablet showed age 6 after reload = Chrome restoring old form values. Added autocomplete=off on patient inputs + pregnancy/breastfeeding radios and a pageshow resync. Artifact ...stickers5.js sha256 3305b1dd93202256f120384fa0cae9b33f7a82ad42382e1856e9872ae5a23f3e; base for expected_modified_on = 2026-11-07T13:44:23 (v3 deploy). v3 artifact (stickers4) was removed from repo; rollback = ...stickers2.js.

## DEPLOYED v4 2026-11-07 (run 42401462000): form-restore fix. modified_on 2026-11-07T18:28:38. sha256 3305b1dd…3f3e. Rollback: ...stickers2.js

## Checkpoint v5 (not deployed): real cause of age 6 = load() default age=6 (removed). Manual open (✦ استيكرات الأدوية button) now loads the open cart via window.novaCartItems. Artifact ...stickers6.js sha256 2bdf364406693f0deb611927bc62a1062da68d9bc93c8e15e3b55fd58bfcb443; expected_modified_on 2026-11-07T18:28:38. Rollback = ...stickers2.js

## DEPLOYED v5 2026-11-07 (run 42402291931), modified_on 2026-11-07T18:38:40. Owner standing instruction: deploy NOVA updates on my own after tests pass (dry run first), then report.


## Checkpoint — sticker screen v2 + faster/safer Gemini (Claude Code, 2026-11-07) — see PR
- Owner feedback driving this: screen felt visually noisy (colours/emoji outside the Black Edition palette), AI "hangs"/looked broken, wanted a table (like the POS table), a patient-condition box for the AI, controller-style customer buttons.
- UI (index.html, >=700px): table of medicines (Medicine | Dose | Frequency | Duration | Instructions | Status), only exceptions coloured (amber missing, red warning/failed), app palette only, line icons (duotone) for adult/child/pregnant/nursing, "Patient condition" box + quick chips, interactions banner, note "doses are AI suggestions - review before printing". Phones (<700px) unchanged.
- Client AI: ONE batch request (`/api/ai/medication-labels`) instead of one per medicine; 16s client timeout; readable Arabic error reasons ([CODE status]); "generate again" button.
- Server (worker/gemini-label-service.js, embedded in the Worker by `tools/patch-worker-gemini.mjs`): discovery timeout 6s with fallback model names; max 2 models; 9s per model, 22s overall deadline; no same-model retry on timeout; thinking off (thinkingBudget 0, dropped on a 400); new batch route; patient `condition` (max 400 chars, treated as data) reaches the prompt; prompt now lets the AI PROPOSE usual dose/frequency/duration (null + missingInformation when unsure) and requires warnings for allergy/pregnancy/age; error `details.status` is now the numeric HTTP status (`geminiStatus` keeps Google's string).
- Root cause found for "AI looks broken": the old prompt forbade proposing any dose not already typed, so results were always "incomplete"; plus up to ~160s of sequential fallbacks with no timeout on model discovery.
- Tests: tests/unit/gemini-batch.check.mjs (new), gemini-label-service.check.mjs, worker-gemini-route.check.mjs <artifact> (vm run of the real Worker file), tests/sticker-list-edit.mjs (rewritten: table, one request, condition, error), ux-batch1/2/3, issue-4-labels-panel. `sale-sticker-modal` still stops at the print step in the sandbox (font offline).
- Artifact: worker/live/nova-rx-preview.with-ux-batch1-3-stickers15.js (base = live stickers14). NOT tested: real Gemini (no key in sandbox), real printer, real tablet.
- Next exact step: owner tries a multi-medicine invoice with the real Gemini and reports the row messages; if a key error shows, replace the GEMINI_API_KEY secret.


## Checkpoint — sticker screen polish: safe frame, child flow, warning acknowledgment (Claude Code, 2026-11-08)
- Safe frame (>=700px): the window keeps >=32px left/right, >=24px top, >=28px bottom (plus env(safe-area-inset-*)), fills the screen height (max 940px) instead of a fixed 720px. Measured on 1024x768, 1080x810, 1180x820, 1194x834, 1280x800, 1366x1024, 834x1194, 820x1180.
- Two columns from 900px (was 1100px): 1024x768 / 1080x810 tablets no longer fall back to the stacked layout that hid the table.
- Child: age and weight (both required) appear right under the 4 buttons, start empty (no leftover adult 30), the AI waits for them; "weight unknown" button lets it run with a server-side prompt rule (approximate dose by age + mandatory warning). Table stays quiet (dashes, "waiting for customer data") until there is data.
- Warnings: a red-warning row must be opened and closed once ("reviewed") before printing; changed warnings must be re-read.
- Smaller things: error code shown small/dim, retry button only for total failures, hint hidden after typing, preview toggle is a link, age field no spinner/example 30.
- Tests: sticker-list-edit now 86 checks (child flow, warning gate, 7 viewports frame/table/print button), gemini-batch (+weightUnknown), worker-gemini-route on the artifact, ux-batch1/2/3, issue-4. Artifact worker/live/nova-rx-preview.with-ux-batch1-3-stickers16.js (base stickers15).
- NOT tested: real Gemini, real tablet/printer, iOS safe-area behaviour on a real device (emulated paddings only).

## Checkpoint — special-case chips + layout fix (stickers17)
- «حالة المريض»: extra grouped chips behind "حالات تانية ▾" (allergy / chronic / special groups); choosing writes into the box and goes to the AI.
- Fixed ≥900px `.layout` grid overflow (grid-template-rows:minmax(0,1fr) + overflow:clip) so tapping chips never scrolls the table away.
- Artifact: worker/live/nova-rx-preview.with-ux-batch1-3-stickers17.js sha 4dfe1283…3348. Rollback: stickers16 (adaad6f9…).

## Checkpoint — polish2 (stickers18)
- Landscape (>=900px): the condition box is sticky at the top of the right column; the extra-chips groups scroll inside their own box (max 230px) so the typed text stays visible while choosing.
- Portrait (700–899px): sheet uses the full height (no 940px cap), "previous invoices" + "patient name" share one row, extra chips box max 180px. 5 invoice rows fit without scrolling at 834x1194.
- Artifact worker/live/nova-rx-preview.with-ux-batch1-3-stickers18.js sha 9a24cd96…d5f4. Rollback: stickers17 (4dfe1283…).

## Checkpoint — chip fill (stickers19)
- Condition chips now fill the row width in the right column. Artifact stickers19 sha 46551d2a…487d. Rollback: stickers18 (9a24cd96…).

## Checkpoint — no condition chips (stickers20)
- Owner: the pharmacist types faster than tapping, so the ready-made chips under «حالة المريض» were removed; only the text box stays (still sent to the AI). Artifact stickers20 sha 3ce1548c…99f9. Rollback: stickers19 (46551d2a…).

## Checkpoint — sale screen polish (stickers21)
- Appended `NOVA_SALE_POLISH` style/script before `</body>`: hides the dead WhatsApp nav link, sticker launcher in app palette, toast moved to bottom-centre, landscape customer column 21% (230–270px) so the invoice is wider, portrait (>=700px) one column with full-width search/header and sticky checkout footer, broken logo image hidden.
- Not changed (owner decision needed): bilingual product names, per-line discount column, +/- quantity order.
- Artifact stickers21 sha 1c2a77c7…e3e7. Rollback: stickers20 (3ce1548c…).

## Checkpoint — stable layout from first paint (stickers22)
- Cause of "sizes change": (1) the sale-screen override block lived at the END of the 540KB body and applied only after all inline scripts ran (customer column 299px -> 251px ~1.8s after open); (2) html lang/dir and body lang class were set by a script mid-body, so the checkout button flipped sides and the footer grew 3px; (3) four stacked generations of width rules (73/70/67%) plus breakpoints at 780/1050/1100/1300.
- Fix: `NOVA_SALE_POLISH` now in `<head>`, early `lang/dir` script in head, early body `lang-*` class script right after `<body>`, footer min-height 108px for >=1100px landscape. At <1100px the footer keeps its original wrapped layout (forcing one row squeezed the totals).
- Artifact stickers22 sha dd6a4345…3459. Rollback: stickers21 (1c2a77c7…).

## Checkpoint — loading splash (stickers23, NOT deployed yet)
- Owner idea: show a logo + loading bar until the page is built, instead of letting the layout assemble on screen. Added `#novaSplash` (NOVA Rx wordmark, "جارٍ التحميل…", indeterminate bar in app palette) right after the charset meta + first element in `<body>`; removed after window `load` + fonts ready (capped at 1.5s) + 150ms, hard cap 4s, `pointer-events:none` so it can never block taps or tests.
- Artifact stickers23 sha 75f6f76c…50ba (built, tested, awaiting owner OK to publish). Live is still stickers22 (dd6a4345…). Rollback = stickers22.

## Checkpoint — small "i" instead of caption + hint (stickers24, NOT deployed yet)
- Owner idea: replace «اختياري — للذكاء الاصطناعي» and the hint under the condition box with a small "i" next to «حالة المريض». Tap i = short tip («اختياري. الذكاء الاصطناعي هيراعيها…»); tap again or tap elsewhere = closes (works on touch, no hover needed). EN overlay entries added. Test updated + 4 new checks.
- Artifact stickers24 (built, tested, awaiting owner OK). Live is still stickers23 (75f6f76c…). Rollback = stickers23.

## Checkpoint — one-step checkout + Arabic payment window (stickers25)
- F9 / «إتمام الدفع» now opens the payment window directly. The forced «رقم العميل قبل الدفع» step is gone: `customerGateSkipped` defaults to true; the payment window keeps its «إضافة رقم العميل (اختياري)» button which opens the old gate (lookup / new customer logic untouched); cancelling the gate returns to the invoice and the next checkout is direct again.
- English leftovers in the payment window are translated (إجمالي المستحق / بالضبط / إلغاء (Esc) / عميل عابر) with matching EN entries; verified AR and EN modes.
- Tests updated: ux-batch3 (2 checks + touch), issue-4 L2. Stickers already open automatically after payment (`nova:invoice-completed`, existing feature), so no extra receipt button was added.
- Artifact stickers25. Rollback: stickers24 (16a99d35…).

## Checkpoint — project skill refreshed (docs only)
- `docs/skills/nova/SKILL.md` updated to the state after stickers25 (live artifact + rollback chain, one-step checkout, splash, head-level layout rule, auto-open stickers, pending list). Rule added: update the skill and HANDOFF in the same PR as each deploy.

## Checkpoint — stickers open only by the pharmacist (stickers26)
- Owner decision ("خليها مني"): the sticker screen no longer pops open after every payment. `nova:invoice-completed` still queues and loads the sold invoice, but `panel.classList.add('open')` was removed; the floating button «استيكرات الأدوية» opens it (right after paying it shows the sold invoice; in a new sale it shows the open cart).
- Tests updated: issue-4 (L5 closed after payment, L5b launcher opens with the sold medicines), sale-sticker-modal (closed after payment, then opens via launcher). sale-sticker-modal still ends at the known sandbox baseline failure (long-text print click).
- `docs/skills/nova/SKILL.md` updated in the same PR (rule: skill + HANDOFF move with every deploy).
- Artifact stickers26 sha dba049d0…8c20. Rollback: stickers25 (0bbf7b3b…).

## Checkpoint — safety fix: never show the previous patient's medicines (stickers27)
- Found while verifying stickers26: after removing the auto-open, opening the panel by hand in a NEW sale still showed the previous invoice's medicines (the open-cart reload only ran when the panel was empty). Reproduced by a new test, fixed: opening by hand with a non-empty cart that differs from the last loaded one (signature in panel.dataset.cartSig) loads the cart; the invoice-completed handler resets the signature.
- Tests: issue-4 L5c/L5d (fail on the old code, pass on the new). All suites pass; sale-sticker-modal still ends at the known sandbox baseline failure (20 PASS, then the long-text print wait).
- Artifact stickers27 sha 1018c42a6723012216b197e81329fb4c6465a4cfe26485193ec335d26b8db8ad. Rollback: stickers25 (0bbf7b3b…); do NOT roll back to 26 (has the bug).


## Checkpoint 2026-11-09 — Aumet login diagnosis prepared
- Branch `fix/aumet-login-diagnostics-20261109`. Last probe run 42511724809 confirms HTTP 401, no visible error message and no search requests. Cause remains unverified.
- `tools/sessions/push-sessions.cjs` now reports login HTTP status, login-page and auth-observed flags, and fixed booleans for credential/session/verification/rate-limit signals. Raw server text is not logged; session-run exception text is withheld.
- Validation: node --check PASS; four mocked rejection cases (credentials, other session, rate limit, verification) PASS, including no username/password output and no ingest after failed login. No live login or deploy performed.
- Next: Actions > Supplier sessions > Run workflow, select this branch and supplier=aumet once; inspect safe diagnostics before any further attempt. Connector has no workflow-dispatch tool; browser GitHub is signed out. Do not claim integration fixed until a real session is saved and real search passes.


## Verified 2026-11-09 — Aumet login and ingest PASS
- Runs 42566888384 and 42567144339 exposed a timeout at fill-username. Live form has no name attribute and type=text, placeholder `Email address or Mobile number`. Fixed selector in 02891ab.
- Run 42573770072 on fix/aumet-login-diagnostics-20261109 completed SUCCESS and logged `aumet: session saved`. Real login and Worker session ingest verified, no credentials printed.
- PR #83 remains draft, not merged. Automatic refresh on main still uses the old selector. Real Aumet product search and price semantics remain unverified. Next: review/merge selector fix, then test actual Aumet search through NOVA.


## Checkpoint 2026-11-09 — Aumet search NOT fixed
- 42575225938: current connector query on GitHub runner returned HTTP 400 JSON, session ingest still succeeded.
- 42575459471 captured site query shape (account context + coverage + compound sort). 42575689653 replayed original account query with spell=Panadol: HTTP 200, 20 rows, names unrelated to Panadol. Thus spell is not verified as text filtering. Account searchParams are now included in encrypted ingested session, but live Worker does not consume them yet.
- 42575918452 attempted UI search observation, stopped at username field timeout before login. No CAPTCHA/block established by this timeout. Exact placeholder may vary, so investigate visible form and support existing name/email/text semantics before another login.
- No Worker deployment, no merge, no successful end-to-end search. PR83 diagnostic changes remain draft. Some diagnostic runs saved sessions while product probe was unsuccessful, so green workflow is not proof of supplier search success. Next: capture real UI search parameter, integrate account query context without stale filtering keys, test Panadol and another query through actual Worker, then review/deploy and verify.


## Verified 2026-11-09 — Aumet search live PASS
- Fixed diagnostic collection typo ($eval/$ vs $$eval/$$), then captured real UI request: task is the actual search input. Original context parameters and sort are required. Panadol task returned Panadol; task-template substitution Augmentin returned Augmentin (42579860756 and the subsequent verified Augmentin probe).
- Worker hub now consumes encrypted session searchParams + searchTaskTemplate with current query, preserving account coverage and original sort. Captured task is removed from defaults.
- Saved artifact worker/live/nova-rx-preview.aumet-search1.js at 27da0e12d6def68fa3a96c5f6d0369c0470f29ee; exact SHA256 e41ba5ba49f634aa13527809004cab2cebe3565b84722db7366c59baf2b71a10. Earlier dry-run hash mismatch was a local trailing newline, corrected after byte-for-byte repository verification.
- Dry run 42580555464 PASS; Deploy NOVA Worker 42580749323 PASS with bindings retained. Live check 42580852522 PASS: both suppliers ok for Augmentin (1652ms) and Panadol Extra (2030ms); Aumet Panadol Extra 24 Tablet appears among 4 offers.
- Removed temporary product probes from refresh script, kept confirmed UI search-template capture; scheduled refresh now includes both suppliers. node --check PASS. Artifact syntax PASS. No actual orders placed.
- Remaining product limitation: Aumet net/best_price semantics remain unverified, existing connector uses unit_price. Future end-to-end scheduled refresh still needs observation. PR83 should merge these verified fixes.

## Checkpoint 2026-11-09 — owner-requested complete ERP roadmap ERP-1.0
- Master issue #87; detailed docs/ERP_MASTER_PLAN.md: 17 phases, 85 stable acceptance task IDs, dependencies, weighted progress, data/transaction invariants, role split (Claude implementation, ChatGPT review, Ahmed operating acceptance), performance/recovery targets and release gates.
- Canonical reports/erp-roadmap.json; sanitized public pharmacy/nova-status.json; public nova-monitor.html renders total/phase acceptance, expandable criteria, search/status filters, stale warning and refresh. No unauthenticated calls to private GitHub. MASTER_PRD and AGENTS point to roadmap and require checkpoint/mirror updates. Existing issue #53/84 work must be reused, not rebuilt.
- Baseline: zero accepted tasks under the NEW acceptance rubric, nine for_review; this is not a claim that no code exists. Only verified tasks with durable HTTPS evidence, timestamp and pass/reviewer count. 100% means all weighted acceptance work plus release/owner gates accepted; scope changes version the denominator.
- Published main commits: plan 19033a5; canonical 6855910; public data 09c62b3; UI 384f66f; progress 40fbd0b; agent protocol 34843f0.
- Validation: tools/test-erp-roadmap.cjs PASS: schema, 85 unique IDs, dependency order, inline JS syntax, unknown/0/100/weighted/rejected missing-evidence cases. Live public page observed ERP-1.0 and 0/85 with 9 pending review; search BUY-04 and status filter yielded expected task/9 items. Exact mobile viewport/screenshot QA not completed: local Chromium launch blocked by sandbox socket permissions; do not claim mobile pass.
- Next exact implementation: Claude reconciles current evidence for FND-01 and the nine pending-review IDs, creates a focused linked execution issue, then FND-02 ADR for transactional storage. Update canonical JSON + sanitized mirror + progress + HANDOFF after each accepted batch; no automatic new coding agent dispatch.

## Checkpoint — ERP-1.0: FND-01 للمراجعة، FND-02 مسودة (2026-11-09)
- PR #90 (docs فقط): `docs/erp/FND-01_REALITY_MAP.md` (جرد الأنظمة ومصادر البيانات ومالك كل بيان ومسارات القراءة/الكتابة والفجوات وقرار مبدئي لكل جزء وأسئلة المالك)، `docs/erp/FND-02_STORAGE_ADR_DRAFT.md` (ADR مقترح: D1 مقابل Postgres مُدار مقابل VPS، أوزان معايير، خطة قياس، بروتوكول كتابة، ترحيل/رجوع)، `docs/erp/NAVIGATION.md` (تقسيم الأقسام وقواعد العرض). Issues #88 و#89.
- الحالة: FND-01 `for_review` (مراجعة كود فقط، **لم يُدخل أي نظام حي** فحجم البيانات والأعمدة الحالية «يلزم تحقق»)، FND-02 `in_progress` (لا قياس ولا قرار). `reports/erp-roadmap.json` والنسخة العامة `pharmacy/nova-status.json` اتحدّثوا (pharmacy PR #52 مدموج).
- لقطات مهمة: `scanSearch/scanLookup` بدون مصادقة (قرار المالك)؛ الكتالوج الحي = شيت STOCK LIVE (لقطة كل ~5 دقايق)؛ الصيدلية في مصر والبرنامج بيعرض ريال/15%.
- الخطوة التالية: مراجعة ChatGPT ورد المالك على أسئلة FND-01 (النظام القديم للبيع، التشغيلات، الضريبة، الفروع)، ثم قياس FND-02.
## Checkpoint — nova skill refreshed (2026-11-09)
- `docs/skills/nova/SKILL.md` brought up to date: owner device (Xiaomi Pad 5), the owner dashboard work (splash that waits for all data, PIN-loop fix, Android install, how to test without live data), hardware advice given (nothing tested), the ERP-1.0 plan status (FND-01 for_review in PR #90, FND-02 draft), the unauthenticated `scanSearch/scanLookup` finding, SAR/15% vs Egypt, and that `pharmacy/nova-status.json` is now the public ERP mirror.

## Checkpoint 2026-11-09 — Supplier session renewal schedule (owner approved)
- Changed only the existing Supplier sessions schedule from `23 */10 * * *` to `23 */4 * * *` in .github/workflows/supplier-sessions.yml; comment updated. Commit: 41bc3c583dcf46181fe780404f6648bc4e3c0e07 on main.
- Manual refresh run https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42686377296 completed successfully; job logs explicitly reported both pharmaoverseas and aumet: session saved at 2026-11-09T19:46:28Z. This proves session ingest, not a new product-search check.
- Cron is UTC: scheduled times in Asia/Riyadh are 03:23, 07:23, 11:23, 15:23, 19:23, 23:23. GitHub scheduling can be delayed; the new cadence has not yet been observed executing automatically.
- Hourly health checks and expiry-aware renewal are proposed only, not implemented. No Worker deployment, order, stock update or new credentials.
- Next exact step: observe the next scheduled run and confirm both session-saved results; investigate separately if a supplier still shows disconnected.

## Checkpoint 2026-11-10 — BUY-01/03/04 purchasing workspace, PR #93 (in progress)
- Owner explicitly asked ChatGPT to implement the approved tablet mockup. Branch feat/purchases-20261110, issue #92; initial implementation aeb1aaf, inspection-only fix 4291e42. UI /purchases, free-form days, min/ideal, exact product/pack discount allocation, seller allowlist, manual offer choice, grouped local drafts.
- API: PIN-protected /api/purchases/stock proxy (POST owner dashboard PIN; never stored) and /api/suppliers/sellers from encrypted Aumet session metadata. Counterpart pharmacy PR #53 adds protected read-only novaPurchasingFeed from STOCK LIVE + observed sales; no stock writes. Source is NOT yet installed/verified live.
- Quantities: max(selected saved threshold, observed daily sales × requested coverage days) minus stock; minimum mode only currently below-minimum/zero lines. Missing sales stays unknown and falls back explicitly to saved threshold. No invented velocity. Offers require exact key or GTIN, EGP, freshness, selected seller and confirmed discount basis; unknown supplier quantity is marked, not presented as guaranteed.
- Evidence: node tests/unit/purchases.check.mjs PASS locally and Actions; Purchasing page checks 42701863640 PASS (synthetic data, 1280×800 +390×844, seller exclusion, split, cancel settings, local-draft status); procurement checks 42701863524 PASS; POS smoke 42701863566 PASS. Local Chromium socket launch denied, so real browser checks ran on GitHub. UI polish after the screenshot still needs a new CI pass.
- Cart truth: saved local draft does NOT fill supplier cart. Aumet cart inspection 42702572030 read static contracts and saved session; second inspection 42703168722 captures and ABORTS every cart/order write to discover the payload, no checkout. Run 42702355454 was cancelled after a mis-entered supplier input (no intended supplier refresh). No real supplier orders placed.
- Live baseline downloaded via Cloudflare API: modified_on 2026-11-09T11:57:20.882869Z; preserve old POS/admin/AI routes and supplier CORS. Built first artifact, not deployed yet. Keep pre-change live code for rollback; do not deploy stale emergency artifact.
- Next exact steps: finish cart contract inspection; verify new UI polish in CI; merge/deploy via guarded dry-run and verify; install source feed and require owner UI authentication for live data. Do not mark BUY tasks verified from CI alone.


### BUY cart follow-up — 2026-11-10
- Safe Aumet capture run 42703168722 succeeded: actual POST v2 cart/items payload captured and aborted, zero cart writes. Stored only in encrypted session, sanitized artifact13712147556.
- Implemented signed 120s per-line cart plans: fresh offer/price/payment validation, read existing qty, absolute target, conflict/payment protection, read-back. Retries reuse the same target; no checkout/order routes. Normal same-account session refresh retains observed contract.
- Unit mocks cover existing quantity, changed price/payment/cart, tamper, timeout-after-success and repeat-click. Real write/read-back remains NOT TESTED pending actual desired user basket. PharmaOverseas external cart remains NOT IMPLEMENTED; page labels it local.
- CI procurement failure42703427363 was pre-existing performance threshold (1721ms vs1000ms), rerun requested; no test weakened. UI latest42703425962 PASS.


### BUY deployment checkpoint — 2026-11-10 00:47 Riyadh
- PR93 squash merged0b2ae49; pharmacy PR53 merged01c37e7. Final SHA294a812 CI all PASS: Purchasing42704624594, Procurement42704624610, POS42704624915. Price/stock source test and generated server check PASS.
- GitHub UI dispatch attempts produced no new deploy run. Used connected Cloudflare API instead, after dry-run digest/baseline/exact5binding guard. Published2026-11-09T21:42:44.926256Z, startup1ms. Read back exact SHA25670e84705051113826993fb3d78fd799cb86c635b46e731836c10a7c70e5da513 and all5bindings (secret values never read).
- Live browser /purchases renders; DOM1363x936 has scrollWidth1363 (fits). Screenshot qa/reports/purchases-live-20261110.png. Full-page RTL screenshot was offset; viewport capture is correct. Source reads not attempted with wrong/made-up credentials. Supplier PIN absent in browser; prompt was cancelled, no account state changed.
- Remaining operational verification: owner enters existing NOVA supplier PIN and dashboard ADMIN_PIN in UI, chooses Aumet warehouses, checks true STOCK LIVE rows. Apps Script updater installation not yet verified. Real cart write/read-back NOT TESTED; only user-selected, explicitly confirmed cart lines should be used, never arbitrary drug test orders. PharmaOverseas cart remains local draft.
- BUY tasks remain in_progress; no acceptance percentage raised. No checkout or order submitted. Do not close issue92 until operational acceptance.


### BUY-01 follow-up: STOCK LIVE authentication — 2026-11-10
- Owner reports disconnected stock. Read-only live source check returned serverUpdateInfo ok, newer:false, autoOn:true, lastUpdate2026-11-10 00:05 Africa/Cairo. POST novaPurchasingFeed with empty PIN returned lockError, confirming new protected action installed. No owner PIN read or guessed; this does not identify the owner's exact browser error.
- UI now distinguishes not-yet-loaded from failure; Update shortages opens owner-PIN field before any stock request if empty, save continues the pending read, source-auth-required opens correction field and clear state. Cancelled supplier PIN maps to Arabic. No backend auth removed or stock writes added.
- Files purchases.html/js + existing browser regression updated to cover credential-gate then automatic load. Unit purchases.check PASS locally. CI and publish pending on fix/stock-live-auth-20261110; preserve live baseline70e84705051113826993fb3d78fd799cb86c635b46e731836c10a7c70e5da513 at2026-11-09T21:42:44.926256Z.

- Completion: PR94 merged51dca585. Purchasing browser42709196917 and POS42709195199 PASS. Guarded dry-run+publish through Cloudflare retained5bindings; live modified2026-11-09T22:10:52.261002Z, startup3ms, artifact purchases2 SHA256321691ebe836022d1e6ce5535e69b9009f9ce7db11c3a82860321d174677621c. Live browser verified Update shortages opens and focuses dashboard PIN without supplier prompt; screenshot qa/reports/stock-login-fix-20261110.png. Authenticated source data and real cart write remain NOT TESTED. Next: owner enters dashboard PIN in that field, Save resumes stock load; investigate exact server error if it still fails.


### BUY-03 speed follow-up — 2026-11-10
- Owner reports slow comparison. Code inspection found serial provider requests followed by an unconditional3100ms idle delay, in addition to response latency and connector throttling. This is a confirmed code-level bottleneck, not an end-to-end account measurement.
- Frontend now spaces actual request STARTS by3100ms, counting elapsed response time, with one request queue and in-flight dedup. Fresh complete-supplier results cache in page memory for120s under query+selected-supplier scope; original offer timestamp retained; partial/error results never cached. Requested qty reranks locally and cart preview still makes a fresh server offer validation.
- Stop comparison preserves completed rows and waits only for the active request to settle. UI tells owner when cached offers were reused. No supplier limits increased, no credentials/cache persistence, no cart/order writes introduced.
- Unit fake-clock scenario3×2s provider responses:12.2s baseline versus8.2s optimized; >=3.1s start spacing preserved. Slow5s response needs no extra idle wait. Tests cover TTL, supplier scopes, failures and simultaneous duplicate calls. Browser regression asserts repeat distribution performs zero additional searches. Local unit checks PASS; CI and publish pending branch perf/purchases-20261110 / issue92.

- Completion: PR95 mergedfab13cd82a9900ab55a1252e9d282ea91a669c74. Purchasing CI42710968503 and POS42710968408 PASS; browser verifies fresh repeated distribution keeps total supplier searches4, not8. Guarded publish modified2026-11-09T22:22:15.23066Z, startup1ms, purchases3 hash271f47d6e6b96095226b5465dbf06c80112cdd6a07b17c3b7cefba6e9550ba4a,5bindings kept. Live page render screenshot qa/reports/purchases-speed-20261110.png. Hidden stop control does not appear in the idle accessibility role list by design. No real-account timing claim, stock or cart mutation. Owner should refresh /purchases and compare; slow many-item first-pass still depends on upstream request time and existing rate budget.


### BUY-03 approved design implementation — 2026-11-10
- Owner approved sticker-inspired layout and insisted on retaining NOVA top bar. Replace purchasing-only sidebar with same7 NOVA destinations (sale/invoices/products/customers/reports/purchases/settings via existing hash router); compact request controls and grouped cart, coordinated dark/blue panel styling, mobile horizontal top nav.
- All displayed system quantities/prices/dates/percentages use Western digits. Free-form Arabic day entry normalizes back to Western display. Real progress modal starts0%, increments only after each attempted item settles (including failed items flagged for review), shows completed/total/current product; stop/Escape preserves completed results, no fake timer percentage. Table scroll retained through incremental result refresh.
- Unit checks PASS; browser regression expanded for progress visibility/closure, English numeric output and7 top links. CI and deploy pending branch ui/purchases-sticker-style-20261110, issue92. No stock/cart/order mutation test.

- Completion: PR96 mergedeee1d601. CI42712598463 (purchasing, progress lifecycle/English digits/7nav/tablet1280x800/phone390x844) and42712598420 (POS) PASS. Both synthetic screenshots visually inspected. Guarded publish purchases4 hash4bdc3fc0568ab589aec198716d2f8629148dbf9765b9f337aa2a592fc7f52b1e, modified2026-11-09T22:33:01.908841Z, startup1ms,5bindings retained. Live browser verified full7-link top nav and Western0 group count; screenshot qa/reports/purchases-redesign-20261110.png. Progress flow tested with synthetic supplier responses, not owner account. No real orders, stock writes or real cart additions.


### BUY-03 compact layout + sale seller scope — 2026-11-10
- Owner approved compact mockup and reports sale Aumet showing every distributor. Confirmed sale lookup passed requestedQty only, bypassing purchase preferences. Shared provider now reads saved novaPurchasePrefsV1, sends allowed Aumet seller IDs and selected supplier IDs; empty Aumet selection skips Aumet, never opens all. Hub filters BEFORE ranking, sale renderer filters again including injected providers. Selection remains per browser, not synced across devices.
- Compact single-row controls under full NOVA bar, no large header/explanation gap; dense rows and content-height cart (one total), inline progress ring/count/stop (no blocking modal), editable qty and eligible supplier dropdown. Source auth/cart safeguards retained.
- Unit purchases + seller-scope checks PASS locally (unselected cheapest seller excluded, zero selection, provider request scope). Browser regression extended to assert selected IDs sent, dropdown excludes unselected sellers, inline progress visibility, layout geometry. CI/publish pending on fix/compact-and-sale-sellers-20261110; no live account cart/order test.


### BUY-04/05 continuation — 2026-11-10
- Owner asked for real supplier carts and final order execution from NOVA for Aumet and PharmaOverseas. No requested basket/real order submitted.
- PR97 merged 74adc1c; purchasing5 published and read-back hash 9a6e3fa9ceafe4c496ffc8224965452b98cca535a86807835f28f36f4950e75b; all five bindings kept. Initial immediate read-back transiently returned no versions, later exact content confirmed. CI97 purchasing/procurement/POS PASS.
- Branch feat/supplier-cart-order-20261110: opt-in existing supplier-session contract inspection now also reads shipped static JS for cart/checkout contracts on both suppliers. No new login cadence; inspection will abort Aumet cart writes as before. No cart write/order execution verified yet.
- Next: run Supplier sessions on this branch with all + inspect_cart true, inspect sanitized static evidence, implement only observed contracts with read-back/idempotency and human confirmation for checkout.

- Read-only runs42717112138 and42717791769 succeeded: both supplier carts read, schemas sanitized. PO public adapter source saved by42718480038 (no writes), proving active selection saveTime===undefined, custom orgUsers add with quantity/code query, absolute PATCH for existing entries, order form contract. No real additions/orders.
- Implementation checkpoint: sale button now calls actual preview/confirmed apply and retains uncertain signed target; no local false-success. Added PO adapter and atomic SQLite operation-journal schema/service, not deployed or bound yet. Tests for retry/double-click and SQLite competing claims/unknown lock PASS locally; original Aumet tests PASS. Checkout still in progress; CI public-source capture will inspect Aumet response contract.

- BUY-04/05 implementation batch: both real cart adapters + fresh pre-write checks; persisted signed targets; final order review/terms/explicit submit; actual supplier response IDs + order read-back; persisted original checkout on reload with status-only retry. Atomic D1 journal created as nova-procurement-ops (4696f0cc-784f-4591-a36c-87bea6e47a1a), schema installed, NOT yet bound/deployed. No arbitrary items or orders used.
- Exact contracts reviewed from own site public JS: PO chunk-7A7ZXZ46 and chunk-72IZRT3W in42718480038; Aumet app-DwBKkwMO from42719118982 public-source artifact. Aumet order response data[] ids matches CheckoutCartPage; both checkout requests follow observed source. Cart plans15min with fresh price/payment/stock validation at apply; order approval120s binds actual cart fingerprint. Any unknown operation holds a unique supplier scope lock, never expires automatically.
- Local tests PASS: supplier-cart-client, supplier-journal (real SQLite), supplier-transactions (both suppliers, terms, price conflict, order read-back, cross-service dedup, unknown lock), existing purchasing/seller scope/Aumet. Generated purchases6 syntax PASS. Local browser test could not import playwright; CI includes synthetic checkout/reload browser checks. CI, live read check and deployment pending. No real supplier mutations tested.

- Resume: PR98 head14bfe007 CI42720571341 purchasing+checkout-browser PASS, procurement42720571106 PASS, POS42720571339 PASS. Visual review found long grouped-cart content could push its footer below viewport; constrained desktop cart height and made only group list scroll. Added actual review-button visibility assertion. Rebuilt artifact; final CI and deploy pending. No supplier mutations.


### BUY-04/05 module deployment correction — 2026-11-10
- PR98 merged37bad6e, final CI de2355a purchasing42753552538/procurement42753552522/POS42753552780 PASS. Guarded legacy purchases6 upload was rejected400/100329: D1 requires ES module. No live code/binding change; baseline still purchases5 hash9a6e3fa9… and five bindings.
- Built purchases7 ES-module adapter around unchanged legacy fetch routes, per-env WeakMap retaining supplier/auth limiter state. Explicit six env bindings include NOVA_PURCHASE_OPS. Local module test PASS for POS/stickers, purchasing assets, D1 scope and persisted wrong-PIN rate limit.
- Deploy script now supports both formats and normalizes one-module multipart downloads for exact backup/read-back/rollback. Tests for exact module/legacy bytes + shell syntax PASS. New branch fix/purchase-module-20261110 awaits CI; no live supplier mutations.
- Next: merge after CI, upload module with preserved original five bindings plus the dedicated D1; verify exact content and six bindings, run read-only Supplier cart read check. Checkout/addition still not live-tested on arbitrary medicine orders.

- PR99 merged03b0a4; purchasing42754206114 and POS42754206106 PASS. Module purchases7 published04:13:27Z and exact515a74c8… digest/six bindings confirmed. Live read-check42754557565 FAILED for both suppliers with sanitized order-unavailable; seller read succeeded. D1 REST readiness query and binding ID verified; no supplier mutations. Do not claim live checkout ready. Narrow phase-specific error mapping prepared to distinguish journal/session/network read failures; local module/transaction tests PASS. Next: deploy diagnostics, inspect safe read failure, fix root cause, rerun read-only check; keep BUY in_progress.

- Read-check attempt2 returned cart-request-runtime-error for BOTH providers, proving D1 readiness succeeded and failure was native request construction. Official Workers Request docs explicitly do not support redirect:error (throws TypeError before network). Both new supplier-account and earlier Aumet cart used it. Switched to manual and reject every3xx, preserving no credential redirect. Platform regression reproduces error-mode rejection and checks no follow; transaction/module tests PASS. purchases9 built77659de3…; CI + read-only live recheck pending. Earlier attribution to journal was a hypothesis, now ruled out by phase diagnostics.

- Read-check attempt3 PASS after redirect fix: journal+cart reads for BOTH providers; PO empty, Aumet rejected extra-sellers even with all available warehouses. Account cart display entity IDs include payment suffix (site code explicitly slices4 chars); offer sellerId is raw.entity_id. Fixed checkout allowlist to selected items' entityProduct.entity_id (same domain as offer sellerId), retaining original cart-group id in actual order payload. Fixture now has distinct display70001 / warehouse7 and PASS. purchases10 built319d7ac3…; live recheck and final CI pending. No supplier writes/orders.


### BUY-04/05 published checkpoint — 2026-11-10 07:23 Riyadh
- PR98/99/100 merged (100=9255cd0). Final live artifact worker/live/nova-rx-preview.purchases10.js, SHA256319d7ac3aa79e9a1c80db4205ecb987c7b9e35a3ad78d8f66ab930a817369e10, modified2026-11-10T04:23:08.161534Z; exact read-back and all six binding names/types verified. D1 dedicated journal schema installed; original five bindings kept. POS, stickers, settings and supplier routes preserved by tested module adapter.
- Live read check42754557565 attempt4 PASS (job129628910054), no mutations: Aumet cart+journal read PASS, checkoutBlockedBy=order-extra-sellers; PharmaOverseas cart+journal read PASS, checkoutBlockedBy=order-cart-empty. The active PO cart is empty; do not reuse saved carts. Aumet selected cart contains warehouse IDs outside allowed/available selection; owner reviews its existing cart/warehouse choices before checkout. Do not claim a completed live cart addition/order.
- Unit platform/module/transactions + real SQLite journal PASS. Procurement42755526494 and POS42755526856 PASS. Purchasing/checkout UI unchanged from99 (42754206114 PASS, tablet1280x800/mobile390x844, synthetic screenshots visually reviewed and footer visible). Latest42755526492 passed unit checks but was still installing Chromium at this checkpoint; not claimed green. No automatic rerun needed just for read-check progress.
- Cloudflare's actual single-module download omits Content-Type and filename on its sole named worker.js part. Backup normalizer now accepts that exact named-JS + export-default form; bare-part and typed multipart/legacy byte-equivalence tests PASS locally, shell syntax PASS. App artifact unchanged by this tooling fix.
- Canonical roadmap/agent-progress updated without acceptance increase. Sanitized pharmacy/nova-status.json publication succeeded; mirror commit b159260697ece1cd10b8503bd70a890baebf6447.
- Next exact operating step: refresh /purchases, choose allowed warehouses, review desired real shortages then confirm add-to-supplier-cart; read-back must mark verified. For first real checkout, review the COMPLETE actual account basket (including outside-NOVA items), totals/payment/delivery, then owner confirms in UI. Real mutation acceptance, PO/GRN/invoice receipt/stock accounting remain pending; BUY-04 for_review, BUY-05 in_progress, ERP acceptance0/85 unchanged.


### Gemini delegated QA checkpoint — 2026-11-10
- Ahmed explicitly requested one task for connected Gemini. Created #101: https://github.com/elsousypharmacy-create/nova-rx/issues/101, narrow QA-01/BUY-04 supplier recovery tests, related #62. Choose two uncovered fixture cases, separate branch and Draft PR; no product fixes, merge, deploy or live supplier mutations.
- Status queued: no Gemini workflow or invocation tool was found in this session. Issue creation is not evidence Gemini started. Require acknowledgment/branch/PR before in_progress. ChatGPT reviews; other agent roles and ERP acceptance unchanged.


### BUY-03 sale Aumet visibility — 2026-11-10
- Owner reports Aumet missing from sale search. Confirmed code silently excludes it when saved warehouse selection is empty or provider disabled; saved selection is per browser. Owner browser state not observed, so this is a confirmed exclusion path, not proof of their precise state.
- Added visible scope/exclusion reason and in-place warehouse picker in sale lookup; explicit save enables Aumet, preserves coverage/other suppliers, searches again with only selected unlocked warehouse IDs. Cancel/read failure preserve preferences. Retained supplier errors even when results empty.
- Branch fix/aumet-search-selection-20261110; fixture browser regression covers enable/select/research, strict warehouse filtering, cancel/error preservation, no mutations. Existing seller-scope unit + syntax PASS locally; local Playwright import unavailable, browser CI pending. New artifact purchases11 changes only embedded sale supplier UI/CSS from purchases10, all routes/bindings untouched. No supplier cart/order mutations.
- Next: require CI browser pass, then guarded deployment/read-back and update roadmap/mirror. Do not call owner account search verified yet.


### BUY-03 Aumet search visibility published — 2026-11-10 08:02 Riyadh
- PR102 merged459dc9eb. CI final head26cf7ae: Purchasing42759076844 PASS including new seller picker browser regression; POS42759076612 PASS. First fixture run failed due absent UTF-8 meta in synthetic HTML, corrected (no product workaround/test weakened). Local latest module11 and seller-scope units PASS; local Chromium launch socket denied, CI ran actual browser.
- purchases11 SHA25641ea0f923241d5d7a840674ab5a3a91d115b4a2e329c191289f45ed89450abeb published2026-11-10T05:02:01.155586Z, startup0ms. Prepublish baseline319d7ac3… guard and six-binding name/type guard passed; exact postpublish code hash and all six names/types verified. Only embedded sale UI/CSS changed; supplier API, transactions and auth unchanged.
- Live /#sale UI verified Panadol supplier dialog shows empty-selection reason and اختيار مخازن أوميت button. Supplier PIN prompt cancelled; no owner credentials read/guessed, no authenticated live supplier search or real cart/order mutation. Tests prove synthetic select/save/research restricts to chosen warehouse and preserves unrelated prefs, cancellation and errors. Precise owner browser settings remain unobserved.
- Next owner step: refresh /#sale, open supplier search, اختيار مخازن أوميت, select permitted warehouses, حفظ وإعادة البحث. If warehouses cannot load, supplier session/auth requires diagnosis; do not automatically broaden to all warehouses. Per-browser selection remains explicit. ERP acceptance unchanged.


### Owner delegated Kimi batch + dashboard — 2026-11-10
- Ahmed requested next five tasks to Kimi and titles/percent/owner/states within dashboard NOVA icon. Explicit one-batch role exception; other Claude ownership unchanged. Assigned FND-03/04/05,SEC-01/02 as bounded design/fixture deliveries: issues103,104,105,106,107. No production auth, database migrations, supplier calls, merge or deploy delegated. Entire ERP acceptance criteria remain unchanged, initial drafts are not full acceptance.
- First new run42761851699 started by kimi-run-now on103. Others kimi-ready only, queued. Existing concurrency group permits one running and one pending; DO NOT trigger all four together (pending runs can be replaced). No automatic retry after failure/quota. Dispatch next only after committed work/PR and dependency review; these five are authorized by Ahmed, no new approval needed for their first runs within scope.
- pharmacy PR54 branch feat/nova-task-owners-20261110 implements compact Home acceptance/current task and complete monitor titles/owners/status/agent filter, criteria/evidence expansion. No private GitHub calls in browser, sanitized mirror only. Local roadmap/home metrics + all dashboard inline syntax PASS; phone/tablet +6Home fixture CI pending. UI publication not yet claimed; canonical/mirror keep zero acceptance.


## NOVA ownership publication + first Kimi result — 2026-11-10
- PR54 mergededfe07c; final browserCI42762302693 PASS:85 visible task titles, owner/status/search filters, acceptance0/100, stale/fresh/offline,390x844/1280x800 andsix faithfulHomefixtures. Initial test caught compactHomehidingtheowner; percentagebadge nowincludesactiveowner and all6geometrychecksPASS. No backend/finance/stock/delivery changes.
- FirstKimi103 delivered docs675f28c; Actionsrun42761851699 failure occurred only atPRcreate(permission), branchworkwas saved. Manually opened Draft108 withoutrestartingCLI. Review requiresGoodsReceipt definition, correct syntheticfinancialsubtotal andcurrentprocurementdescription. Notaccepted. FND-05 independent firstattempt42762500180 nowrunning;104/106/107waitfordependencies. Current statuses published inmirror; no acceptanceincrease.
- ExistinghourlyQAautomation updated for statusmetadata sync and boundedfirst-attemptdispatch ofthese five only, noauto-retry/merge/deploy. ItmaymanuallyrecoverPRcreatefailure fromsavedbranch. OtherClaude/productrolesunchanged. Homefetchespublicmirror every60svisible; completedstateappearsafterdocumentedcheckpoint sync, notinstantprivateGitHub polling.
- Follow-up removes brittlefixed10-review/4queued assertions so validstatusupdates do notbreakUIchecks; displays changes_requested as يحتاجتعديل. Final livePages verification pending.


### NOVA dashboard final live verification — 2026-11-10 08:35 Riyadh
- pharmacy PR54 edfe07c + PR55 6e3d14f published. Final CI42762748057 PASS (85 titles, owner/state/search, 0/100 acceptance gate, stale/fresh/offline, phone390x844/tablet1280x800 and6Home fixture geometries). Pages42762890155 PASS.
- Live https://elsousypharmacy-create.github.io/pharmacy/nova-monitor.html verified after Pages: Kimi filter lists exactly5 assigned tasks; FND-03 يحتاج تعديل / draft108, FND-05 قيد التنفيذ / run42762500180,104/106/107 queued. Weighted acceptance0%,11review,5active,69queued at this checkpoint. Six-size Home synthetic checks passed; native iPhone/private owner financial Home session not tested.
- Existing hourly review automation now synchronizes task state metadata and bounded first attempts for103–107, recovers saved-branch PR-create failures without re-runningCLI, and never retries execution/quota failures automatically. No broader Kimi delegation, security setting changes or production ERP deployment. Keep future statuses tied to actual latest evidence, not this historical snapshot.


### Kimi status follow-up — 2026-11-10
- Owner asked whether Kimi started. Confirmed two design drafts delivered:103 PR108 changes requested;105 run42762500180 CLI/commit/push succeeded at7f3b99a, workflow failed onlyPRcreate permissions. Created/reused Draft 109 from savedbranch without rerun. FND-05 nowfor_review;104/106/107queued, no activeKimi run atthischeckpoint. Review environment draft againstactual D1 migrations beforeacceptance. Canonical andpublicmirrorupdated; no acceptanceincrease.


### Owner instruction: resume from checkpoint near Kimi quota — 2026-11-10
- Ahmed says Kimi approaches the five-hour usage limit and must always continue where it stopped. KIMI_CONTEXT now requires branch/PR/diff/checkpoint/review read before edits, early draft and per-batch progress, precise next step, no repeat completed work/tests without reason, and no provider quota-probing retries.
- Workflow now records original base/issue in job env and runs a no-model always-step to capture tracked AND new draft files into recovery.patch/resume-note after CLI failure; existing pre-clean/push recovery patch is preserved. Artifact includes patch/reports/note instead of redundant full app/tests. Does not guarantee a platform hard termination can run cleanup; frequent written checkpoints remain required.
- New .github/scripts/kimi-save-checkpoint.sh + tests/unit/kimi-checkpoint.check.py. bash syntax and synthetic git regression PASS: tracked/new docs capture, excluded env/workflow paths, patch applies to base, earlier patch survives later unrelated working-tree change. No Kimi run or quota retry used for this change.
- Gemini #101 acknowledged start2026-11-10T04:49:41Z, no PR/posted checkpoint found. Requested bounded progress/checkpoint comment; two uncovered test cases only. Do not equate acknowledgment with continuing liveness or completed tests.

- Resume support completion: PR110 merged46fa55d7. Workflow YAML/wiring, bash syntax and synthetic git recovery regression all PASS locally. No model run, quota probe, deployment or permission changes. Canonical/public status notes and hourly reviewer instructions updated. Gemini acknowledgment alone remains insufficient evidence of active progress.


### BUY-UX #116 READY_FOR_REVIEW checkpoint — 2026-11-10 (Draft PR, NOT merged/deployed)
- Branch `ux/purchases-premium-20261110` from main @ 41f0b9e. Scope = the 3 deltas approved on #116; the existing approved design was NOT rebuilt. Files: `purchases.html`, `purchases.css`, `purchases.js`, new `tests/purchases-ux-browser.mjs`, `HANDOFF.md`. No provider/backend/worker/workflow files.
- DONE (synthetic fixtures): (1) Arabic message for `cart-seller-not-selected`, a lookup key only so it is safe before PR #119; (2) per-row offer states after auto-distribution: searching / none ("لا عرض مناسب" + hint) / error ("تعذر البحث" + retry hint), distinct from an unsearched row; retry and manual pick through «العروض» keep working; states clear when settings change; (3) selected-warehouse chip in the controls row ("أوميت: N مخازن", zero selection shows a warning state, click opens settings), display only, never widens the search.
- Found and fixed during testing: rendering inside the offers dialog while busy left «مراجعة القائمة» disabled; render now runs after busy clears.
- Evidence (local): `purchases-ux-browser` PASS (and FAILS on main's UI); `purchases-browser`, `purchases-seller-search-browser`, `supplier-orders-browser` PASS; unit 30/31 PASS, the one failure `procurement-ui-model` already fails on main and is fixed by PR #112. Screenshots 1280x800 and 390x844 reviewed by eye, at `reports/purchasing/ux-tablet.png`, `ux-phone.png`, `ux-zero-scope.png` (untracked, simulated data, badge says so). No horizontal overflow and no overlap in the controls row at both sizes.
- NOT DONE / NOT TESTED: no live check, no real supplier data; Xiaomi Pad 5 hardware not tried; the new test is NOT wired into CI because that needs a change to `.github/workflows/purchasing-checks.yml`, which needs owner approval. The chip does not span full width on phone (it sits in the row, no overlap). Aumet live visibility (#112 blocker) is separate; this UI work does not make Aumet operational.

### BUY-UX #116 follow-up after QA review on PR #120 — 2026-11-10
- QA found no committed screenshots and asked whether the new row states can mask partial Aumet results. Answer: they could, and that was a real defect in my change. An empty result from an incomplete search (any selected supplier not `ok`, even with HTTP 200) was shown as "لا عرض مناسب". Fixed: such a row now shows a distinct "لم يكتمل البحث" state, and offers found by a partial search are kept with a "النتيجة ناقصة" note. `tests/purchases-ux-browser.mjs` covers both (five fixture rows); it FAILS on the previous commit 1bb88a2 and passes now.
- Screenshots (1280x800, 390x844, zero scope, simulated data) committed under `docs/screenshots/116/` with a README stating viewport, command and parent commit.
- Still NOT done: wiring the new test into CI needs a change to `.github/workflows/purchasing-checks.yml`; kept out of this PR and prepared as a separate PR for owner approval. No live check, no Xiaomi Pad 5 hardware.
- CI wiring (owner rule on #112, 08:14: wire missing CI within scope): one line added to `.github/workflows/purchasing-checks.yml` running `tests/purchases-ux-browser.mjs` after the existing browser tests. The workflow already uploads `reports/purchasing/` as the `purchasing-ui-evidence` artifact, so CI now produces the screenshots too. This is the only workflow change; it is disclosed here and in PR #120 for the owner.

### BUY-P0 #115 checkpoint — cart-add warehouse scope (branch claude/practical-tesla-xndif9, NOT merged/deployed)
- Gap (code read): Aumet cart preview/apply took `sellerId` from the client without checking the owner's selected warehouses; the only check was at order time (`order-extra-sellers`). Cause of the owner's live cart containing outside-selection warehouses is NOT established (items may have been added outside NOVA).
- Change: `aumet-cart.js` preview rejects unselected/missing/empty selection with `cart-seller-not-selected` before any session load, search or write; invalid shape = `bad-request`. `supplier-provider.js` attaches the saved Aumet selection to every Aumet cart preview. Tests written first and seen failing, then passing: aumet-cart, cart-client; `supplier-platform` fixture updated to pass a selection (intent unchanged: redirect still not followed).
- Evidence (local, synthetic fixtures only): 8 supplier unit checks PASS (aumet-cart, cart-client, journal, platform, transactions, module-worker, seller-scope, price); browser purchases-browser, purchases-seller-search-browser, supplier-orders-browser PASS. No real supplier write, no live check.
- Open owner decision (unchanged): a cart operation ending `unknown`, including a definite `not-added` read-back, locks the supplier scope and also blocks that supplier's orders; no documented release path.
- Follow-up for #116 owner: add an Arabic message for `cart-seller-not-selected` in `purchases.js` `cartMessage` (it currently falls back to the generic text).

### BUY-P0 #115 READY_FOR_REVIEW matrix — 2026-11-10 (Draft PR, NOT merged/deployed)
- Branch `claude/practical-tesla-xndif9`, Draft PR #119, code commit efc346e + docs commit 9eb1ef9. Base: main @ 41f0b9e (unchanged when compared). Next owner: ChatGPT reviewer, then owner.
- COMPLETED (code level, synthetic fixtures): selected Aumet warehouses sent by client and enforced server-side in cart preview; missing/empty/unselected rejected before session load, search or write (unit asserts zero writes and zero supplier searches); invalid shape = bad-request; signed-plan tamper rejected, replay returns alreadyApplied, lost response resolved by read-back, conflict/payment/price checks (aumet-cart, transactions, journal on real SQLite); PharmaOverseas flow unchanged (supplier-transactions PASS).
- Regression: 30 of 32 unit checks PASS. The 2 failing also fail on main, not caused by this change: `procurement-ui-model` (assertion "no direct localStorage writes") and `worker-gemini-route` (needs the Worker artifact path argument). Browser: purchases-browser, purchases-seller-search-browser, supplier-orders-browser (main's version) PASS.
- NOT TESTED: any real Aumet/PharmaOverseas cart write or read-back, live account behavior, checkout, CI result for this PR. No claim of real-account success.
- BLOCKED / owner decision: `unknown` stays fail-closed; reconciliation is DESIGN ONLY in docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md (no unlock implemented). Arabic message for `cart-seller-not-selected` belongs to #116 (purchases.js).

### BUY-03 #112 consolidated update — Aumet visibility / selected-seller search (Draft PR #112, NOT merged/deployed)
- Branch `fix/aumet-per-seller-20261110`, continued from ChatGPT's commits 3291e8d/afbd736 (not restarted). Base main @ 41f0b9e.
- ROOT CAUSE of red CI: `tests/unit/procurement-ui-model.check.mjs:138` forbids `localStorage.setItem` in `supplier-lookup.js` (DOM layer must not write storage). PR #102 (459dc9e) added a direct write of `novaPurchasePrefsV1` there, so the check was ALREADY failing on main; #112 did not introduce it. Fix keeps the assertion untouched: the write moved to `NOVA_SUPPLIER_PROVIDER.savePurchasePrefs` (plain values only, other pref fields preserved, no credentials).
- Pagination (ChatGPT's hub.js change) reviewed: connector returns `totalPages`; selected-seller scan reads every page up to 12, filters before ranking, drops everything on any page failure or cap, so no partial offers leak. Added `IncompleteSearchError` so the user sees an honest "search incomplete" message instead of the misleading generic "connection failed".
- Tests (synthetic pages of 24, no network): seller only on page 3 of 4 found with pages [1,2,3,4]; single page; empty selection reads 1 page and returns nothing; 20-page catalog stops at 12 pages with no leaked offers and the new message; mid-scan failure discards earlier hits; prefs write whitelist. Mutation check: the pagination test FAILS on main's hub.js (reads only page 1) and passes here.
- Evidence (local): 31/31 unit checks PASS (worker-gemini-route skipped: needs the Worker artifact path); purchases-browser, purchases-seller-search-browser, supplier-orders-browser PASS.
- NOT TESTED / BLOCKED: live verification. The live Worker host is denied by this session's network policy (403), and the questions that matter (is the Aumet session connected, do warehouses load for this browser) need the owner's PIN and a browser, which this agent must not have. No live claim of any kind.
- Aumet 45 s timeout vs 12 pages at the 3.1 s request spacing (about 37 s of spacing alone) leaves little margin; a slow upstream will fail closed. Timeout path itself NOT unit-tested. No server-side seller filter parameter is known in the repo (the search text parameter `spell` is itself marked unconfirmed in the connector); finding one needs a read-only capture from the Aumet UI.
- Why Aumet "is not visible" to the owner remains UNDETERMINED. Code-confirmed exclusion paths: empty per-browser warehouse selection or provider switched off (the UI now explains this), warehouses failing to load when the supplier session is expired, and, newly fixed here, a silent save failure path. Next owner step: on the owner's browser open sale supplier search, read the scope line, pick warehouses and save.
- Overlap: `supplier-provider.js` is also edited by PR #119 (different region; expect a trivial merge).


### BUY-03 #112 review fixes — 2026-11-10 (Draft PR #112, NOT merged/deployed)
- Independent ChatGPT review of 1019156 found: (1) a missing/malformed `aumetSellerIds` let ALL Aumet offers through; (2) the 45 s timeout was unproven. Both confirmed in code and fixed.
- (1) CONFIRMED: `http.js` passed `undefined` when the field was absent, and `hub.js` treats `undefined` as unscoped. Fix: the client entry point (`/api/suppliers/search`) now normalizes missing/non-array to `[]`, so no Aumet warehouse is returned. `hub.search` keeps `undefined` = unscoped on purpose for server-internal cart callers (plan-bound seller); this is documented in a comment. New `tests/unit/purchases-search-route-scope.check.mjs` covers missing/string/object/null/empty/numbers and goes end to end through the real hub (no selection, with and without `supplierIds`, malformed): zero Aumet offers. It fails on the previous http.js.
- (2) CONFIRMED: the timeout only stopped WAITING (`Promise.race`); the sequential scan kept requesting pages in the background, up to 12, spending Aumet request budget for nobody. Fix: a cancel flag set on timeout stops further page requests (at most the one in-flight request completes); a timed-out scoped scan raises the "search incomplete" error and leaks no offers. Timeout is injectable (`aumetSearchTimeoutMs`, default unchanged 45 s). The new test fails on the previous hub.js.
- Evidence (local): 32/32 unit checks PASS (`worker-gemini-route` skipped, needs the artifact path); purchases-browser, purchases-seller-search-browser, supplier-orders-browser PASS. New unit file is picked up by the existing unit job automatically (no workflow change).
- NOT TESTED: live; a real in-flight HTTP request is not aborted (no AbortController in the connector); CI on this head not yet observed.

### BUY-P0 #119 rebased on main after #112 merged — 2026-11-10
- #112 merged to main as 6cd5f5e. Main merged into the #119 branch; the only conflict was HANDOFF.md (both sides appended), resolved by keeping both blocks; `supplier-provider.js` merged cleanly (cart-selection and prefs-write are different regions).
- Re-verified on the merged tree (local): 32/32 unit checks, purchases-browser, purchases-seller-search-browser, supplier-orders-browser PASS. `procurement-ui-model` is now green because #112 is in.
- Unchanged limits: no real supplier write or read-back, nothing live. Merging does not deploy (`deploy-worker.yml` is `workflow_dispatch` only).

### BUY-UX #116 rebased on main after #112 and #119 merged — 2026-11-10
- Main (#112 = 6cd5f5e, #119 = 5bcef72) merged into the #120 branch; only HANDOFF.md conflicted (append on both sides), resolved by keeping all blocks.
- Re-verified on the merged tree (local, static server like CI): 32/32 unit checks, purchases-browser, supplier-orders-browser, purchases-seller-search-browser, purchases-ux-browser PASS.
- One test update: the UX test had asserted the cart preview does NOT carry `aumetSellerIds` (written before #119). It now asserts the preview carries the selected warehouses `['one','two']`, which is the real behavior and a stronger check.
- Still NOT done: nothing live, no real supplier data, no Xiaomi Pad 5. Merging does not deploy.


### nova skill refreshed in the repo — 2026-11-10
- `docs/skills/nova/SKILL.md` (the source of truth) corrected: the "Live now" line pointed at `with-suppliers1`, which was replaced; it now records the last live state per HANDOFF (purchases11 over purchases10, hashes verified against the artifact files, NOT re-verified live), and a new section lists #112 / #119 / #120 as merged and NOT deployed, what is not verified (Aumet visibility undetermined), the open `unknown`-lock decision, the owner delivery policy and what a deploy still needs.
- Docs only; no code, workflow or `worker/live/` change.


### CURRENT.md boot file added — 2026-11-10
- New `CURRENT.md` (about 40 lines): boot order, priorities, who is on what, merged-not-deployed, open PRs, breakages, what waits on the owner. `HANDOFF.md` now starts with a pointer to it and is otherwise unchanged (nothing deleted, 721 lines of history kept). New `tests/unit/current-md.check.mjs` (picked up by the existing unit job) keeps CURRENT.md short, sectioned, pointing at files that exist, free of secret-looking text, and keeps HANDOFF.md as the archive; verified to fail when CURRENT.md is too long, loses a section or contains secret-like text.
- Why: the old boot read about 94k tokens (HANDOFF ~38k, plan ~24k, roadmap ~21k, skill ~9k) every session; a scheduler would pay that each run. The new order reads AGENTS.md + CURRENT.md first and stops if nothing is new. Estimate only (chars/3); real usage not visible from here.
- NOT done: the AGENTS.md boot text. PR #121 rewrites the same lines, so the exact replacement text is proposed on that PR instead of creating a conflict. NOT tested: that a real second agent resumes from CURRENT.md (only structure is checked mechanically). The hourly scheduler stays NOT configured; owner wants the real cost reviewed first.


### BUY release purchases12 — artifact built, NOT yet deployed (2026-11-10)
- Authorized by the owner (this chat) and the manager comments of 12:33-12:38: routine merge and deploy through the existing guarded workflow after the safety gates; real supplier writes, orders, checkout and secrets stay forbidden. #113 (Gemini QA tests, changes requested) is test-only and does not block shipping product code; it is NOT touched here.
- Build: `node tools/build-purchasing-artifact.mjs worker/live/nova-rx-preview.purchases11.js worker/live/nova-rx-preview.purchases12.js` on main @ 56b304f. sha256 `4b79d4b2ead1984f272159b62f3fc6f3da6f67db3a409225c68aa13f2fc74316`, 960,691 bytes (purchases11: 951,439). Rebuild is byte-identical; parses as an ES module with one `export default`.
- What changed vs purchases11 (23 diff regions, all inside embedded code): hub.js (12-page scoped Aumet scan, `IncompleteSearchError`, timeout that cancels the scan, `aumetSearchTimeoutMs`), aumet-cart.js (`cart-seller-not-selected` before any call), http.js (missing/malformed `aumetSellerIds` becomes `[]`), the purchasing assets table (purchases.html/css/js: per-row states, scope chip, Arabic message) and the app page (supplier-provider/lookup: `savePurchasePrefs`). Everything else, including the POS, stickers and settings routes, is unchanged.
- Tests: `tests/unit/module-worker.check.mjs` now takes the artifact path (default purchases12) and also asserts the release code and the fail-closed search; it PASSES on purchases12 and FAILS on purchases11 (so it discriminates). 33 of 33 unit checks pass. `worker-gemini-route.check.mjs` cannot parse module artifacts (it fails on purchases11 too): an old limitation, not a regression.
- Rollback: purchases11 (sha256 41ea0f92...abeb) stays in `worker/live/`; the deploy script also backs up the live code and restores it automatically if the upload or verification fails.
- NOT TESTED: anything on the live Worker yet. Next: merge this PR after CI, dry run, real deploy, then read-only live smoke through the existing GitHub workflows (no supplier writes).
- Live smoke tool: `tools/sessions/live-check.mjs` (run by the existing manual workflow "Supplier live check", read only) now checks the #112 contract: an unscoped search returns no Aumet offer; a search scoped to the first readable warehouses returns Aumet offers only from them; it also prints how many warehouses are readable. Proven against a local fake Worker: exit 0 when the contract holds, exit 1 with FAIL lines when a leak is simulated. It never calls a cart or order route.
- CI gap found: the "Purchasing page checks" workflow's path filter does not match `worker/live/**`, so a release PR gets only POS smoke automatically. The workflow is run by hand (workflow_dispatch) on the release branch instead of editing the filter.


### BUY release purchases13 — Aumet silent-empty diagnostics (2026-11-10)
- DEPLOYED purchases12 (run 42819525682, main a0e48c4): live code sha256 read back from Cloudflare equals the artifact (`4b79d4b2...4316`), six bindings unchanged, modified_on 2026-11-10T12:53:06Z, HTTP 200. Before it, the dry run proved the live Worker was exactly purchases11 (code digest `41ea0f92...abeb`, modified 05:02:01Z) and that `CLOUDFLARE_API_TOKEN` exists.
- LIVE read-only smoke on purchases12 (workflows "Supplier live check" and "Supplier cart read check", no cart or order route): both suppliers `ok`; 20 unlocked Aumet warehouses readable; an unscoped search returns 0 Aumet offers (fail-closed contract holds live); scoped searches return 0 offers outside the selection; PharmaOverseas returns offers for Augmentin and Panadol; carts read for both accounts (Aumet checkout blocked by `order-extra-sellers`, PharmaOverseas cart empty).
- FINDING (this is the "Aumet not visible" symptom, reproduced live): Aumet returns ZERO offers for Panadol/Augmentin with state `ok`, even scoped to all 20 warehouses and even with a very wide numeric scope (ids 1..99999 plus the list), so it is not a selection or id-domain mismatch. It worked on 2026-11-09 with the same queries (4 offers). Cause NOT yet known: candidates are an empty upstream result (account search context or text parameter changed), or every row failing `toOffer` (SchemaDriftError), which the hub swallowed silently (`drifted` was computed and discarded). A scan that took about 3 s means about one page was read.
- CHANGE (purchases13): the hub now records per-supplier numbers (`rows`, `readable`, `drifted`, `selected`, `shown`) in the search response and returns an explicit error when every row of a supplier is unreadable, instead of a quiet `ok` with no offers. The read-only live check prints them. Tests: `purchases-seller-scope.check.mjs` (fail on the old hub). Artifact `worker/live/nova-rx-preview.purchases13.js` built from purchases12; rebuild identical, parses as a module, diff limited to hub.js plus one extra blank line the builder adds before `<style>`.
- NOT TESTED: purchases13 on the live Worker (next: CI, merge, dry run with expected_modified_on 2026-11-10T12:53:06, deploy, live check). No real supplier write was done at any point.

### BUY release purchases14 — what id do Aumet rows really carry? (2026-11-10)
- DEPLOYED purchases13 (run 42821422605, main 982e4a2): live code sha256 read back = artifact `9b0d964c...11a3`, bindings unchanged, modified_on 2026-11-10T13:06:08Z. Its dry run showed the live Worker was exactly purchases12.
- LIVE read-only result on purchases13 (Supplier live check 42821526418): Aumet returns `rows=24, readable=24, drifted=0` for both test queries, but `selected=0, shown=0`: every row is readable, none belongs to a selected warehouse, and an earlier wide scope (ids 1..99999 plus the list) also matched nothing. So the schema-drift theory is REFUTED; the row seller id is not in the same id space as the warehouse list (or is empty). The seller allowlist added on 2026-11-10 (PR93) was only ever tested with fixture ids and therefore hides every real Aumet offer. This explains "Aumet disappeared". Not yet proven which id the rows carry.
- CHANGE (purchases14): each supplier entry also reports `noSeller` (rows without a seller id) and `sellerSample` (up to 6 distinct id/name pairs, ids and public distributor names only); the read-only live check also prints the first 20 `id:name` of the warehouse list, so ids and names can be compared. Unit test added; artifact `worker/live/nova-rx-preview.purchases14.js` built from purchases13, rebuild identical, parses, module-worker check passes on 14 and fails on 13.
- NEXT after deploy: read the sample, then fix the filter to match on the id (or name) that really identifies the warehouse. Any fix to selection semantics is a separate, tested change. No real supplier write at any point.

### BUY-03 ROOT CAUSE FOUND: Aumet warehouse id suffix (2026-11-10)
- DEPLOYED purchases14 (run 42822414277, main 827cfc8): live code sha256 `c960de4f...c9c3` read back from Cloudflare equals the artifact; bindings unchanged. Its read-only live check (run 42822475455) printed real ids and names.
- EVIDENCE (live): the account's warehouse list says `38596:Demo care`, `30426:شركه فاروس`, `26661:فارما ويست`, `43795:بونص فارما`, `28050:تارجت - الاسكندرية`, `43673:نيو ميدسين`, `53668:الوطنية فارم`, `38416:السلامه`; the Aumet search rows carry `385960002`, `304260002`, `266610002`, `437950002`, `280500002`, `436730002`, `536680002`, `384160002` with the same names. Row id = listed id + `0002` (10 of 10 samples). The warehouse allowlist added on 2026-11-10 compared the two raw values, so it never matched and hid every real Aumet offer ("rows=24, readable=24, selected=0"). The same mismatch explains the cart read check's `order-extra-sellers` even with all warehouses allowed. The earlier fixtures used ids like `one`/`7`, so no test could see it.
- FIX (purchases15): new `worker/procurement/provider/seller-id.js` `resolveSellerId(raw, knownIds)` resolves a row id against the REAL warehouse list (listed id stays; a 6+ digit id whose first digits, last 4 removed, are listed becomes that id; anything else unchanged; no list means no guessing). Used in the hub selection filter (offers now expose the listed id), in the cart adapter when comparing cart rows, and in the order allowlist. `tests/unit/purchases-seller-id.check.mjs` uses the real ids above; each of the three fixes makes it fail when reverted on its own. 33 of 33 unit checks pass.
- NOT TESTED: purchases15 live (next: CI, merge, dry run, deploy, read-only live check, expect Aumet offers inside the selection and `order-extra-sellers` to clear if the owner's cart only holds listed warehouses). Cart rows may use either id form (unknown); both are resolved, but a real cart write is still NOT tested and needs the owner's explicit approval.

## Checkpoint 2026-11-10 (purchases15 live, Aumet id fix)
- Live Worker = purchases15, sha256 08ceb32a…ce866, modified 2026-11-10T13:21:42Z (deploy run 42823785960; code digest read back by the workflow).
- Root cause of "Aumet missing": warehouse list ids are plain, search/cart rows carry id+`0002`; fixed by `resolveSellerId` in hub, cart adapter and order allowlist.
- LIVE read-only evidence (PASS): both suppliers ok, 20 warehouses; unscoped search 0 Aumet offers; scoped search never leaks outside selection; all warehouses: Augmentin 17 Aumet offers (11 warehouses), Panadol Extra 24 -> 1 offer; cart read now `order-minimum-not-met` (Aumet) / `order-cart-empty` (PharmaOverseas).
- NOT TESTED: owner's tablet/browser, real cart writes/orders/checkout (need owner approval), pharmacy#59 on iPhone.
- Rollback: purchases14 artifact.

## Checkpoint 2026-11-11 — Claude 1, SEC-04 audit chain (claim on Issue #87)
- Branch `claude/sec-04-audit-chain`, stacked on Gemini B's `gemini/sec-03-04-05-foundation` (`5bc99cb`, docs only). Files: `worker/security/audit-log.js`, `tests/unit/security-audit-log.check.mjs` (21 cases), `.github/workflows/security-unit.yml`, `docs/erp/SEC-04_AUDIT_LOG.md` (relabelled PROPOSED).
- Done: canonical JSON, secret/PII masking, allowlisted event builder, HMAC-SHA256 per-tenant chain with seq/anchor, `appendAuditEvent`/`verifyAuditChain`. 14 mutations of the safeguards are each caught by the tests.
- Closed as superseded per manager decision: #134 (-> #136) and #135 (-> #137). Open implementation PRs: #136 CAT-01, #137 CAT-02, SEC-04 (this branch).
- NOT DONE / NOT TESTED: no wiring into the Worker, no storage, no key created or changed, no live behavior. Open owner decisions in the doc (key, retention, storage/single writer, IP).
- Next: SEC-03 scoped-repository wrapper (pure) after review slots free; catalog `packaging` link; CAT-05 benchmark.

## Checkpoint 2026-11-11 — Claude 1, SEC-04 review fixes (PR #138)
- Claude 2's 4 blocking items fixed test-first: B1 substring key redaction (Claude 2's 16 names + more), B2 no NFC inside the hash (normalise once at build, refuse key collisions), B3 server-clock-only timestamp, B4 requestId required. Also: `expectedSeq` required, `expectedHead` on verify, depth cap, Map/undefined handling, IPv4-mapped IP, more scrubber shapes. 31 cases; 17 mutations of the new safeguards each caught (including the 2 that survived the first review).
- Still NOT done: wiring, persistence, single-writer store, key management, metadata allowlist (documented limits).
## Checkpoint 2026-11-11 — Claude 1, CAT-01 (claim on Issue #87)
- Branch `claude/cat-01-catalog`, stacked on Gemini A's PR #134 head `8717484`. Files: `worker/catalog/unified-catalog.js`, `tests/unit/unified-catalog{,-duplicates,-realdata}.check.mjs`, `.github/workflows/catalog-unit.yml`, `docs/catalog/CAT-01.md`.
- PR #134 audit: its own test failed (`assert.ok(item.id)` got `''`) while the PR said PASS; no CI ran it; one barcode only; no ingredient/strength/form; no duplicate review; silent defaults (price 0, packSize 1).
- Now: new tests written first (red on #134's code), module rewritten, 3 check files green locally (11 + 4 cases, real export 4378 loaded / 0 rejected / 9 duplicate groups).
- NOT TESTED: CI run of the new workflow (pending), the live STOCK LIVE sheet, any UI use. Not merged, not deployed. Next: Claude 2 review.

## Checkpoint 2026-11-11 — Claude 1, CAT-02 (audit of PR #135 + fix branch)
- Branch `claude/cat-02-unit-conversion`, stacked on `claude/cat-01-catalog` (so the shared `catalog-unit.yml` runs both) and merged with Gemini A's #135 head `86f76cf`. Files: `worker/catalog/unit-conversion.js`, `tests/unit/unit-conversion{,-price}.check.mjs`, `docs/catalog/CAT-02.md`, workflow globs.
- #135 audit (probed, not guessed): unknown unit `bottle` x2 -> 2; no packaging: 1 box -> 1, 1 carton -> 1; qty -5 -> -150; qty 'abc' -> 0; line price with qty 0 -> 20 (treated as 1); bad price -> 0; `tabletsPerStrip: 0` silently became 1; 7 separate strip lines of a 100 EGP box summed to 99.9999; fractional tablets accepted; its check ran in no workflow.
- Fix: 14 + 7 test cases (written first, red on #135's code), 5 safeguard mutations each killed. NOT TESTED: CI run of the branch, any use in purchasing/POS, linking packaging to catalog products.
- No PR opened for this branch: #134, #135, #136 already fill the 3-PR cap. Needs the manager to close/supersede #134 or #135, then I open the Draft PR.
## Checkpoint 2026-11-11 — Claude 1, CAT-01 review fixes (PR #136)
- Claude 2 review (3 blocking): whitespace/hex/exponent price -> now strict decimal, blank = null; strength/form test added (that mutation is now caught); `mergeLog`/`rejected` are read-only views. Also: merge log records discarded values, import-style inactive flags, Arabic-digit id search. Tests 15 + 7 + real-data; 8 mutations of the new safeguards each caught.
- Docs: `docs/catalog/CAT-01.md` follow-up section (limits: JS-number price, `reviewedBy` is a name not an approval, one bad barcode rejects a product, substring search = CAT-05).

## Checkpoint 2026-11-11 — Claude 1, CAT-02 review fixes (PR #137) and CAT-01 bounds (PR #136)
- Claude 2 blocking items on #137 fixed test-first: strict decimal parsing (no hex/exponent; Arabic digits accepted) and exact-range bounds (`out-of-range` instead of precision loss). Also `rounded-to-zero` warning. 16 + 9 cases; 9 mutations of the new safeguards each caught.
- #136 re-review leftovers fixed: price 0..1e9, integer pack size up to 1e6 (`032f180`).
## Checkpoint 2026-11-11 — Claude 1, CAT-01 review fixes (PR #136)
- Claude 2 review (3 blocking): whitespace/hex/exponent price -> now strict decimal, blank = null; strength/form test added (that mutation is now caught); `mergeLog`/`rejected` are read-only views. Also: merge log records discarded values, import-style inactive flags, Arabic-digit id search. Tests 15 + 7 + real-data; 8 mutations of the new safeguards each caught.
- Docs: `docs/catalog/CAT-01.md` follow-up section (limits: JS-number price, `reviewedBy` is a name not an approval, one bad barcode rejects a product, substring search = CAT-05).

## 2026-11-11 — Claude 2 — governance cleanup (Claude-only) and repo tidy
- Owner decision: only two Claude sessions work on NOVA Rx; ChatGPT, Gemini, Kimi and Grok are out of the process. Roles: Claude 2 lead manager + reviewer, Claude 1 lead implementer; author ≠ reviewer; no self-merge; max 3 active implementation PRs (docs/roadmap PRs counted separately, max 1 open).
- Done in this PR: `AGENTS.md` and `CURRENT.md` rewritten for that governance (CURRENT.md checked by tests/unit/current-md.check.mjs); retired instructions moved with `git mv` to `docs/archive/retired-agents/` (the three agent skills and the old manager playbook; nothing deleted); `reports/erp-roadmap.json` reconciled with GitHub (accepted 0/85; reviewer field = Claude cross-review; owners Kimi/ChatGPT/Gemini/Grok on tasks → Claude; evidence links added; per-section one-line notes). Public mirror `pharmacy/nova-status.json` was updated first (pharmacy PR #61); its `reviewer` fields still say ChatGPT and get a small follow-up data PR.
- Stale open PRs closed unmerged with a pointer comment (branches kept): #114, #91, #25, #20.
- NOT done / needs the owner: GitHub account `ahmedmelsousy-sketch` (write access, used by the retired Gemini A session) is still a collaborator; ChatGPT is not a GitHub collaborator (it acted through the owner's account), so nothing can be removed from GitHub for it. Revoking a collaborator or deleting remote branches is destructive/permission work and is not done by agents.
- Next: cross-review by Claude 1, merge #137 then #138, INV-01 fixes (Claude 1), BUY lane (Claude 2).

- 2026-11-11 (later): #137 CAT-02 merged as 595b2a8 and #138 SEC-04 as caf4aa6 (squash; gates: independent PASS on the exact reviewed code, green PR checks on the conflict-resolved heads, code diff vs the reviewed SHAs = 0 lines; no deploy). Main re-tested: catalog 16+7+4378/0, conversion 17+9, audit-log 31, current-md pass. No dependency on ChatGPT anywhere.
## Checkpoint 2026-11-11 — Claude 1, INV-01 taken over from Claude 2 (branch claude/inv-01-stock-core)
- Rebased `abb77e1` (Claude 2) onto main `caf4aa6` by cherry-pick (authorship kept) and fixed my review's blockers: idempotency scoped by branch; refunds to the original payment method (waterfall, `refund_payment`, journal by method); typed store errors; PO reference validation; statement-spy transaction test (BEGIN IMMEDIATE/COMMIT/ROLLBACK); approved `adjust`; `expiring`. New test file `tests/integration/inv-01-review-fixes.check.mjs` (10 cases) + original 11 pass; 20 mutations caught. Doc states what the journal is NOT (no COGS, not accounting). Not done: COGS, multi-process contention test, async D1 port, actor on invoices, wiring.

## Checkpoint 2026-11-11 — Claude 1, SEC-03 scoped repository (branch only, no PR: cap 3/3)
- Branch `claude/sec-03-scoped-repo`, stacked on `claude/sec-04-audit-chain` (`aaf57ff`). Files: `worker/security/tenant-scope.js`, `tests/unit/security-tenant-scope.check.mjs` (18 cases, real in-memory SQLite, two tenants), `docs/erp/SEC-03_TENANT_BRANCH_ISOLATION.md` (PROPOSED).
- 19 mutations of the safeguards each caught (one survived first: missing branch list could widen scope; test added).
- NOT TESTED: any D1/PostgreSQL adapter, wiring, session verification. PR to be opened when a slot frees; depends on #138 only for the workflow file.

## Checkpoint 2026-11-11 — Claude 1, SEC-03 review fixes (Claude 2 findings B1/B2/B3 + non-blocking)
- B1 (Owner could address another tenant's branch): contexts now require a verified `tenantBranchIds`; every branch must be in it, Owner included. B2 (depth cap failed open): `request-too-deep` 400 at depth > 6 and on cycles. B3 (`isTenantScoped` bypassable): renamed `looksTenantScoped`, advisory, refuses OR/comments/UNION/extra statements; doc says it is not proof. Non-blocking done: transfer needs a tenant-only `branches` table (explicit error), client key length cap, recognised names documented.
- 23 cases; mutations of the new fixes each caught (4 lint mutations first failed to apply, redone and caught). Not done: D1/Postgres adapter, wiring, SEC-01 verification, denial audit hook.
- 2026-11-11 (later): PR opened from `claude/sec-03-tenant-scope` = current `main` (`caf4aa6`) + exactly the three files reviewed at `d759d5f` (`git diff d759d5f -- worker/security/tenant-scope.js tests/unit/security-tenant-scope.check.mjs docs/erp/SEC-03_TENANT_BRANCH_ISOLATION.md` = 0 lines), because the old branch carried SEC-04's unsquashed history. The SEC-03 doc replaces the draft that called itself "APPROVED SPECIFICATION".


## Checkpoint 2026-11-11 — Claude 1, CAT packaging link (branch only, no PR: cap 3/3) + INV-01 withdrawal
- INV-01 collision: Claude 2's claim was 29 s earlier; I withdrew (my `claude/inv-01-stock-ledger` @ `fff62c4` is salvage only) and reviewed `claude/inv-01-core-cycle` @ `abb77e1` on #87 (CHANGES REQUIRED: cross-branch idempotency replay, credit refund booked as cash; non-blocking list).
- Branch `claude/cat-packaging-link`, stacked on `claude/cat-02-unit-conversion` (`b49e29b`). Files: `worker/catalog/unified-catalog.js` (packaging, `packagingOf`, box-size aware duplicates, merge), `worker/catalog/unit-conversion.js` (`canonicalPackaging`), `tests/unit/unified-catalog-packaging.check.mjs` (9 cases), `docs/catalog/CAT-01.md`. 9 mutations each caught (one survived first: merged-id alias; test added).
- 2026-11-11 (later): rebuilt on main `ad632e3`: exactly the change of `7a159b8` (git diff 7a159b8 over `worker/catalog/unified-catalog.js`, `worker/catalog/unit-conversion.js`, `tests/unit/unified-catalog-packaging.check.mjs`, `docs/catalog/CAT-01.md` = 0 lines).

## Checkpoint 2026-11-11 — Claude 1: BUY-05 three-way invoice match (pure, not wired)
Branch `claude/buy-05-invoice-match`. New: `worker/procurement/invoice-match.js`, `tests/unit/procurement-invoice-match.check.mjs` (12 cases; 11 mutations caught, 4 survived the first draft and got tests), `docs/procurement/BUY-05_INVOICE_MATCH.md`. Not wired, no deploy, no supplier call. Roadmap BUY-05 stays in progress (receiving UI, supplier returns, lot/cost checks, owner acceptance are open).

## Checkpoint 2026-11-12 — Claude 1: BUY-05 supplier returns and credit-note match (pure, not wired)
Branch `claude/buy-05-supplier-return`, stacked on `claude/buy-05-invoice-match` (PR #151). New: `worker/procurement/supplier-return.js`, `tests/unit/procurement-supplier-return.check.mjs`, doc section. No PR yet (3/3 implementation PRs open: #149, #150, #151). Not wired, no supplier call.
