# qa-loop-231 / UX240 — PIN lock bar merged into sidebar header
Change (index.html only): the standalone `.wa-lock` card is gone. The lock state (icon + text + small «قفل» button, 32px) lives in `.wa-side-head`; locked state shows a full-width PIN row (type=password, inputmode=numeric, show/hide toggle, fixed 84px submit that stays disabled/same width while busy; error row height reserved -> no layout shift). renderWa gained opts.lockHead / opts.lockForm.
Tests (run from a dir with playwright installed; chromium via CHROME_PATH):
- node tests/ux/ux240-wa-lock-bar.mjs -> `ux240-wa-lock-bar OK` (desktop 1280 + mobile 390: locked/toggle/busy/unlocked/error/empty, no non-GET, no page errors)
- node tests/ux/fix46-wa-history.mjs -> `fix46-wa-history OK`
- node tests/unit/unified-inbox.check.mjs -> pass; backend-inbox-history.check.mjs -> OK
Known: tests/unit/fix46-artifact.check.mjs fails on clean main too (worker artifact stale since UX229); not touched (deploy artifact). Screenshots: .nova/qa/qa-loop-231/ux240-*.png
