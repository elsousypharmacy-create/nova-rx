---
name: nova
description: Use when working on NOVA Rx (نوفا) — Dr. Ahmed Elsousy's Arabic-first RTL pharmacy POS/ERP (repo elsousypharmacy-create/nova-rx, dashboard in repo pharmacy). Covers owner preferences, roles, rules, current state, test and guarded-deploy procedure, and what is pending.
---

# NOVA Rx — project memory (updated 2026-11-08)

## Owner and style
- Owner: Dr. Ahmed Elsousy, pharmacist, NOT a programmer. Judges by hands-on trial and screenshots.
- Reply in plain Egyptian Arabic: short, outcome first, no jargon. Give ONE next step.
- Main device: tablet LANDSCAPE (also computer). Phone and portrait are secondary.
- Standing rule: after every deploy, test what was deployed and send screenshots.
- Priorities: stable sale screen, stickers inside the sale flow, fast polished Arabic RTL UX (app palette, no emoji).

## Repos
- `elsousypharmacy-create/nova-rx`: app (`index.html`), tests, `worker/live/*.js` deploy artifacts, `.github/workflows/deploy-worker.yml`, `HANDOFF.md`, board = issue #36. Procurement epic = issue #53 (separate session).
- `elsousypharmacy-create/pharmacy`: Apps Script server (WhatsApp bot), dashboard `nova-monitor.html` + `nova-status.json` (GitHub Pages). Merging bot PRs there can auto-deploy: never merge without the owner.
- Develop on `claude/nifty-albattani-ka1ifs`; after a merge restart it from `origin/main`. No `gh` CLI: use GitHub MCP tools.

## Hard rules
- No secrets in chat. Deploy/merge only when the owner asked for that flow ("انشر", "ادمج و انشر"); keep rollback ready ("ارجع").
- Never deploy `with-whatsapp.js` or `with-ux-batch1.js` (stale).
- Do not touch Kimi labels; Kimi is running only inside the procurement epic.

## Sticker flow (current design)
- Panel `#novaLabelsPanel` on top of the sale screen. Tap Adult / Child / Pregnant / Breastfeeding -> ONE batch request to `/api/ai/medication-labels` -> table of medicines (dose, frequency, duration, instructions, status). Tap a row to edit in a window. Printing = pharmacist approval ("راجعت وطباعة"); incomplete rows and unacknowledged red warnings block printing.
- Free-text box «حالة المريض» goes to the AI (no ready-made chips: owner removed them). Child needs age + weight (or "weight unknown").
- Server code: `worker/gemini-label-service.js` (timeouts, model fallback, readable errors).

## Live system and deploy
- Worker `nova-rx-preview` embeds the app HTML as a JS string literal; live HTML is an older lineage than repo `index.html`. Port repo changes as a diff onto the HTML extracted from the previous artifact: `tools/build-worker-artifact.mjs --extract ART OUT.html`, then `tools/build-worker-artifact.mjs BASE NEW_HTML OUT`. Server block: `tools/patch-worker-gemini.mjs`.
- Live now: `worker/live/nova-rx-preview.with-ux-batch1-3-stickers20.js` sha256 `3ce1548c627f5540052c9d4e38ffcfcc15bb2ac87bc09490f5fc146ba5b299f9` (deployed 2026-11-08 ~04:21Z). Rollback: stickers19 (`46551d2a…`), then 18 (`9a24cd96…`), 17 (`4dfe1283…`), 16 (`adaad6f9…`).
- Guarded deploy: artifact on `main` (PR merged first) -> workflow `deploy-worker.yml` ref main, inputs artifact_ref, artifact_path, sha256, expected_modified_on (= previous live modified_on), dry_run, confirm `DEPLOY nova-rx-preview`. Always dry run first.
- Verify: Cloudflare `workers_list` modified_on changed; `workers_get_worker_code` output (read after the deploy finishes) contains the artifact; `tests/unit/worker-gemini-route.check.mjs ART`; browser tests on the extracted HTML.

## Testing
- Playwright `@playwright/test@1.58.2` via `npm i --no-save`; delete `node_modules`/`test-results` afterwards (never commit). Chromium `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (`CHROME_PATH`). `node scripts/dev-server.mjs --port N`.
- Tests: `tests/sticker-list-edit.mjs` (main, ~90 checks), `ux-batch1/2/3.mjs` (live HTML: `UX_FILE=<html> UX_SKIP_EXTRA='#nlSimple'`), `issue-4-labels-panel.mjs`, `sale-sticker-modal.mjs` (stops at print in sandbox: font offline, baseline), unit checks in `tests/unit/`.
- i18n overlay: every new Arabic UI string needs an `enExtra` entry; guard text rewritten on DOM change.

## Pending (verify before acting)
- Never tested with the REAL Gemini, a real printer, or the real tablet. AI doses are suggestions: pharmacist reviews before print.
- Owner must delete the Cloudflare API token and GitHub secret `CLOUDFLARE_API_TOKEN`.
- WhatsApp PAUSED (number on the sunset On-Premises API).
- Closed 2026-11-08 as superseded/duplicate (branches kept, can be reopened): nova-rx #18, #19, #21, #23.
- Still open: nova-rx #20 (WhatsApp inbox draft, paused), #25 (PharmaOverseas research doc), #65/#66 (procurement epic drafts, other session); pharmacy #9, #10, #11, #28 (bot/Apps Script, owner decision, may auto-deploy), #44 (dashboard status data, stale).
- Deferred: portrait table placement polish, phone layout.

## On start of a new chat
Read issue #36, HANDOFF.md; then ask the owner the single next step.
