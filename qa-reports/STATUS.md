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
