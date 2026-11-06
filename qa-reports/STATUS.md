# NOVA Rx — QA STATUS

- Last tested SHA: `85b8209d16254ab7ec6fdf3a72e2718c8762393a` (branch `kimi/issue-2-42022855182`, Kimi fix for issue #2)
- Previous tested SHA: `9410b646ae4e1fd74de18e162cd4041929616fd3` (main) — score 55/100
- Date: 2026-11-05 (Asia/Riyadh)
- Score: **64/100** — issue #2 fix accepted (5/5 FIXED); not yet ready for daily use (open P1s)
- Unique issues (aliases merged): FIXED=5 · NEW=3 · STILL PRESENT=16 · open P0=0 · open P1=8 (5 UX + 3 product-scope)
- Product-scope gaps: 7 (unchanged)

| ID | Priority | Status | Last tested SHA | Notes |
|---|---|---|---|---|
| `UX-DISCOUNT-LOST-RELOAD` | P0 | FIXED | `85b8209` | alias P0-CALC-PERSIST — 63.85→63.85 بعد reload |
| `P0-CALC-PERSIST` | P0 | FIXED | `85b8209` | alias of UX-DISCOUNT-LOST-RELOAD |
| `UX-SEARCH-OVERLAP` | P1 | FIXED | `85b8209` | alias P1-UI-SEARCH-OVERLAP — نقر المركز يبدّل الوضع على 4 أحجام |
| `P1-UI-SEARCH-OVERLAP` | P1 | FIXED | `85b8209` | alias of UX-SEARCH-OVERLAP |
| `UX-CUSTOMER-LOST-RELOAD` | P1 | FIXED | `85b8209` | alias P1-FUNC-CUSTOMER-DRAFT |
| `P1-FUNC-CUSTOMER-DRAFT` | P1 | FIXED | `85b8209` | alias of UX-CUSTOMER-LOST-RELOAD |
| `UX-RECEIPT-CLOSE-BLOCKED` | P1 | FIXED | `85b8209` | × يغلق الإيصال؛ ما بعده في UX-LABELS-PANEL-BLOCKS-NEXT-SALE |
| `UX-I18N-PAGEERROR` | P1 | FIXED | `85b8209` | alias P1-ENG-I18N-DATASET — 0 pageerror |
| `P1-ENG-I18N-DATASET` | P1 | FIXED | `85b8209` | alias of UX-I18N-PAGEERROR |
| `UX-LABELS-PANEL-BLOCKS-NEXT-SALE` | P1 | NEW | `85b8209` | لوحة الاستيكرات تحجب شاشة البيع بعد كل دفع؛ كتابة عمياء في البحث |
| `UX-MIXED-LANG` | P1 | STILL PRESENT | `85b8209` | alias P1-UX-MIXED-LANG |
| `P1-UX-MIXED-LANG` | P1 | STILL PRESENT | `85b8209` | alias of UX-MIXED-LANG |
| `UX-LANG-SWITCH-WEAK` | P1 | STILL PRESENT | `85b8209` | English لا يغيّر lang/dir/الواجهة |
| `UX-FAB-OVERLAP-mobile` | P1 | STILL PRESENT | `85b8209` | alias P1-UI-MOBILE-FAB |
| `P1-UI-MOBILE-FAB` | P1 | STILL PRESENT | `85b8209` | alias of UX-FAB-OVERLAP-mobile |
| `UX-CHECKOUT-OVERLAY-LEAK` | P1 | STILL PRESENT | `85b8209` | حالة تقنية فقط بلا أثر مرئي ولا اعتراض نقر — توصية خفض إلى P3/إغلاق بقرار ChatGPT |
| `UX-NO-RETURNS-NAV` | P2 | STILL PRESENT | `85b8209` | also tracked as GAP-RETURNS |
| `P1-FUNC-NO-RETURNS` | P1 | STILL PRESENT | `85b8209` | product gap + nav absence; see GAP-RETURNS |
| `UX-SEARCH-EMPTY` | P2 | STILL PRESENT | `85b8209` |  |
| `UX-DISCOUNT-NO-FEEDBACK` | P2 | STILL PRESENT | `85b8209` | يشمل الآن القيم السالبة المقبولة بصمت |
| `UX-AI-NO-RETRY` | P2 | STILL PRESENT | `85b8209` | alias P2-UX-AI-RETRY |
| `P2-UX-AI-RETRY` | P2 | STILL PRESENT | `85b8209` | alias of UX-AI-NO-RETRY |
| `UX-FAB-MISLABEL` | P2 | STILL PRESENT | `85b8209` | alias P2-UX-FAB-MISLABEL |
| `P2-UX-FAB-MISLABEL` | P2 | STILL PRESENT | `85b8209` | alias of UX-FAB-MISLABEL |
| `UX-PRODUCTS-FILTER-EMPTY` | P2 | STILL PRESENT | `85b8209` |  |
| `UX-NEW-SALE-MODE` | P3 | STILL PRESENT | `85b8209` | alias P2-UX-NEW-SALE-MODE |
| `P2-UX-NEW-SALE-MODE` | P2 | STILL PRESENT | `85b8209` | alias of UX-NEW-SALE-MODE (priority reframed P3 in UX audit) |
| `UX-EMPTY-CHECKOUT-NO-HINT` | P3 | STILL PRESENT | `85b8209` |  |
| `UX-TOAST-EN` | P3 | STILL PRESENT | `85b8209` |  |
| `UX-TOAST-COVERS-CHECKOUT` | P3 | NEW | `85b8209` | 1194×834 و1366×768 |
| `UX-DISCOUNT-ZERO-FIELD-CLEARED` | P3 | NEW | `85b8209` | شكلي؛ الإجمالي ثابت |
| `P1-FUNC-NO-STOCK-LEDGER` | P1 | STILL PRESENT | `85b8209` | tracked as GAP-STOCK-LEDGER (product scope) |
| `P1-ENG-NO-RBAC` | P1 | STILL PRESENT | `85b8209` | tracked as GAP-RBAC (product scope) |

## Product-scope gaps

| ID | Title | Last tested SHA |
|---|---|---|
| `GAP-ITEM-DISCOUNT` | خصم على مستوى الصنف غير ظاهر في واجهة السلة | `85b8209` |
| `GAP-RETURNS` | لا يوجد مسار مرتجعات في التنقل أو شاشة مخصصة | `85b8209` |
| `GAP-STOCK-LEDGER` | البيع لا يُحدّث رصيد المخزون الظاهر (بيانات تجريبية ثابتة كما تصرّح الشاشة) | `85b8209` |
| `GAP-INVOICE-LEDGER` | سجل الفواتير المعروض بيانات تجريبية وليس سجل مبيعات محفوظًا | `85b8209` |
| `GAP-CUSTOMER-CRUD` | إدارة عملاء كاملة (إضافة/تعديل مستمرة) غير متاحة — دليل تجريبي | `85b8209` |
| `GAP-RBAC` | لا نظام مستخدمين/صلاحيات بعد — مصرّح في الإعدادات | `85b8209` |
| `GAP-PURCHASES-PAGE` | لا تبويب مشتريات مستقل — الدخول عبر زر AI في المنتجات | `85b8209` |

## Playwright smoke runs (readiness only — technical failures handled by ChatGPT/Kimi)

| Run | SHA | Branch | Conclusion | Failed step | UX review |
|---|---|---|---|---|---|
| [42073141915](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42073141915) | `4c0aa71` | main | failure | Install Chromium | not ready: Playwright failure, run 42073141915 |
| [42073357913](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42073357913) | `61c0928` | main | failure | Install Chromium | not ready: Playwright failure, run 42073357913 |
| [42101365952](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42101365952) | `04ce8b4` | kimi/issue-4-42100548728-clean | failure | Install Chromium | n/a (no review_ready) |
| [42101553795](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42101553795) | `4720ed8` | main | failure | Install Chromium | n/a (no review_ready) |
| [42118437660](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42118437660) | `3e0e1e3` | fix/gemini-sticker-reliability | failure | Install Chromium | not ready: Playwright failure, run 42118437660 |
| [42118944756](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42118944756) | `e7ffd52` | main | failure | Install Chromium | n/a (no review_ready) |
| [42121545477](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42121545477) | `3843ddc` | feature/sticker-studio-redesign | failure | Install Chromium | not ready: Playwright failure, run 42121545477 |
| [42122059687](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42122059687) | `efe4fad` | main | failure | Install Chromium | n/a (no review_ready) |
| — | `701d87b` | fix/sticker-six-pager-20261106 | — | — | not ready: no Playwright run for this SHA |
| — | `3ac281e` | fix/sticker-six-pager-20261106 | — | — | not ready: no Playwright run for this SHA |
| [42167419279](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42167419279) | `b43fff8` | fix/sticker-six-pager-20261106 | failure | Install Chromium | not ready: Playwright failure, run 42167419279 |
| [42176392316](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42176392316) | `24fd601` | main | failure | Install Chromium | n/a (no review_ready) |
| — | `7fd8b4d` | ux/sticker-modal-85pct-20261106 | — | — | not ready: no Playwright run for this SHA |


## Readiness updates — 2026-11-06 (Asia/Riyadh)

| SHA | Branch | Task | State | Notes |
|---|---|---|---|---|
| `f3e609bfdf022a22e6047e25484f01a6694a7a2f` | `kimi/issue-16-42254828034-clean` | ISSUE-16 | IN_PROGRESS | new_branch (fix: address NOVA Rx issue #16 via Kimi (clean); supplier-compare.html + worker/unit) — no UX review |
| `e3d9a169a196fe3a3a210e479fd4e9089346cf27` | `main` | ISSUE-16 | IN_PROGRESS | kimi_run_started [42254828034](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42254828034) — Supplier price comparison prototype using mock data (issue #16); no UX review |
| `e3d9a169a196fe3a3a210e479fd4e9089346cf27` | `main` | STICKER-SIX | IN_PROGRESS | new_commit without review_ready (Redesign Sticker Studio: compact patient card, medication tabs, large hero preview, fixed review/print bar, settings drawer; ignore generated tests/.sticker-studio-inline.js) — no UX review |
| `5128b402f73328003bb26312fe02328bd62b222c` | `main` | STICKER-SIX | IN_PROGRESS | new_commit without review_ready (Redesign Sticker Studio premium single-medication focus layout) — no UX review |
| `8c77ede985ba7168f80b3750af01850ce37df265` | `main` | STICKER-SIX | IN_PROGRESS | new_commit without review_ready (style: compact unified patient-first workspace) — no UX review |
| `693cb97dab1f998b2e7482eed11965ad87f3b336` | `main` | STICKER-MODAL-85 | IN_PROGRESS | new_commit without review_ready (style: studio workspace 85% width on large screens) — no UX review |
| `5a46020260b3c1007e5594c1658a8bfdc98c862e` | `ux/sticker-modal-85pct-20261106` | STICKER-MODAL-85 | IN_PROGRESS | new_commit without review_ready (docs: HANDOFF.md checkpoint sticker dialog 85% viewport) — no UX review |
| `b43fff866f0a494979256af78f831475460f9458` | `fix/sticker-six-pager-20261106` | STICKER-SIX | not ready | not ready: Playwright failure, run 42167419279 (Install Chromium); PR [#15](https://github.com/elsousypharmacy-create/nova-rx/pull/15) opened on this SHA — no UX review; technical side left to ChatGPT/Kimi |
| `3ac281ef565a40d522fad38c7222a7f4d1070898` | `fix/sticker-six-pager-20261106` | STICKER-SIX | not ready | not ready: no successful Playwright run for this SHA (review_ready emitted without playwright_conclusion; pw=None) — no UX review; technical side left to ChatGPT/Kimi |
| `701d87bbf6188dc3c6ec306621db0ec8af0c20e1` | `fix/sticker-six-pager-20261106` | STICKER-SIX | not ready | not ready: no successful Playwright run for this SHA (review_ready emitted without playwright_conclusion; workflow paths did not trigger smoke) — no UX review; technical side left to ChatGPT/Kimi |
| `0d2c11b7a537c23cad73e1eb8a7b19f7839025c6` | `main` | STICKER-SIX | IN_PROGRESS | new_commit without review_ready (sticker controls / print overflow) — no UX review |
| `24fd601b3c341b676570b945e26fe757c5e684c8` | `main` | STICKER-SIX | IN_PROGRESS | new_commit without review_ready (merge PR #15 six-label studio); Playwright failure run [42176392316](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/42176392316) (Install Chromium) recorded — no UX review |
| `7fd8b4df9366ddcbbf85a4dfab2a78b218cbd13b` | `ux/sticker-modal-85pct-20261106` | STICKER-MODAL-85 | not ready | not ready: no successful Playwright run for this SHA (review_ready emitted without playwright_conclusion; pw=None) — no UX review; technical side left to ChatGPT/Kimi |
| `04ce8b484d084834a4c96988867a02d923b05c33` | `kimi/issue-4-42100548728-clean` | ISSUE-4 | — | monitor `pr_missing` after ~5010s; PR [#6](https://github.com/elsousypharmacy-create/nova-rx/pull/6) already MERGED from this branch/SHA at 2026-11-05 23:14 Asia/Riyadh |


