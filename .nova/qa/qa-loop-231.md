# QA loop 231 (UX237) - chat date separators
Before: days older than yesterday showed `2026/11/12`; `.wa-date` was static.
After: last 2..6 days = weekday names (الخميس…), older = ar-EG long date, `.wa-date` sticky (top:6px) with blurred translucent pill. Changed in unified-inbox.js and the index.html inline copy.
Tests (mock API, Chromium via playwright in /tmp, no real PIN):
- node tests/ux/ux237-wa-dates.mjs -> ux237-wa-dates OK 28 separators
- node tests/ux/fix46-wa-history.mjs -> fix46-wa-history OK
- node tests/unit/ux200-wa-chat.check.mjs -> ux200-wa-chat OK (expectation updated to weekday)
- node tests/unit/unified-inbox.check.mjs -> pass
Screenshot: .nova/qa/qa-loop-231/ux237-sticky.png

# QA loop 231 — UX238 keyboard + screen reader in conversations
Fixed (index.html inbox block): h1 heading; #waSearch aria-label; #waList role=group+label; #waMsgs role=log, aria-live=polite, label, tabindex=-1; aria-current on the active chat; lock button aria-label; role=status on the lock-bar text; PIN focused on open and after every error; focus to back button (mobile) or #waMsgs on open; Escape/back returns focus to the chat button; ArrowUp/Down in the list (and from search); focus kept across redraws.
Tests (Playwright from /tmp, mocked history API, no real PIN): ux238-wa-keyboard OK (desktop+mobile), fix46-wa-history OK. Repro: node tools/qa/qa-loop-231.mjs. Screenshots in qa-loop-231/.
