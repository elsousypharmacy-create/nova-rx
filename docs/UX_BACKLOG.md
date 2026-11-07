# NOVA Rx — UX backlog (starting point)

Created 2026-11-07 from `main` @ `4e50e19`. Sources: `qa/reports` branch (`qa-reports/STATUS.md`, last tested SHA `85b8209`), `BUILD_REPORT.md`, `KIMI_CONTEXT.md`.
Owner priorities: stable sale screen, medicine stickers inside the sale flow, fast polished Arabic RTL UX, test before accepting.

## Baseline on `main` (run 2026-11-07, Chromium)
| Check | Result |
|---|---|
| `npm run check` (sticker static checks) | PASS |
| `tests/issue-2-acceptance.mjs` | 21/21 PASS |
| `tests/issue-4-labels-panel.mjs` | ALL PASS |
| `tests/sale-sticker-modal.mjs` (desktop/tablet/mobile) | ALL PASS |
| `tests/nova-pos-smoke.spec.cjs` (the only CI test) | PASS |
Not tested: real printer, live AI Worker, real devices, the live Worker.

## Already fixed (do not redo)
Discount/customer draft persistence, search-mode badge, receipt close, i18n pageerror (issue #2); labels panel blocking the next sale (issue #4 batch 1); premium sale sticker modal (#29, live since 2026-11-07).

## Open defects (batch 1 + UX-FAB-MISLABEL are fixed on branch `claude/nifty-albattani-ka1ifs-ux`; others: status = last QA at `85b8209`; re-verify on current `main` before fixing)
| Batch | ID | Pri | Note |
|---|---|---|---|
| 1 | UX-MIXED-LANG | P1 | FIXED on branch (draft PR) — directional dictionary + mixed-label table |
| 1 | UX-LANG-SWITCH-WEAK | P1 | FIXED on branch — settings buttons had no listener (delegated click) |
| 1 | UX-FAB-OVERLAP-mobile | P1 | FIXED on branch — confirmed it covered `#btnCheckout` |
| 2 | UX-SEARCH-EMPTY | P2 | no empty-result state |
| 2 | UX-DISCOUNT-NO-FEEDBACK | P2 | negative / out-of-range accepted silently |
| 2 | UX-AI-NO-RETRY | P2 | no retry on AI failure (sticker modal has retry; check the rest) |
| 2 | UX-FAB-MISLABEL | P2 | FIXED on branch — label now matches aria-label |
| 2 | UX-PRODUCTS-FILTER-EMPTY | P2 | no empty state in products filter |
| 3 | UX-NEW-SALE-MODE | P3 | |
| 3 | UX-EMPTY-CHECKOUT-NO-HINT | P3 | |
| 3 | UX-TOAST-EN | P3 | toast text in English |
| 3 | UX-TOAST-COVERS-CHECKOUT | P3 | at 1194×834 and 1366×768 |
| 3 | UX-DISCOUNT-ZERO-FIELD-CLEARED | P3 | cosmetic |
| 1 | UX-HELD-PANEL-OFFSCREEN | P1 | NEW, found while verifying; FIXED on branch — «الفواتير المعلقة» opened below the screen on every viewport (anchored to the whole workspace), so held invoices were never visible |
| — | UX-CHECKOUT-OVERLAY-LEAK | P3/close | technical only, no visible effect |
Out of scope (product gaps, not UX): stock ledger, RBAC, returns, purchasing, backend persistence.

## How to work (rules)
1. One batch per branch, one draft PR. Re-verify each ID on `main` first; record "not reproducible" instead of changing code.
2. Each batch: minimal edits to `index.html`, a Playwright check per ID, run the four baseline checks above, update `BUILD_REPORT.md`/`HANDOFF.md`.
3. Test at 1440×900, 1194×834, 834×1112 and 390×844. Arabic RTL default, Black Edition kept.
4. No merge or deploy without owner approval.

## Deployment warning
The live Worker `nova-rx-preview` embeds its own HTML (version `33fe0516…`, 2026-11-07) and has routes not in this repo (`/api/ai/*`, `/api/settings/secrets`). Never replace it with `index.html` from GitHub. Export the live Worker first (`worker/live/` on PR #33 has an export), patch it, keep bindings (`GEMINI_API_KEY`, `NOVA_SECRET_ENCRYPTION_KEY`, `NOVA_SECRETS_KV`), keep a rollback copy.

## Local test commands
`python3 -m http.server 8766` then `node tests/sale-sticker-modal.mjs`; `node tests/issue-2-acceptance.mjs`; `node tests/issue-4-labels-panel.mjs`; smoke: serve on 8765 and `npx playwright test tests/nova-pos-smoke.spec.cjs`.
In a sandbox set `CHROME_BIN` to the installed Chromium and `npm install --no-save @playwright/test` for the `.mjs` browser tests.

## Impeccable scan (2026-11-07, static, `npx impeccable detect` on `index.html`; 9 findings, nothing fixed yet)
Candidates for batch 3 (verify each before changing code):
- `undersized-ui-text`: 9px «د. أحمد السوسي» and 10px «Rx» in the brand block (floor is 11px).
- `tiny-text`: 11px body text somewhere; check on a phone.
- `low-contrast`: hover state text #f4f6f8 on #357aa3 = 4.3:1 (needs 4.5:1).
- `cramped-padding`: `.nova-nav-row`, `.pos-root`, `.table-container` have children flush against the edge.
- `dark-glow`: coloured box-shadow glow (#0284c7) on the dark page (style choice).
- `clipped-overflow-container`: `main.main-workspace` clips `.nova-held-panel` — this one was real, see UX-HELD-PANEL-OFFSCREEN.
