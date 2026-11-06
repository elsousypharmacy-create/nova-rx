# NOVA Rx — Design System

## Direction

Arabic RTL, Cairo typography, deep navy surfaces, restrained medical-blue accents and high-contrast text. Landscape tablet density takes priority while preserving keyboard, pointer and touch operation.

## Tokens and components

The current standalone studio defines semantic CSS custom properties for background, panels, cards, borders, text, muted text, status colors and focus. Shared controls include buttons, inputs, selectors, textareas, radio groups, dialogs/popups, toast feedback, medication editors, label previews and pagers.

The Sticker Studio workspace has a fixed viewport shell. Patient and medication tools occupy the upper workspace; exactly six selectable labels appear in a 3×2 lower grid per page. Overflow is contained within the relevant editor, never allowed to expand the viewport. Mobile uses an internally scrollable upper workspace.

## Accessibility and print

Use visible focus, keyboard-operable sticker selection, labelled controls and reduced-motion support. Print CSS is generated separately with physical millimetre dimensions. Preview simplification does not remove printed clinical warnings or pharmacist review requirements.
