# NOVA Rx — Engineering Decisions

## 2026-11-06

- Continued `fix/sticker-six-pager-20261106` because it already contained approved issue #14 work; avoided a duplicate implementation.
- Kept Sticker Studio standalone and did not replace `index.html` or the newer live Worker.
- Consolidated stacked Sticker Studio overrides into one fixed-screen stylesheet with contained editor overflow and a 3×2 pager.
- Represent unanswered pregnancy and breastfeeding as `null`; never infer a negative clinical answer.
- Invalidate pharmacist approval after patient, medication, invoice or AI workflow changes and after reload.
- Ignore stale AI responses when the pharmacist edited a medication during generation, preserving manual text.
- Distinguished selected-only printing from print-all; incomplete or unapproved clinical labels remain blocked.
- Replaced the corrupt embedded JPEG reference with the existing owner-controlled pharmacy logo URL after validating the source image.
- Added reproducible Playwright browser checks and a minimal static development server. No production backend or deployment was introduced.
