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
