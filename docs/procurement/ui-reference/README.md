# UI reference (owner-approved mockups, 2026-11-08)

These Playwright scripts draw the approved designs on top of the real sale screen. They are **reference only**: lift the CSS (it uses the app's own variables and classes `.modal-backdrop`, `.modal-card`, `.btn`, `.btn-primary`, `.btn-secondary`) and the markup structure. Do not ship them.

- `row-unit.cjs`: stock + "الموردين" unit inside a search suggestion row (amber when stock < 30, green otherwise, icon-only button when stock is fine).
- `popup.cjs`: centered popup with scroll, one row per offer, `-` / `+` quantity, add button, one close button.
- `suppliers-screen.cjs`: suppliers list with status + "إضافة مورد" form (email, password).

Rules: no emoji, app palette, tablet landscape first (touch targets 44 px), every new Arabic string needs an `enExtra` entry in the i18n overlay.
