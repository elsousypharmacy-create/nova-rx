# QA loop 231 — UX235
Bug: locked WhatsApp history showed fake chat 'عميل تجريبي (عرض محلي)' under the PIN form.
Fix (index.html): demo-1 seeded/shown only with localStorage nova.flags.localDemo=1 and labelled 'عرض تجريبي'; locked state shows lock-icon empty state in list pane (and main pane on desktop).
Tests (Playwright run from /tmp install, repo has no node_modules): ux235-locked-empty OK (flag off/on × desktop/mobile), fix46-wa-history OK, inbox-flag.mjs FAILS identically at baseline (stale selector section[data-conv], pre-existing, unrelated), unified-inbox.check.mjs pass.
Screenshots: .nova/qa/qa-loop-231/ux235-*.png

# QA loop 231 — UX233 (chat list scroll kept on open/back)
Bug: draw() rebuilt the view and reset #waList scrollTop to 0 on open and on mobile back; chat just left not highlighted.
Fix (index.html inbox block): wa.top tracked by capture scroll listener on #waList; draw() restores it; back sets wa.back so the chat just left gets .active and is scrolled into view.
Tests (Playwright from /tmp install): tests/ux/ux233-wa-list-scroll.mjs OK (22 chats, desktop+mobile). unified-inbox.check.mjs: 4 passed. fix46-wa-history.mjs FAILS at "composer stays a disabled draft", identical at baseline (pre-existing).
Screenshots: .nova/qa/qa-loop-231/ux233-*.png
