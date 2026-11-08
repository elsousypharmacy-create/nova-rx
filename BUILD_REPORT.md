# BUILD_REPORT — NOVA Rx

## Procurement 01 (2026-11-08): offline HAR sanitizer + discovery report skeleton — done

- Task (`/tmp/kimi-task.txt`, epic #53): value-stripping HAR sanitizer so the owner can safely share browser captures (#68 PharmaOverseas, #63 Aumet). No network, no dependencies, no workflow/package.json changes.
- Changed files (all new):
  - `tools/discovery/sanitize-har.mjs`: `node tools/discovery/sanitize-har.mjs input.har > out.json`. Keeps only xhr/fetch or JSON-MIME entries; groups by method + host + path template (all-digit ≥8 chars, UUID, or hex ≥16 segments → `{id}`); per endpoint emits sorted query/header/body field **names** (JSON and urlencoded bodies, nested `a.b.c`), status codes, a response field-name→type tree (arrays described by first element), allowlist-only `sampleValues` (numbers or strings ≤ 40 chars), and `count`. Never emits header/cookie/query/body values or any value under a key matching the secret regex (allowlisted `token_type`/`expires_in` excepted; secret-keyed subtrees are not descended into).
  - `tools/discovery/report-skeleton.mjs`: `node tools/discovery/report-skeleton.mjs out.json "Supplier"` prints Markdown with Summary, Endpoints (rows marked `Observed`), Login flow, Response field map, Pagination, Price fields, Stock fields, Cart, Open questions.
  - `tests/unit/procurement-discovery.check.mjs`: synthetic HAR (form + JSON password logins, `access_token`/`refresh_token` response, `Authorization: Bearer` + `Cookie` headers, `?token=` query, `email`/`phone` response fields, PNG + CSS entries) + CLI end-to-end + 5 MB performance check.
- Tests actually run:
  - `node tests/unit/procurement-discovery.check.mjs` — **PASS** (`procurement-discovery checks passed`): no secret value appears in `JSON.stringify(output)`; names `access_token`/`Authorization`/`username`/`password` do; `/occ/v2/pharma/products/000000000000028851` → `{id}`; PNG/CSS dropped (endpointCount 2); `expires_in: 3600` kept; ≥5 MB synthetic HAR sanitized in < 2 s (measured in-test); both CLIs exit 0 and match the library output.
  - `node tests/unit/procurement-contract.check.mjs` — **not present** in repo (task: "if present"); skipped.
  - `npm run check` — PASS (pre-existing sticker/gemini checks, unrelated regression sweep).
- Limitations: sanitizer assumes standard HAR (`log.entries`); non-JSON response bodies contribute no field tree; arrays described by their first element only (heterogeneous arrays under-described); sample values keep first observation per key. Not tested against a real supplier capture (none shared yet).
- Remaining work: feed a real owner-supplied capture through the pipeline when #68/#63 arrive; `worker/procurement/` contract code does not exist yet, so the contract check referenced by the task is still to be created under its own issue.
- Changes uncommitted; per instructions, no self-commit.
## Procurement Task 02 (2026-11-08): connector contract, offer schema, registry + fixture connector

- Issue: "[Procurement 02] Supplier connector contract, offer schema, registry + fixture connector" (epic #53), per `docs/procurement/ARCHITECTURE.md` sections 3–4 only.
- Files created (all dependency-free ES modules, Workers + Node 22 compatible):
  - `worker/procurement/offer-schema.js`: frozen `OFFER_FIELDS` (17 fields), `validateOffer(offer)` (required fields, enums for stockStatus/dataSource/syncStatus, `currency === 'EGP'`, finite >= 0 numbers or null, `discountPct` 0–100 or null, digits-only 8–14 barcode or null, no `<`/`>` in productName, recursive credential-key scan of `raw` via `/authorization|cookie|token|password|session/i`), `sanitizeName` (strips tags, collapses whitespace).
  - `worker/procurement/connector-contract.js`: `ConnectorError` + `AuthRequiredError`, `RateLimitedError` (`retryAfterMs`), `SchemaDriftError` (`missing`/`unexpected`), `TransientError`, `NotAuthorizedError`; `AUTHORIZATION_KINDS`; `assertConnector` (TypeError with clear messages); registry `registerConnector` / `getConnector` / `listConnectors` / `clearRegistry`, duplicate id throws.
  - `worker/procurement/connectors/fixture.js`: one synthetic supplier, 8 raw records incl. HTML-in-name, unknown discount, out-of-stock, no-barcode cases; case-insensitive paginated `search` (page/pageSize/totalPages), `getProduct`, pure `toOffer` with `netEffectivePrice = round2(unitPrice * (1 - discountPct/100))` only when both known, else null (unknown discount stays null, never 0).
  - `tests/unit/procurement-contract.check.mjs`: `node:assert/strict`, prints `procurement-contract checks passed`.
- Tests actually run (exact output):
  - `node tests/unit/procurement-contract.check.mjs` → `procurement-contract checks passed`, exit=0. Covers: register succeeds / duplicate throws / missing `toOffer` TypeError / `authorization: 'scraping'` throws; all 8 fixture offers pass `validateOffer`; HTML name sanitized; unknown discount → `discountPct === null` and `netEffectivePrice === null`; rejects USD currency, discountPct 120, barcode `'12ab'`, `raw.headers.Authorization`; page 3 of 2 pages → empty `offers`, `totalPages === 2`; case-insensitive search; `RateLimitedError('x', 5000).retryAfterMs === 5000` and `instanceof ConnectorError`.
  - `node tests/unit/supplier-price.check.mjs` → `supplier-price-service checks passed`, exit=0 (no regression).
- Remaining work: none within this task. Later tasks per spec: 03 real supplier adapter (after authorization recorded), 04 normalization, 05 collector, 06 compare, 07 PO drafts, 08 UI.
- Limitations: Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning because `package.json` has no `"type": "module"`; adding it was out of scope (pre-existing warning also fires for `worker/supplier-price-service.js`). No network, no real supplier data; fixtures are synthetic. `sanitizeName` strips tags but does not decode HTML entities (spec asks only for tags + whitespace). Not committed per instructions.

## UX batch 3 (2026-11-07): tablet/desktop polish — toasts, Arabic totals, touch targets, text floor, walk-in shortcut

- Found by a UX evaluation of `main` (screenshots + measurements, emulator, demo data): three "Added: …" toasts piled up over the totals bar and CHECKOUT; the totals area stayed English in Arabic mode (CHECKOUT, NET TOTAL, SAR, items); 37 controls under 40px (tabs 37, invoice buttons 34, quantity 36); 27 texts at 10-11px; an extra customer step on every sale.
- `index.html` only: one toast at a time (replaces the previous one), top-left under the search bar, 2.2s (errors 4.5s), `role=status/alert`, `dir=auto`; all toast messages translated; `CHECKOUT`/`NET TOTAL`/`F9 / Pay`/`items)` and `SAR` → `ر.س` in Arabic mode; `@media (pointer:coarse)`: 44px tabs, invoice buttons, quantity controls, quick-cash, payment buttons, discount and cash fields; 12px floor for functional text; Enter on an empty customer number skips the customer step (walk-in) with a hint.
- Tests: new `tests/ux-batch3.mjs` passes and FAILS 10 checks on the previous code; `tests/issue-2-acceptance.mjs` now reads `ر.س` as `SAR` (Arabic mode shows ر.س). Regression PASS: `ux-batch1`, `ux-batch2`, `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal`, Playwright smoke. All three UX test files also PASS on the HTML embedded in the live Worker build.
- Not tested: real tablet/touch hardware, real users, the live Worker. Phone layout is NOT part of this batch (quantity/total columns are off-screen on phones; the owner said tablet/desktop is the main use).
- Deploy build: `worker/live/nova-rx-preview.with-ux-batch1-3.js` (on top of the code deployed at 2026-11-07T08:55Z).

## UX batch 2 (2026-11-07): UX-SEARCH-EMPTY, UX-DISCOUNT-NO-FEEDBACK, UX-PRODUCTS-FILTER-EMPTY, UX-AI-NO-RETRY — fixed on branch

- Verified on the batch-1 code before changing anything (Playwright, Arabic and English): the search empty states existed but stayed English in Arabic mode; discounts of 150%, -5 and a fixed discount larger than the invoice changed the total silently; a products filter with no match showed an empty table; a failed purchase-invoice reading had no retry.
- `index.html` only: `#discountHint` (aria-live) + `aria-invalid` red field with three messages (AR/EN); `.nova-empty` «لا توجد نتائج مطابقة» under any empty table (products, customers, invoices); the purchase-invoice button becomes «إعادة المحاولة» after a failure and calls `/api/ai/purchase` again; AR translations for the search empty states.
- Tests: new `tests/ux-batch2.mjs` — PASS; it FAILS 20 checks on the batch-1 code. Regression PASS: `ux-batch1`, `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal`, Playwright smoke. Both new test files also PASS on the HTML embedded in the live Worker build (`UX_SKIP_EXTRA='#nlSimple'` for batch 1).
- Not tested: real phones, live Worker (not deployed). The purchase retry was tested with a mocked 500, not the real AI.
- Remaining: batch 3 (P3 + the Impeccable findings) in `docs/UX_BACKLOG.md`.

## UX batch 1 (2026-11-07): UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile, UX-FAB-MISLABEL — fixed on branch

- Verified on `main` @ `4e50e19` before changing code (Playwright audit): English mode left ~107 Arabic/mixed UI strings; the settings language buttons did nothing; on 390×844 and 360×640 the sticker button covered `#btnCheckout`; the button text «✦ AI الاستيكرات» did not match its aria-label.
- Causes and fixes (`index.html` only):
  - `arToEn` mixes both directions, so English mode translated English words into Arabic («Start فاتورة جديدة»). Added directional `toEn`, extra EN/AR strings, and an exact-match table `mixedText` for bilingual labels («Cash / نقدي» → `Cash` / `نقدي`). `ر.س` → `SAR` in English. Attributes (`title`, `aria-label`, `placeholder`) are now translated on every element.
  - The settings page renders `.nova-lang-btn` after load, so the per-button listeners never bound. Replaced with one delegated click listener.
  - Sticker button: on ≤780px it sits above the checkout bar and is smaller; visible text is now «✦ استيكرات الأدوية» (EN «✦ Medicine labels»), contained in its aria-label.
- Added during verification: UX-HELD-PANEL-OFFSCREEN. The held-invoices panel was `top:calc(100% + 4px)` of the whole workspace, so it opened below the screen on every viewport (e.g. top=848 on 844px). Now `top:auto` (right under the header). 10 more checks in `tests/ux-batch1.mjs`; they fail on the old CSS (9 fails).
- Tests: new `tests/ux-batch1.mjs` — 39 checks, PASS; it FAILS 24 checks on the previous `index.html`. Regression: `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal` (desktop/tablet/mobile), Playwright smoke — all PASS.
- Not tested: real phones, tablet hardware, the live Worker (not deployed). Demo customer names keep their bilingual form on purpose (data).
- Remaining: batch 2 (P2) and batch 3 (P3) in `docs/UX_BACKLOG.md`.

## Sale sticker modal premium upgrade (2026-11-06): STICKER-MODAL-PREMIUM — done

- Task (`/tmp/kimi-task.txt`): make the sale-screen sticker modal «استيكرات
  الأدوية» inside `/#sale` match the premium `sticker-studio.html` layout.
  No third page; standalone studio untouched; `NOVA_STICKER_MODAL_PREMIUM_V95`
  not revived.
- Changed files:
  - `index.html`: replaced the old `#novaLabelsPanel` markup/styles/script
    (lines ~3647–EOF) with the studio layout scoped to the modal — stepper,
    compact patient card (age سنة/شهر segment with month→year hint, weight,
    explicit حامل؟/رضاعة؟ radios), med tabs with ONE visible medicine editor,
    large hero preview + selectable thumbnail grid + pager, print settings in a
    collapsed `<details>`, fixed action bar with pharmacist-approval gate and
    طباعة المحدد/الكل. Invoice queue (`nova.label.invoices.v1`) and the
    `nova:invoice-completed` auto-open flow preserved; panel still closes on
    `startNewSale()` (Issue #4 batch-1 fix kept). AI regenerate still calls
    `/api/ai/medication-label`; AI errors/warnings shown as compact chips.
  - `tests/sale-sticker-modal.mjs` (new): Playwright/Chromium desktop run.
  - `reports/sale-sticker-modal.png`: desktop screenshot evidence.
- Acceptance criteria: 1 opens from sale invoice flow (dispatched
  `nova:invoice-completed` opens modal + queues invoice) PASS; 2 compact
  patient block with years/months + pregnancy/breastfeeding PASS; 3 tabs with
  exactly one visible editor, large preview, click-to-select prints PASS;
  4 compact AI status/warning chips, settings collapsed by default PASS;
  5 geometry asserts: sheet fits 1280×860, stage inside sheet above action
  bar, no horizontal clipping PASS; 6 browser verification below.
- Tests actually run:
  - `node tests/sale-sticker-modal.mjs` — **21/21 PASS** (modal opens from
    invoice flow, queue, age-months hint, safety gate, approval gate, single
    active editor + tab switch, hero preview, selection toggle, settings
    collapsed/expand, incomplete-med print block, approved print passes to
    popup, viewport/RTL/Escape/zero-pageerror checks).
  - `npm run check` — PASS (sticker-studio + sticker-six static checks, no
    regression; standalone studio untouched).
  - Print-then-pay and pharmacist approval preserved: print is blocked until
    safety answers + approval + complete meds (verified in test).
- Not tested: tablet, mobile hand-held, real printer hardware, live AI Worker
  responses (fetch path exercised only against the dev server, where the
  endpoint is absent — error chip path), live Worker deploy.
- Note: `npm install` was run to get `@playwright/test`; `node_modules/` is a
  local side effect, not part of the change.
- Remaining IDs: none from this task. Issue #4 queue unchanged (P1:
  UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile; P2/P3 as listed
  in KIMI_CONTEXT.md).

## Issue #4 (batch 1, 2026-11-05): UX-LABELS-PANEL-BLOCKS-NEXT-SALE — fixed

- Cause: every completed payment dispatches `nova:invoice-completed`, which
  auto-opens `#novaLabelsPanel` (full-viewport overlay, z-index 9100). Receipt
  close / receipt "New Sale" / F2 all call `startNewSale()`, which never closed
  the panel — so after checkout the labels overlay stayed on top of the POS and
  blocked the next sale.
- Fix (`index.html`, `startNewSale()`): remove the `open` class from
  `#novaLabelsPanel` when a new sale starts. The panel still auto-opens behind
  the receipt after payment (feature preserved), and the invoice queue inside it
  is untouched; it can be reopened via the labels buttons.
- Changed files: `index.html`, new `tests/issue-4-labels-panel.mjs`.
- Tests actually run:
  - `node tests/issue-4-labels-panel.mjs` — **10/10 PASS** (L1–L10: add product,
    gate skip, checkout, receipt opens, panel auto-opens behind receipt, receipt
    × closes, panel closed on new sale, search input visible + topmost via
    `elementFromPoint`, next-sale product add succeeds, zero pageerrors).
  - `node tests/issue-2-acceptance.mjs` — **21/21 PASS** (no regression to the
    five accepted issue #2 fixes).
- Remaining issue #4 IDs: UX-MIXED-LANG, UX-LANG-SWITCH-WEAK,
  UX-FAB-OVERLAP-mobile, UX-CHECKOUT-OVERLAY-LEAK (unverified), UX-SEARCH-EMPTY,
  UX-DISCOUNT-NO-FEEDBACK, UX-AI-NO-RETRY, UX-FAB-MISLABEL,
  UX-PRODUCTS-FILTER-EMPTY, UX-NEW-SALE-MODE, UX-EMPTY-CHECKOUT-NO-HINT,
  UX-TOAST-EN, UX-TOAST-COVERS-CHECKOUT, UX-DISCOUNT-ZERO-FIELD-CLEARED.
- Changes uncommitted; per instructions, no self-commit.

---

## Issue #2: Invoice persistence & blocking POS UX defects (completed earlier)

All changes are confined to `index.html` plus one new test file. No workflow
files touched, no dependencies added, Black Edition styling and Arabic RTL UX
preserved. Changes are uncommitted on branch `kimi/issue-2-42022855182`, ready
for review/PR.

## Root causes and fixes

1. **P0 — Discount persistence / silent total change**
   - Cause: discount inputs called `recalculateFinancials()` only; `state.percentDiscount`
     / `state.fixedDiscount` were never synced on input, and restored draft values were
     never written back into the inputs. After reload, lines came back but discounts were
     silently dropped, so the grand total changed (reproduced: 63.85 → 76.50 SAR).
   - Fix (`index.html`):
     - Input listeners now sync state, persist the draft, then recalculate.
     - On load, exact draft values are written back into both inputs before the first
       `renderInvoice()`, so totals are re-derived identically (calculation clamps are
       unchanged: percent 0–100, fixed ≥ 0, total floored at 0.00 — no negative totals).
     - Restore no longer clamps stored values with `Math.max(0, …)`, so inputs round-trip
       exactly.

2. **P1 — Customer persistence across reload**
   - Cause: the active-invoice draft stored lines/discounts only; `attachCustomer` /
     `detachCustomer` never persisted, and the draft was deleted whenever lines were empty.
   - Fix: draft now includes `customerId`; attach/detach persist; the draft is kept while a
     customer is attached even with zero lines; on load the customer is looked up in
     `DEMO_CUSTOMERS` and re-attached before the first render. Invoice items are untouched.

3. **P1 — Search mode badge not clickable in RTL**
   - Cause: `.search-mode-tag` had `pointer-events: none`, so clicks fell through to the
     input underneath.
   - Fix: `pointer-events: auto` + `cursor: pointer` on `.search-mode-tag`. Existing click
     handler and RTL positioning (`right: 10px`, input padding reserves the space) are
     unchanged.

4. **P1 — Receipt × close intercepted by overlay**
   - Cause: every completed payment dispatches `nova:invoice-completed`, which auto-opens
     `#novaLabelsPanel` — a full-viewport overlay at `z-index: 9100` — on top of the receipt
     modal (`z-index: 100`), covering the × button.
   - Fix: `#receiptModal.modal-backdrop { z-index: 9200; }`. The receipt (and its ×) now
     sit above the labels/AI overlays; the labels panel still opens behind the receipt and
     keeps its own close controls. No feature removed.

5. **P1 — `novaOriginalaria-label` DOMStringMap pageerror**
   - Cause: the i18n pass built the key as `'novaOriginal' + attr` → `novaOriginalaria-label`;
     a DOMStringMap key containing `-` followed by a lowercase letter is invalid and throws
     `SyntaxError` on every `apply()` run.
   - Fix: camelize the suffix → `novaOriginalariaLabel`.

## Tests

`tests/issue-2-acceptance.mjs` — self-contained acceptance suite (no npm deps; drives
headless Chromium via CDP using Node ≥ 22's built-in WebSocket; serves the repo over a
local HTTP server). Run:

```
node tests/issue-2-acceptance.mjs
```

21 checks covering the issue's acceptance list:
- A1–A7: add Augmentin + Panadol, attach demo customer (Tariq), enter 10% + 5 SAR discounts,
  reload → same customer, exact discount inputs, same lines, identical subtotal/grand total.
- B1–B3: excessive fixed discount floors total at 0.00 SAR and restores exactly after reload;
  zero discounts → total equals subtotal, discount row hidden.
- C1–C2: badge is topmost at its center (`elementFromPoint`) and a real mouse click toggles
  Customer/Product mode.
- D1–D4: checkout → receipt opens; × is topmost at its center (no overlay intercept);
  clicking × closes the dialog.
- E1–E2: 1366×768 and 1194×834 — no horizontal overflow, badge still clickable.
- F1: zero pageerrors across the entire run.

Results:
- Fixed code: **21/21 PASS**.
- Pre-fix code (verification run): 9/21 — reproduces each defect, including the exact
  DOMStringMap SyntaxError and the silent total change.

## Limitations / notes

- Persistence is browser-local (`localStorage`) by design of the prototype; there is no
  backend sync. Private-mode/storage-disabled browsers degrade gracefully (checkout stays
  usable, draft just isn't saved).
- After the receipt is closed, the labels panel (auto-opened for the completed invoice)
  remains visible behind it — pre-existing feature behavior, intentionally preserved.
- The receipt × still triggers `startNewSale()` (existing behavior); only its
  clickability/stacking was fixed.
- Screenshots: not captured; the test provides reproducible evidence (run command above).
