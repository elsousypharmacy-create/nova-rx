# Sticker Studio — six-sticker single-screen update

Status: implemented and locally verified on `fix/sticker-six-pager-20261106`; not merged or deployed.

## Implemented

- Fixed viewport workspace with patient and medication tools above a six-label preview.
- Age defaults to six years with years/months units; weight remains optional.
- Pregnancy and breastfeeding require explicit yes/no answers for final printing and remain `null` in AI payloads while unanswered.
- Six selectable/editable labels per 3×2 page, RTL pager and touch navigation for larger prescriptions.
- Local draft persistence with renewed pharmacist approval required after reload or clinical edits.
- Per-medication AI retry, contained errors and stale-response protection for manual edits.
- Selected-only and print-all behavior, physical print dimensions and incomplete-draft blocking.
- Consolidated stylesheet without the former stacked override blocks; validated owner-controlled logo.

## Verification

`npm run check` passed. `npm run test:browser` passed 41/41 Chromium checks and captured 1024×768, 1180×820, 1366×768, 1440×900 and 390×844 screenshots. Physical printers, the live Worker and the real AI provider remain unverified.

## Release boundary

Do not replace the live Worker with stale GitHub HTML. Reconcile this standalone module with the current Worker source, open an isolated preview and repeat browser, AI and physical print QA before release.
