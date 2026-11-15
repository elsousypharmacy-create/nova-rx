# NOVA Rx — Design System

## Direction

Arabic RTL, Cairo typography, deep navy surfaces, restrained medical-blue accents and high-contrast text. Landscape tablet density takes priority while preserving keyboard, pointer and touch operation.

## Tokens and components

The current standalone studio defines semantic CSS custom properties for background, panels, cards, borders, text, muted text, status colors and focus. Shared controls include buttons, inputs, selectors, textareas, radio groups, dialogs/popups, toast feedback, medication editors, label previews and pagers.

The Sticker Studio workspace has a fixed viewport shell. Patient and medication tools occupy the upper workspace; exactly six selectable labels appear in a 3×2 lower grid per page. Overflow is contained within the relevant editor, never allowed to expand the viewport. Mobile uses an internally scrollable upper workspace.

### Shared tokens (UX420)

`ux-tokens.css` / `ux-tokens.js` (`NovaUx.apply`) own the `--nx-*` set: colour (`bg-base/panel/surface/elevated`, `border-subtle/focus`, `text-main/muted/dim`, `accent`, `on-accent`, `ok/danger/warn`), type scale (`fs-xs`…`fs-2xl`, `lh-*`, `fw-*`), spacing `sp-1`…`sp-7`, radius `r-1`…`r-3`/`r-pill`, elevation `shadow-1/2`, icon sizes `icon-sm`…`icon-xl`, motion `dur-fast/base/slow` + `ease` (zeroed under `prefers-reduced-motion`). Dark (Black Edition) is the default; light is opt-in via `data-theme=light`. Opt-in classes: `.nx-card`, `.nx-btn` (+`--primary/--ghost/--danger`), `.nx-h1…3`, `.nx-ico--*`. All use logical properties (RTL-first) and no global element selectors, so pages adopt them one at a time. Every text/background pair is checked for WCAG AA (4.5:1) in `tests/unit/ux-tokens.check.mjs`.

## Accessibility and print

Use visible focus, keyboard-operable sticker selection, labelled controls and reduced-motion support. Print CSS is generated separately with physical millimetre dimensions. Preview simplification does not remove printed clinical warnings or pharmacist review requirements.
