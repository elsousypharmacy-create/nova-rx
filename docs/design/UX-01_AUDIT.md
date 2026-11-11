# UX-01 — Arabic design system: measured audit (PROPOSED, not accepted)

Roadmap UX-01 acceptance: *Cairo, RTL, clear Arabic wording, WCAG AA contrast, dark/light colours, unified components and messages, no dead decorative elements.*
This file is **measurements of the current app** (main `2303665`), made by `tests/ux/contrast-audit.mjs`. Nothing in the app was changed. It is the evidence for a later fix, not the fix.

## How it was measured
Playwright 1.58.2 + Chromium, viewport **1280×800** (Xiaomi Pad 5 landscape), Arabic UI (`nova-rx-language=ar`), local static server, every non-local request aborted (no live backend, no Google Fonts: **fonts fell back to Tahoma/system, so glyph metrics may differ from production**). For each visible text node: computed colour (with opacity), effective background (ancestor backgrounds composited), font size/weight → WCAG ratio, 4.5:1 normal, 3:1 large (≥24 px, or ≥18.66 px bold). Disabled controls are excluded (WCAG 1.4.3 exempts inactive components) and counted. Elements over a background image/gradient are skipped and counted (not judged).
Views: main app default + 7 tabs (fresh load each) + `purchases.html`, `emergency-sales.html`, `sticker-studio.html`, `supplier-compare.html`. The `/purchases` route is served by the Worker, not by a static server, so that tab was **not measured** here (the standalone file was).

Run: `python3 -m http.server 8765 --bind 127.0.0.1 &` then `node tests/ux/contrast-audit.mjs` (add `--json out.json`, `--check` for the ratchet).

## Results
| Check | Result |
|---|---|
| Main app, 7 views, text contrast | **0 failures** (≈ 300 text nodes) after excluding 2 disabled controls |
| Standalone pages, text contrast | **3 failures** (below) |
| `lang`/`dir` after load (Arabic) | `ar`/`rtl` on all measured pages. The static HTML source says `lang="en" dir="ltr"` and JS flips it, so there is a brief wrong-direction state before the script runs |
| Light theme | **does not exist** (dark "Black Edition" only; no `data-theme`, no `body.light` rule in `index.html`). The acceptance asks for dark and light: **gap** |
| Touch targets < 32 px (12 unique, main + pages) | see list |
| Text < 11 px | 10 nodes (`purchases.html` 3, `sticker-studio.html` 7) |

### Contrast failures (all on standalone pages)
| Ratio | Colours | Where |
|---|---|---|
| 2.74:1 | `#92afc2` on `#2c6589`, 15 px/800 | `sticker-studio.html`, count badge `(1)` |
| 3.20:1 | `#a4bccc` on `#2c6589`, 15 px/800 | `sticker-studio.html`, «طباعة الكل» |
| 3.93:1 | `#eef2f6` on `#347db6`, 12 px/700 | `purchases.html`, «توزيع تلقائي» |
Proposed token fix: use the app's `--text-main` (#f1f3f5) on `#2c6589` (≈ 6.2:1) / lighten text instead of dimming it; check the second two buttons for a lowered `opacity` that is not tied to `:disabled`.

### Touch targets under 32 px (cashier-critical first)
`button.quick-cash-btn` ×5 (128×28: «بالضبط», 50, 100, 200, 500), `button.btn-icon-del` ✕ (**19×23**, below even WCAG 2.2's 24 px minimum), `button.nova-checkout-customer` (156×28), `button.nova-refresh-icon` (43×24), checkboxes 22×22, two inputs 233×32 / 324×26 on standalone pages. Android/Material guidance is 48 dp for touch, WCAG 2.2 AA minimum 24 px. A pharmacist with gloves or wet hands on a tablet hits these. Proposal: 44 px minimum height for sale-screen buttons.

## Not measured (do not read this as a pass)
Real Cairo glyphs, real tablet, real data, the Worker-served routes, hover/focus/active states, the focus ring visibility, screen reader, print/sticker output, light mode (absent), WhatsApp/dashboard (separate repo).

## Proposed order of work (each small, each with the ratchet)
1. Raise the 3 failing colour pairs (standalone pages). 2. Sale-screen touch targets to ≥ 44 px (quick-cash, ✕, add-customer). 3. Static `lang="ar" dir="rtl"` in the HTML source. 4. Decide with the owner whether light mode is wanted at all (acceptance text says so) before spending effort. 5. Unified messages/empty states: needs a list of current messages first (not done).

## The ratchet
`tests/ux/contrast-baseline.json` holds today's numbers (groups 3, texts 3, small targets 12). `--check` fails if any number goes **up**. Fix something, then lower the number in the same PR. It is a regression guard, not a goal.
