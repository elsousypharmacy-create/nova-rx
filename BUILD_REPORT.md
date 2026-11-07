# BUILD_REPORT — NOVA Rx

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
