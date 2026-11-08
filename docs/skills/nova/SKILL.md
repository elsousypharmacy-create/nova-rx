---
name: nova
description: Use when working on NOVA Rx (نوفا) — Dr. Ahmed Elsousy's Arabic-first RTL pharmacy POS/ERP (repo elsousypharmacy-create/nova-rx, dashboard in repo pharmacy). Covers owner preferences, roles, rules, current state, test and guarded-deploy procedure, and what is pending.
---

# NOVA Rx — project memory (updated 2026-11-08, after stickers26)

KEEP THIS FILE CURRENT: update it (and `HANDOFF.md`) in the same PR as every deploy, not later.

## Owner and style
- Owner: Dr. Ahmed Elsousy, pharmacist, NOT a programmer. Judges by hands-on trial and screenshots.
- Reply in plain Egyptian Arabic: short, outcome first, no jargon. Give ONE next step. Be honest about what was NOT tested.
- Main device: tablet LANDSCAPE (also computer). Phone and portrait are secondary.
- Standing rules: after every deploy, test what was deployed and send screenshots. For design suggestions ("ايه رايك"): give an opinion; for taste changes show a screenshot and wait for "انشر"/"نفذ" before publishing; "نفذ" = build, test, publish, verify.
- Priorities: stable sale screen, stickers inside the sale flow, fast polished Arabic RTL UX (app palette, no emoji, no English leftovers in Arabic mode).

## Repos
- `elsousypharmacy-create/nova-rx`: app (`index.html`), tests, `worker/live/*.js` deploy artifacts, `.github/workflows/deploy-worker.yml`, `HANDOFF.md`, board = issue #36. Procurement epic = issue #53 (separate session, drafts #65/#66, never merge without the owner).
- `elsousypharmacy-create/pharmacy`: Apps Script server (WhatsApp bot), dashboard `nova-monitor.html` + `nova-status.json` (GitHub Pages, ~2 min after merge). Merging bot PRs there can auto-deploy: never merge without the owner. A local clone exists at `/home/user/pharmacy` (restart the branch from `origin/main`, then push).
- Develop on `claude/nifty-albattani-ka1ifs`; after every merge restart it from `origin/main` (`git checkout -B <local> origin/main`, push `<local>:claude/nifty-albattani-ka1ifs --force-with-lease`). No `gh` CLI: use GitHub MCP tools.

## Hard rules
- No secrets in chat. Deploy/merge only inside a flow the owner asked for; keep rollback ready ("ارجع").
- Never deploy `with-whatsapp.js` or `with-ux-batch1.js` (stale).
- Do not touch Kimi labels; Kimi runs only inside the procurement epic.

## Sale screen (current design)
- Landscape: invoice wide, customer column clamp(230px,21%,270px) on the left; portrait (>=700px) is one column with a sticky checkout footer. Sizes must NOT change after load.
- Layout overrides live in ONE block `NOVA_SALE_POLISH` in `<head>` (CSS, `html body …` selectors with `!important`), plus an early `lang/dir` script in head and an early body `lang-*` class script right after `<body>`. LESSON: a rule placed at the end of the 540KB body applies only after all inline scripts run, so the page visibly jumps. Never put layout CSS at the end of the body.
- Loading splash `#novaSplash` (NOVA Rx + bar) is the first element in `<body>` (style right after the charset meta); removed after window load + fonts ready (cap 1.5s) + 150ms, hard cap 4s, `pointer-events:none`.
- Checkout is ONE step: F9 / «إتمام الدفع» opens the payment window directly. `state.customerGateSkipped` defaults to true; the payment window's «إضافة رقم العميل (اختياري)» opens the old gate (lookup/new customer). Payment window texts are Arabic in AR mode (arOverrides + enExtra pairs).
- The WhatsApp nav tab is hidden (dead link); sticker launcher button uses the app palette.
- Demo data only: 5 hard-coded products and demo customers; no persistence (see `docs/IMPLEMENTATION_STATUS.md`).

## Sticker flow (current design)
- Panel `#novaLabelsPanel` opens ONLY when the pharmacist taps the floating button «استيكرات الأدوية» (owner decision 2026-11-08: no auto-open after payment). After a payment the sold invoice is still queued/loaded (event `nova:invoice-completed`), so tapping the button right after paying shows its medicines; during a new sale it shows the open cart. Tap Adult / Child / Pregnant / Breastfeeding -> ONE batch request to `/api/ai/medication-labels` -> table (dose, frequency, duration, instructions, status). Tap a row to edit in a window. Printing = pharmacist approval ("راجعت وطباعة"); incomplete rows and unacknowledged red warnings block printing.
- Free-text box «حالة المريض» goes to the AI; a small "i" next to the label shows the tip on tap (no chips, no long caption). Child needs age + weight (or "weight unknown").
- Server code: `worker/gemini-label-service.js` (timeouts, model fallback, readable errors).

## Live system and deploy
- Worker `nova-rx-preview` embeds the app HTML as a JS string literal; live HTML is an older lineage than repo `index.html`. Apply the SAME small patch (python script with count asserts) to both `index.html` and the HTML extracted from the previous artifact: `tools/build-worker-artifact.mjs --extract ART OUT.html`, then `tools/build-worker-artifact.mjs BASE NEW_HTML OUT`. Check `--extract` of the new artifact equals NEW_HTML (`cmp`). Server block: `tools/patch-worker-gemini.mjs`.
- Live now: `worker/live/nova-rx-preview.with-ux-batch1-3-stickers26.js` sha256 `dba049d03b20b82fb3cadd1e331be1e4874419bf0720411f6a19d021344a8c20` (deployed 2026-11-08, see HANDOFF for the time). Rollback chain: 25 (`0bbf7b3b…`), 24 (`16a99d35…`), 23 (`75f6f76c…`), 22 (`dd6a4345…`), 21 (`1c2a77c7…`), 20 (`3ce1548c…`), 19 (`46551d2a…`), 18 (`9a24cd96…`).
- Guarded deploy: artifact on `main` (PR merged first) -> workflow `deploy-worker.yml` ref main, inputs artifact_ref, artifact_path, sha256, expected_modified_on (= previous live modified_on, seconds precision), dry_run, confirm `DEPLOY nova-rx-preview`. Always dry run first, then the real run.
- Verify: Cloudflare `workers_list` modified_on changed; `workers_get_worker_code` output (saved to a tool-results file; read AFTER the deploy finishes) contains the artifact; `tests/unit/worker-gemini-route.check.mjs ART`; browser tests on the extracted HTML.

## Testing
- Playwright `@playwright/test@1.58.2` via `npm i --no-save`; delete `node_modules`/`test-results` afterwards (never commit). Chromium `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (`CHROME_PATH`). `node scripts/dev-server.mjs --port N`.
- Tests: `tests/sticker-list-edit.mjs` (main, ~95 checks), `ux-batch1/2/3.mjs` (live HTML: `UX_FILE=<html> UX_SKIP_EXTRA='#nlSimple'`), `issue-2-acceptance.mjs`, `issue-4-labels-panel.mjs`, `sale-sticker-modal.mjs` (20 PASS, then the known sandbox baseline failure at the long-text print click: font offline), unit checks in `tests/unit/`. Change a test only when the behavior change was agreed with the owner.
- i18n overlay: every new Arabic UI string needs an `enExtra` entry; English leftovers in AR mode need an `arOverrides` entry (+ matching `enExtra` for EN mode).
- Measure layout stability by polling element rects every 100ms after load (see HANDOFF "stable layout" checkpoint); sandbox has no internet, so web fonts / remote logo cannot be verified.
- Scratch scripts and screenshots go in the session scratchpad, not the repo. A Bash `rm -rf` with unusual quoting can be blocked: write a script file instead.

## Pending (verify before acting)
- Never tested with the REAL Gemini, a real printer, or the real tablet. AI doses are suggestions: pharmacist reviews before print.
- Owner must delete the Cloudflare API token and GitHub secret `CLOUDFLARE_API_TOKEN`.
- WhatsApp PAUSED (number on the sunset On-Premises API).
- Dashboard `nova-status.json` updated 2026-11-08 07:55 (+03) via pharmacy #45; refresh it after major deploys.
- Closed as superseded/duplicate (branches kept): nova-rx #18, #19, #21, #23, pharmacy #44. Still open: nova-rx #20 (WhatsApp draft), #25 (PharmaOverseas research doc), #65/#66 (procurement drafts); pharmacy #9, #10, #11, #28 (bot/Apps Script, owner decision, may auto-deploy).
- Not an ERP yet: no database, catalog is demo, no inventory/purchasing/accounting (roadmap phase 2 = database + real catalog + saved invoices).
- Deferred: bilingual product names (data issue), per-line discount column, +/- order, phone layout, portrait polish.

## On start of a new chat
Read issue #36, HANDOFF.md (latest checkpoints at the bottom); then ask the owner the single next step.
