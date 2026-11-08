# NOVA Rx — HANDOFF (living project state)

Last documented: 2026-11-05 (Asia/Riyadh). This document is a handoff, not proof of current CI status. Verify GitHub before making changes.

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
