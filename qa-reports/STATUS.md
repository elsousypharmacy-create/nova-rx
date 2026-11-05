# NOVA Rx — QA STATUS

- Last tested SHA: `9410b646ae4e1fd74de18e162cd4041929616fd3`
- Date: 2026-11-05 (Asia/Riyadh)
- Score: **55/100** — Blocked for daily use
- Issues in latest report: 17 (NEW=5, STILL PRESENT=12, FIXED=0)
- Product-scope gaps: 7

| ID | Priority | Status | Last tested SHA | Notes |
|---|---|---|---|---|
| `UX-DISCOUNT-LOST-RELOAD` | P0 | STILL PRESENT | `9410b64` | alias P0-CALC-PERSIST |
| `P0-CALC-PERSIST` | P0 | STILL PRESENT | `9410b64` | alias of UX-DISCOUNT-LOST-RELOAD |
| `UX-SEARCH-OVERLAP` | P1 | STILL PRESENT | `9410b64` | alias P1-UI-SEARCH-OVERLAP |
| `P1-UI-SEARCH-OVERLAP` | P1 | STILL PRESENT | `9410b64` | alias of UX-SEARCH-OVERLAP |
| `UX-MIXED-LANG` | P1 | STILL PRESENT | `9410b64` | alias P1-UX-MIXED-LANG |
| `P1-UX-MIXED-LANG` | P1 | STILL PRESENT | `9410b64` | alias of UX-MIXED-LANG |
| `UX-CUSTOMER-LOST-RELOAD` | P1 | STILL PRESENT | `9410b64` | alias P1-FUNC-CUSTOMER-DRAFT |
| `P1-FUNC-CUSTOMER-DRAFT` | P1 | STILL PRESENT | `9410b64` | alias of UX-CUSTOMER-LOST-RELOAD |
| `UX-RECEIPT-CLOSE-BLOCKED` | P1 | STILL PRESENT | `9410b64` |  |
| `UX-I18N-PAGEERROR` | P1 | STILL PRESENT | `9410b64` | alias P1-ENG-I18N-DATASET |
| `P1-ENG-I18N-DATASET` | P1 | STILL PRESENT | `9410b64` | alias of UX-I18N-PAGEERROR |
| `UX-FAB-OVERLAP-mobile` | P1 | STILL PRESENT | `9410b64` | alias P1-UI-MOBILE-FAB |
| `P1-UI-MOBILE-FAB` | P1 | STILL PRESENT | `9410b64` | alias of UX-FAB-OVERLAP-mobile |
| `UX-CHECKOUT-OVERLAY-LEAK` | P1 | NEW | `9410b64` |  |
| `UX-LANG-SWITCH-WEAK` | P1 | NEW | `9410b64` |  |
| `UX-NO-RETURNS-NAV` | P2 | STILL PRESENT | `9410b64` | also tracked as GAP-RETURNS |
| `P1-FUNC-NO-RETURNS` | P1 | STILL PRESENT | `9410b64` | product gap + nav absence; see GAP-RETURNS |
| `UX-SEARCH-EMPTY` | P2 | STILL PRESENT | `9410b64` |  |
| `UX-DISCOUNT-NO-FEEDBACK` | P2 | STILL PRESENT | `9410b64` |  |
| `UX-AI-NO-RETRY` | P2 | STILL PRESENT | `9410b64` | alias P2-UX-AI-RETRY |
| `P2-UX-AI-RETRY` | P2 | STILL PRESENT | `9410b64` | alias of UX-AI-NO-RETRY |
| `UX-FAB-MISLABEL` | P2 | STILL PRESENT | `9410b64` | alias P2-UX-FAB-MISLABEL |
| `P2-UX-FAB-MISLABEL` | P2 | STILL PRESENT | `9410b64` | alias of UX-FAB-MISLABEL |
| `UX-PRODUCTS-FILTER-EMPTY` | P2 | NEW | `9410b64` |  |
| `UX-NEW-SALE-MODE` | P3 | STILL PRESENT | `9410b64` | alias P2-UX-NEW-SALE-MODE |
| `P2-UX-NEW-SALE-MODE` | P2 | STILL PRESENT | `9410b64` | alias of UX-NEW-SALE-MODE (priority reframed P3 in UX audit) |
| `UX-EMPTY-CHECKOUT-NO-HINT` | P3 | NEW | `9410b64` |  |
| `UX-TOAST-EN` | P3 | NEW | `9410b64` |  |
| `P1-FUNC-NO-STOCK-LEDGER` | P1 | STILL PRESENT | `9410b64` | tracked as GAP-STOCK-LEDGER (product scope) |
| `P1-ENG-NO-RBAC` | P1 | STILL PRESENT | `9410b64` | tracked as GAP-RBAC (product scope) |

## Product-scope gaps

| ID | Title | Last tested SHA |
|---|---|---|
| `GAP-ITEM-DISCOUNT` | خصم على مستوى الصنف غير ظاهر في واجهة السلة | `9410b64` |
| `GAP-RETURNS` | لا يوجد مسار مرتجعات في التنقل أو شاشة مخصصة | `9410b64` |
| `GAP-STOCK-LEDGER` | البيع لا يُحدّث رصيد المخزون الظاهر (بيانات تجريبية ثابتة كما تصرّح الشاشة) | `9410b64` |
| `GAP-INVOICE-LEDGER` | سجل الفواتير المعروض بيانات تجريبية وليس سجل مبيعات محفوظًا | `9410b64` |
| `GAP-CUSTOMER-CRUD` | إدارة عملاء كاملة (إضافة/تعديل مستمرة) غير متاحة — دليل تجريبي | `9410b64` |
| `GAP-RBAC` | لا نظام مستخدمين/صلاحيات بعد — مصرّح في الإعدادات | `9410b64` |
| `GAP-PURCHASES-PAGE` | لا تبويب مشتريات مستقل — الدخول عبر زر AI في المنتجات | `9410b64` |
