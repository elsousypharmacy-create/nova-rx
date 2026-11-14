# QA loop 231 (UX237) - chat date separators
Before: days older than yesterday showed `2026/11/12`; `.wa-date` was static.
After: last 2..6 days = weekday names (الخميس…), older = ar-EG long date, `.wa-date` sticky (top:6px) with blurred translucent pill. Changed in unified-inbox.js and the index.html inline copy.
Tests (mock API, Chromium via playwright in /tmp, no real PIN):
- node tests/ux/ux237-wa-dates.mjs -> ux237-wa-dates OK 28 separators
- node tests/ux/fix46-wa-history.mjs -> fix46-wa-history OK
- node tests/unit/ux200-wa-chat.check.mjs -> ux200-wa-chat OK (expectation updated to weekday)
- node tests/unit/unified-inbox.check.mjs -> pass
Screenshot: .nova/qa/qa-loop-231/ux237-sticky.png
