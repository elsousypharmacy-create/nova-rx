# QA loop 231 — UX235
Bug: locked WhatsApp history showed fake chat 'عميل تجريبي (عرض محلي)' under the PIN form.
Fix (index.html): demo-1 seeded/shown only with localStorage nova.flags.localDemo=1 and labelled 'عرض تجريبي'; locked state shows lock-icon empty state in list pane (and main pane on desktop).
Tests (Playwright run from /tmp install, repo has no node_modules): ux235-locked-empty OK (flag off/on × desktop/mobile), fix46-wa-history OK, inbox-flag.mjs FAILS identically at baseline (stale selector section[data-conv], pre-existing, unrelated), unified-inbox.check.mjs pass.
Screenshots: .nova/qa/qa-loop-231/ux235-*.png

## UX234 - chat open loading/error state
- index.html: hist.pend/oerr per conversation; renderWa chatLoading/chatError -> skeleton + loading text with aria-busy on #waMsgs; inline role=alert error + retry button.
- Test: tests/ux/ux234-wa-chat-loading.mjs (mock delayed/failed history) PASS. Screenshots: ux234-loading.png, ux234-error.png.
- tests/ux/fix46-wa-history.mjs fails at "composer stays a disabled draft": pre-existing (same failure without my change; WA-SEND #408 enabled the composer).
