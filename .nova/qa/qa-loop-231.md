# QA loop 231 — UX235
Bug: locked WhatsApp history showed fake chat 'عميل تجريبي (عرض محلي)' under the PIN form.
Fix (index.html): demo-1 seeded/shown only with localStorage nova.flags.localDemo=1 and labelled 'عرض تجريبي'; locked state shows lock-icon empty state in list pane (and main pane on desktop).
Tests (Playwright run from /tmp install, repo has no node_modules): ux235-locked-empty OK (flag off/on × desktop/mobile), fix46-wa-history OK, inbox-flag OK (now sets localDemo flag), unified-inbox.check.mjs pass.
Screenshots: .nova/qa/qa-loop-231/ux235-*.png
