# BUILD_REPORT — NOVA Rx

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

---

## 2026-11-06 — Supplier price comparison prototype (synthetic, read-only)

**Task:** Isolated supplier price comparison prototype with mock data only (task file `/tmp/kimi-task.txt`). No live APIs, auth, cart, DB, POS UI changes, or deployment.

**Changed files:**
- `worker/supplier-price-service.js` — 10 frozen synthetic fixtures; `normalizeOffer` (coerces string prices, clamps discount 0–100%, flags missing fields instead of guessing); `compareOffers` (deterministic: effective-price asc, supplier asc, product-code asc, index tie-break; per-product `best` flag); `paginate` (1-based, clamped, no phantom pages).
- `supplier-compare.html` — standalone read-only RTL Arabic page rendering the ranked comparison with pagination; imports the shared module; no fetch, no storage writes, no cart actions.
- `tests/unit/supplier-price.check.mjs` — deterministic checks.

**Tests actually run (this environment):**
- `node tests/unit/supplier-price.check.mjs` — PASS. Covers: exactly 10 fixtures; normalization of all fields incl. string-price coercion; missing price/stock/timestamp flagged in `missing`; discount clamping and effective-price math (17.48 / 29.61 / 21.83 winners verified); determinism under reversed input order; one `best` per product code; pagination 10 items @3 → 4 pages, remainder page, clamping of page 0/99/non-numeric, empty list, pageSize floor.
- `node --check worker/supplier-price-service.js` — PASS.
- Inline module script of `supplier-compare.html` extracted and `node --check` — PASS.
- Regression: `node tests/unit/gemini-label-service.check.mjs`, `sticker-studio.check.mjs`, `sticker-six.check.mjs` — all PASS.

**Remaining / limitations:**
- Prototype only; live supplier integrations require separate permission and secure access review per task instructions.
- Browser rendering of `supplier-compare.html` not exercised (no browser run in this session); logic is fully covered by Node checks.
- Not committed/pushed and no PR created from this environment per run constraints; dedicated PR to be opened by the orchestrating workflow.
