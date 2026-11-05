# Sticker Studio — approved six-sticker single-screen update

Status: CSS implementation committed on this branch, integration into the standalone HTML and live Worker pending. Do not describe as deployed.

Integrate `sticker-six-layout.css` after the existing styles in `sticker-studio.html`, without replacing the newer Cloudflare Worker.

Required JS/HTML changes:
- Age defaults to 6 years, editable units years/months; weight remains optional.
- Two required radio groups pregnancy YES/NO and breastfeeding YES/NO, neither preselected; persist both with the draft and clear both on reset. Explicitly gate print on both answers and pharmacist approval.
- AI patient payload must use explicit pregnancy/breastfeeding values; do not infer from old patientSafety dropdown. Do not treat unanswered as NO.
- Render only `medications.slice(page*6,page*6+6)` in preview; use 3x2 CSS grid, pager controls and touch swipe RTL, clamp page after deletion. Sticker click toggles selected state, with keyboard access; selected-only print respects selected flags.
- Keep draft medication edits, per-drug retry and print dimensions intact. Messages must not resize viewport.
- Test 1/6/7/12 drugs, mobile/tablet landscape, refresh persistence, print safety gates, failed AI, selecting labels and pagination.
- Read HANDOFF.md and record tests, commit and deployment evidence before closing issue #14.
