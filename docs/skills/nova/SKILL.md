---
name: nova
description: Use when working on NOVA Rx (نوفا) — Dr. Ahmed Elsousy's Arabic-first RTL pharmacy POS/ERP (repo elsousypharmacy-create/nova-rx, dashboard in repo pharmacy). Covers owner preferences, roles, rules, current state, test and guarded-deploy procedure, and what is pending.
---

# NOVA Rx — project memory (updated 2026-11-09)

KEEP THIS FILE CURRENT: update it (and `HANDOFF.md`) in the same PR as every deploy, not later.

## Owner and style
- Owner: Dr. Ahmed Elsousy, pharmacist, NOT a programmer. Judges by hands-on trial and screenshots.
- Reply in plain Egyptian Arabic: short, outcome first, no jargon. Give ONE next step. Be honest about what was NOT tested.
- Main device: Xiaomi Pad 5 (11", 1280×800 landscape; per ERP plan), also computer. Dashboard on his Android phone. Phone and portrait for NOVA are secondary.
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
- Demo data only: 12 hard-coded products (repo main; the live older lineage may differ) and a few demo customers; no persistence (see `docs/IMPLEMENTATION_STATUS.md`). Currency/tax shown are SAR/15% but the pharmacy is in Egypt: must become EGP + per-item tax rules (CAT-03).

## Sticker flow (current design)
- Panel `#novaLabelsPanel` opens ONLY when the pharmacist taps the floating button «استيكرات الأدوية» (owner decision 2026-11-08: no auto-open after payment). After a payment the sold invoice is still queued/loaded (event `nova:invoice-completed`), so tapping the button right after paying shows its medicines. SAFETY RULE: when the open cart is non-empty and differs from what the panel last loaded (signature `panel.dataset.cartSig`), opening the panel loads the cart and replaces any previous invoice, so a new patient never sees the previous patient's medicines (stickers26 had this bug for ~30 minutes; fixed in 27, covered by issue-4 L5c/L5d). Tap Adult / Child / Pregnant / Breastfeeding -> ONE batch request to `/api/ai/medication-labels` -> table (dose, frequency, duration, instructions, status). Tap a row to edit in a window. Printing = pharmacist approval ("راجعت وطباعة"); incomplete rows and unacknowledged red warnings block printing.
- Free-text box «حالة المريض» goes to the AI; a small "i" next to the label shows the tip on tap (no chips, no long caption). Child needs age + weight (or "weight unknown").
- Server code: `worker/gemini-label-service.js` (timeouts, model fallback, readable errors).

## Live system and deploy
- Worker `nova-rx-preview` embeds the app HTML as a JS string literal; live HTML is an older lineage than repo `index.html`. Apply the SAME small patch (python script with count asserts) to both `index.html` and the HTML extracted from the previous artifact: `tools/build-worker-artifact.mjs --extract ART OUT.html`, then `tools/build-worker-artifact.mjs BASE NEW_HTML OUT`. Check `--extract` of the new artifact equals NEW_HTML (`cmp`). Server block: `tools/patch-worker-gemini.mjs`.
- Live now (after the supplier deploy of 2026-11-08): `worker/live/nova-rx-preview.with-suppliers1.js` sha256 `f208296786ac709e111d46bd4a0866c7c050b502d089156c451997c8e8ae2af9` = stickers27 + supplier lookup (UI packed into the page, `/api/suppliers/*` routes). Rollback: stickers27 `1018c42a6723012216b197e81329fb4c6465a4cfe26485193ec335d26b8db8ad` (live before). If the Worker secrets are not set, supplier routes answer 503 not-configured.
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
- `pharmacy/nova-status.json` is now the sanitized PUBLIC mirror of `nova-rx/reports/erp-roadmap.json` (ERP-1.0 schema, rendered by `nova-monitor.html`); update both after every roadmap batch and run `node tools/test-erp-roadmap.cjs` (it hard-codes the number of `for_review` items: bump it when a task enters review).
- Closed as superseded/duplicate (branches kept): nova-rx #18, #19, #21, #23, pharmacy #44. Still open: nova-rx #20 (WhatsApp draft), #25 (PharmaOverseas research doc), #65/#66 (procurement drafts); pharmacy #9, #10, #11, #28 (bot/Apps Script, owner decision, may auto-deploy).
- Not an ERP yet: no transactional database, NOVA catalog is demo, no inventory ledger/purchasing/accounting. Real catalog today = Google Sheet «STOCK LIVE» (snapshot every ~5 min from the legacy POS). The ERP-1.0 plan (below) is the path.
- SECURITY FINDING (needs owner decision): Apps Script actions `scanSearch` / `scanLookup` have no authentication, so anyone with the web-app URL can read prices and stock (documented in `docs/EMERGENCY_SALES.md`).
- Deferred: bilingual product names (data issue), per-line discount column, +/- order, phone layout, portrait polish.

## Procurement (supplier prices) — updated 2026-11-08
- Epic issue #53, PR #65 (waiting for the owner's explicit yes to merge into main). Kimi writes the code (one issue per run, dispatched from the epic branch), Claude reviews and tests, owner decides.
- Done and tested: contract + schema (#54), HAR sanitizer (#55), PharmaOverseas connector (#56), name parsing (#57), comparison (#59), PO drafts (#60). 7 procurement checks pass.
- PharmaOverseas has no official API. We use the pharmacy's own account (repo secrets `PO_USERNAME` / `PO_PASSWORD`, never in chat). Login = OAuth + PKCE, token 12 h. Search returns pharmacy price, public price, stock status only (no quantity).
- Owner decision: NOT a 2-hour bulk pull of 20k items. Instead: on the sale screen, when an item is missing, a button searches suppliers on demand (about 2 s). Mockup screenshots were approved in principle; NOT built yet. Scheduled workflow `price-collect-pharmaoverseas.yml` exists on the epic branch, so do not merge it as is: switch it to manual only.
- Aumet (marketplace with ~21 distributors, each with its own price): discovery DONE (docs/procurement/discovery/aumet.md). Login works with the pharmacy account (secrets `AUMET_USERNAME` / `AUMET_PASSWORD`), no CAPTCHA. API gives per-distributor `unit_price`, `best_price`, numeric `stock`, barcode, active ingredient. Open risk: login may log the pharmacy out of its other sessions. Connector is next (Kimi). DrugEye is a drug index, not a supplier.
- Sanitizer lesson: short numeric ids (entity/cart) leaked once into paths; fixed (4+ digits become {id}).
- Approved designs (screenshots): row unit = stock + suppliers in one box (44 px on tablet); centered popup with scroll and +/- per offer; Suppliers screen with add-supplier (email + password, encrypted). Aumet shows as a group of sellers.
- Server side (encrypted sessions, search API) is BUILT and tested with fakes, not deployed. Login to suppliers is done by a real-browser job (`supplier-sessions.yml`), never by faking a browser over HTTP. Pack the UI for the Worker with `node tools/inject-supplier-ui.mjs`. Aumet text-search parameter still unknown.
- Supplier lookup UI is BUILT in the repo (supplier-lookup.js/css, provider interface `window.NOVA_SUPPLIER_PROVIDER`) but has no real provider yet and is not deployed.
- Mockups must follow the app palette, no emoji, tablet landscape first. Say clearly what is real and what is a drawing.
- Cart add/remove: not explored, only with the owner's approval. No order is ever sent automatically.

## Supplier lookup go-live checklist (2026-11-08)
- Build: `node tools/build-supplier-artifact.mjs <base artifact> <out artifact>` (extract HTML, pack UI, add routes). Test: `node tests/unit/procurement-worker-artifact.check.mjs`.
- Worker secrets come from repo secrets `NOVA_API_PIN` (>= 12 chars) and `NOVA_INGEST_SECRET` (>= 16): run workflow "Set Worker supplier secrets" (confirm text `SET nova-rx-preview secrets`). The supplier logins + `NOVA_INGEST_SECRET` feed (the Worker URL is built into the workflow, no secret needed) "Supplier sessions" (real-browser login every 10 h).
- First PIN use: the app asks once and keeps it in that browser (`novaApiPin`).

## Supplier lookup status (2026-11-08 evening)
- WORKING live for PharmaOverseas (real prices in 1.5-2 s). Owner's repo secrets exist: NOVA_API_PIN, NOVA_INGEST_SECRET (plus supplier logins). Aumet: not working yet (no search parameter), and its 10-hourly login is the only risk to the pharmacy's other Aumet sessions (logout-others is forced false).
- Never reuse supplier passwords as PIN/secrets. Owner types secrets in GitHub himself; Claude cannot read them (a run that sees them empty means they are missing or in the wrong place).
- Check live: push to branch `run/supplier-live-check` (workflow prints counts only).

## Reply rules (owner said replies felt not smooth)
- Short, Egyptian Arabic, outcome first, ONE question at most, no jargon, no issue numbers unless asked.
- Show screenshots of real results; say what was tested and what was not.
- Update this skill after every meaningful step.

## Owner dashboard (repo `pharmacy`, GitHub Pages `index.html`) — work of 2026-11-08/09
- It is the owner's management app (sales today, team, customers, WhatsApp bot chats, stock aging/shortages/expiry/counts, money: closing/expenses/debts/«بروجكت إكس», admin). Data comes from the Apps Script server through the cache Worker `wispy-cloud`. It is PIN-locked: ONE shared admin PIN stored in the Script Property `ADMIN_PIN`; the browser keeps it in `localStorage.adminPin`. NEVER ask for, read or log the PIN; the owner types it himself.
- Loading splash `#sSplash` (logo + name + bar, uses the theme variables) from first paint. It stays until: first fresh data (`#sync` shows «آخر اتصال») AND no dashboard request in flight (own `fetch` calls are counted and passed through unchanged, `window.fetch` restored afterwards) AND no answer flagged `_stale` (the 5 s re-ask) AND no `.spin` placeholder, plus 0.6 s without new requests and 0.7 s without DOM changes. Sign-in/error screens (`.access-card`) hide it at once. Caps 8 s after first fresh data, 12 s overall. Shown once per page open. Also sets `body.light` before first paint.
- PIN loop bug (fixed): parallel requests that left before a PIN existed each got `lockError`, and the older responses deleted the PIN the user had just typed. `api()`/`post()` now delete the stored PIN only if THAT request sent it, otherwise they retry with the saved PIN; `normPin()` converts Arabic-Indic/Persian digits to ASCII (the server compares exact strings). If it still loops with a correct PIN, check Script Property `ADMIN_PIN` exists (ASCII digits).
- Installable as an Android app: `manifest-index.json` + `sw.js` (network-first) registered from `index.html`. Chrome → ⋮ → Install app. `apple-touch-icon.png` referenced by the page does not exist (iPhone only).
- Dashboard changes go live ~2 min after merge to main (pages build); the sandbox cannot reach github.io or the Apps Script/Worker hosts, so verify with Playwright against a local `python3 -m http.server` and a mocked network (see HANDOFF checkpoints), and say clearly that live data was not tested.
- Public repo: no secrets, PINs, tokens, customer names or sheet IDs in any file.

## Hardware advice given to the owner (2026-11-09, general knowledge, NOTHING tested)
- Selling screen: touch tablet 11–12.4" landscape (he already has Xiaomi Pad 5) + Bluetooth 2D barcode scanner (scanning is the main input).
- Printing today = browser print (`window.print()` for the receipt, hidden print frame for stickers). Cable-free idea proposed, NOT built: the tablet sends the print job to a cloud queue and a small agent on the always-on PC/mini-PC/Raspberry Pi next to the printers prints it (receipt 80 mm ESC/POS, stickers 30×50). Prefer Wi-Fi/LAN printers over Bluetooth; Web Bluetooth only works with BLE printers on Android.
- Waiting for the owner: receipt-printer model + paper width (80 vs 58 mm), sticker-printer model, whether the PC is Windows and always on. Verify any candidate's official spec before he buys.

## ERP-1.0 (approved 2026-11-09)
- Reference: `docs/ERP_MASTER_PLAN.md` (17 phases / 85 acceptance items), master issue #87, data `reports/erp-roadmap.json`, public mirror `pharmacy/nova-status.json`, `AGENTS.md` section "ERP master roadmap".
- Execution rules: ONE small task with a fixed ID at a time; implementation issue + PR + evidence; my status is `for_review` at most (`verified` needs reviewer ChatGPT + a real trial by Ahmed); after each batch update the private JSON, the public mirror and HANDOFF; CI success/deploy/issue closure alone is never acceptance.
- Status: FND-01 (reality map) = `for_review` (PR #90, `docs/erp/FND-01_REALITY_MAP.md`; code review only, no live system touched); FND-02 (storage ADR) = `in_progress`: DRAFT with options (D1 vs managed Postgres vs VPS), weighted criteria and a measurement plan, NO measurement and NO decision yet (`docs/erp/FND-02_STORAGE_ADR_DRAFT.md`); agreed section structure in `docs/erp/NAVIGATION.md` (SAFETY is inside sales/stickers, not a main section; menu collapsible; unfinished sections not shown as usable).
- Until G1 the legacy POS writes sales/stock; NOVA reads. Never two writers for one transaction. Owner questions pending: legacy POS name and export/DB access, where batches/expiry live, branches, tax classes, controlled-drug register.

## On start of a new chat
Read issue #36, HANDOFF.md (latest checkpoints at the bottom); then ask the owner the single next step.


## Purchasing implementation (2026-11-10, PR #93)
Owner approved ChatGPT implementation of /purchases: free-form coverage days, saved min/ideal stock, STOCK LIVE read-only via protected JSON POST, Aumet seller allowlist, grouped local purchasing drafts. Pharmacy/PharmaClick remains stock writer. Backend source feed is pharmacy PR #53 and requires installed Apps Script source plus owner authentication. Initial synthetic browser/unit/legacy smoke checks PASS; deployment and actual supplier cart writes are NOT yet verified. Do not call local draft "added to supplier cart". See latest HANDOFF checkpoint for runs and exact pending steps.


#### Aumet cart implementation checkpoint
`provider/aumet-cart.js` uses the observed v2 contract stored encrypted by session refresh; preview/apply are authenticated, signed, short-lived, quantity-preserving, read-back verified. No order/checkout call exists. Automatic renewal keeps template only for identical pharmacy_id. Do not claim a real cart write was tested from synthetic CI. The live-cart button is user-triggered after quantity preview. PharmaOverseas remains local draft.


#### Purchasing published 2026-11-10
PR93 merged0b2ae49; live /purchases artifact purchases1 SHA25670e84705051113826993fb3d78fd799cb86c635b46e731836c10a7c70e5da513. Cloudflare modified2026-11-09T21:42:44.926256Z,5bindings kept. Pharmacy PR53 merged01c37e7. Three final CI checks PASS; browser screenshot qa/reports/purchases-live-20261110.png. Stock source and actual cart account acceptance remain blocked on owner UI authentication/testing, not a completed BUY milestone. Never claim mock cart success is a real account write.


#### STOCK LIVE login UX fix (2026-11-10)
The protected novaPurchasingFeed action is installed live (empty-PIN probe gives lockError; source update newer:false). A successful stock read still requires the owner's dashboard ADMIN_PIN as well as NOVA supplier PIN. Frontend opens dashboard PIN settings automatically before first read and resumes on Save. Never treat initial not-loaded label as evidence that Google Sheets is down, and never claim owner-account success from an empty-PIN probe.

Fix published via PR94/51dca585: purchases2 hash321691ebe836022d1e6ce5535e69b9009f9ce7db11c3a82860321d174677621c, modified2026-11-09T22:10:52.261002Z. Browser verified automatic PIN field/focus. Two CI passes recorded in HANDOFF. Stock authenticated acceptance remains pending.


#### Purchasing comparison speed
Avoid unconditional sleep AFTER a supplier response: createOfferSearch in purchases-core counts response latency toward3100ms start spacing, dedups in-flight identical queries and caches complete results for120s in memory by query+suppliers. Original timestamps remain unchanged; partial failures are not cached; new cart preview always revalidates upstream. UI announces cached reuse and supports stopping comparison. Fake-clock timing is not proof of live-account timing.

Published speed update PR95/fab13cd, purchases3 hash271f47d6e6b96095226b5465dbf06c80112cdd6a07b17c3b7cefba6e9550ba4a, modified2026-11-09T22:22:15.23066Z. CI browser confirmed repeat distribution reuses4 original searches with no additional calls. End-to-end owner-account latency still not measured.


#### Approved purchasing visual design
Keep NOVA's full top navigation (7 routes), no large purchasing-only sidebar. Dark slate/blue sticker-style panels, compact controls and grouped cart. All system digits Western, including dates and percentages. Progress circle is attempted-completed/total, never elapsed-time animation; failed lines count as reviewed and remain flagged. Stop/Escape exits after active read settles, preserving results. Owner approved this design explicitly2026-11-10.
