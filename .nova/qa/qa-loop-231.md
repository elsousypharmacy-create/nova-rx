# UX236 — inbox search (qa-loop-231)
Fix: normAr() in unified-inbox.js + inline copy in index.html; searches name, id/phone, all message text; hamza/tashkeel/tatweel/ya/ta-marbuta/Arabic-Indic digits folded; 'لا نتائج لـ "…"'; × clear button (#waSearchClear).
Passed: tests/unit/ux236-wa-search.check.mjs (7), unified-inbox.check, fix43, ux81, ux200 unit tests.
NOT run: tests/ux/ux236-wa-search.mjs and fix46-wa-history.mjs — @playwright/test not installed in this environment (ERR_MODULE_NOT_FOUND). No screenshots captured.
