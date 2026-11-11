# UX-01 — Arabic design system: measured audit and first fixes (PROPOSED, not accepted)

Roadmap UX-01 acceptance: *Cairo, RTL, clear Arabic wording, WCAG AA contrast, dark/light colours, unified components and messages, no dead decorative elements.*
This file records **measurements** from `tests/ux/contrast-audit.mjs` and the fixes made so far. It is not UX acceptance.

## CORRECTION of the first audit (2026-11-11, same day)
The first version of this audit (branch `claude/ux-01-design-audit`) measured with a **mouse pointer** and reported 12 undersized touch targets (quick-cash buttons 28 px, delete ✕ 19×23, add-customer, refresh) and 3 contrast failures. **Both were overstated.** The app already enlarges those controls to 44 px under `@media (pointer:coarse)` (the tablet), so on the real device they are fine; and two of the three «contrast failures» were controls in an inactive look (`.is-blocked`, opacity 0.6) that WCAG exempts. The audit now measures a **touch tablet context by default** (`hasTouch`), skips dimmed/disabled controls (counted), and offers `--mouse` for the desktop layout. The numbers below are the corrected ones.

## How it is measured
Playwright 1.58.2 + Chromium, **1280×800 touch tablet**, Arabic UI, local static server, every non-local request aborted (no backend, no Google Fonts: fallback font, so glyph metrics may differ from production; the logo is loaded from github.io and therefore not shown in the sandbox, it is not broken in production). For each visible text node: computed colour (with opacity), effective background (ancestors composited), size/weight → WCAG ratio (4.5:1, or 3:1 for large text). Views: main app default + 7 tabs (fresh load each), `purchases.html`, `emergency-sales.html`, `sticker-studio.html`, `supplier-compare.html`. The Worker-served `/purchases` route returns 404 on a static server and is skipped (the standalone file was measured).
Run: `python3 -m http.server 8765 --bind 127.0.0.1 &` then `node tests/ux/contrast-audit.mjs [--mouse] [--json out.json] [--check]`.

## Results (touch tablet)
| Check | Before this PR | After this PR |
|---|---|---|
| Main app, 7 views, text contrast | 0 failures | 0 |
| Standalone pages, text contrast | **1 real failure**: primary buttons in `purchases.html` `#eef2f6` on `#347db6` = **3.93:1** | **0** (`#2b6aa0`, 5.08:1) |
| Touch targets < 32 px | 4 | 4 (see below) |
| Text < 11 px | 10 | 8 (two in `purchases.html` raised to 12 px; the rest are the printed-label preview in `sticker-studio.html`, small by design) |
| Light theme | does not exist (dark only; UX-01 acceptance lists dark and light) | unchanged: owner decision |
| `lang`/`dir` | `ar`/`rtl` after load; the HTML source says `en`/`ltr` (brief flash) | unchanged |

Remaining small targets (touch): the «select all» checkbox in `purchases.html` (22×22, its label is clickable), the pharmacist-approval checkbox in `sticker-studio.html` (22×22, label clickable), and two form fields in `emergency-sales.html` (233×32 date-time, 324×26 file picker).

## Visible things found by looking at the running app (not measured)
Currency is shown as **«ر.س» (Saudi riyal)** with «ضريبة القيمة المضافة (15% متضمنة)» for an Egyptian pharmacy; the currency is an obvious fix (U1), the **tax rate/classes are an owner policy decision (CAT-03)**. «نسخة تجريبية» is shown permanently.

## Not measured (do not read this as a pass)
Real Cairo glyphs, a real tablet, real data, Worker-served routes, hover/focus/active states, focus ring visibility, screen reader, print output, light mode (absent), WhatsApp/dashboard.

## The ratchet
`tests/ux/contrast-baseline.json` (groups 0, texts 0, small targets 4). `--check` fails if any number goes **up**. Fix something, then lower the number in the same PR. CI: `.github/workflows/ux-unit.yml` (runs on PRs that touch the pages or `tests/ux`).
