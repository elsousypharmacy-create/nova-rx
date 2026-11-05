# NOVA Rx Sticker Studio Redesign — integration notes

Date: 2026-11-06

## Scope

`sticker-studio.html` is a safe standalone redesign of the medication-sticker workflow. It was added without replacing the stale GitHub `index.html` or overwriting the newer live Cloudflare Worker UI.

The page implements the requested flow:

بيانات المريض ← الأدوية ← توليد AI ← مراجعة الاستيكرات ← إعدادات الطباعة ← الطباعة

## What is included

- Premium RTL Arabic interface using Cairo.
- Medication cards with editable dose, frequency, duration and instructions.
- Per-medication AI regeneration through the existing `/api/ai/medication-label` route.
- AI loading/error states that preserve the current draft.
- Incomplete drafts remain review-required and cannot be printed.
- Pharmacist approval gate before printing.
- Invoice queue compatibility with the existing `nova.label.invoices.v1` localStorage key.
- Draft persistence under `nova.stickerStudio.draft.v1`.
- Print settings persistence under `nova.stickerStudio.settings.v1`.
- Required presets: 50×30, 40×30, 40×25, 50×25, 58×40, 60×40, 70×50 and 100×50 mm.
- Custom dimensions, single/split paper, full/compact styles, margins, orientation, copies, physical-size preview and test print.
- Clean print window with generated `@page` dimensions.

## Logo status

The official owner-supplied logo image was referenced in the handoff but was not present in the uploaded files available to Kimi. The page therefore uses the existing owner-controlled logo URL already referenced by the repository UI:

`https://elsousypharmacy-create.github.io/pharmacy/logo-mark.png`

No substitute or newly invented logo was added. When the original image asset is supplied, add it under an assets path and replace the `LOGO` constant in `sticker-studio.html`.

## Integration recommendation

Do not deploy GitHub `index.html` over the live Worker until the current Worker source is exported and reconciled. The safest integration is to add a route or navigation link from the current live Worker to `sticker-studio.html`, then run browser QA on a preview deployment.
