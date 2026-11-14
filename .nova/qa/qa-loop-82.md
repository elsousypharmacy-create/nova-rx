# تقرير QA رقم 82 — البيع السريع والباركود

> محلي فقط على واجهة المستودع الحالية (Playwright + Chromium، سطح مكتب 1366×768 وموبايل 390×844)، بيانات وهمية (`data/emergency-stock.json`). **0 طلب كتابة** (كل غير-GET محجوب)، لا نشر ولا اتصال بموردين.
> السكربت: `tools/qa/qa-loop-82.mjs` · الخام: `.nova/qa/qa-loop-82-raw.json` · اللقطات: `.nova/qa/qa-loop-82/` (12 صورة).
> قُرئت التقارير السابقة (ux-pro/pro2/pro2b/pro3/phase10) — لا تكرار لمشاكل الدفع المختلط/F4/البحث بالاسم العلمي.

## 1. التنقل (جولة سريعة)
| الشاشة | سطح مكتب | موبايل |
|---|---|---|
| البيع، الفواتير، المنتجات، العملاء، التقارير، الإعدادات | تعمل، لا فراغ ولا «Not found» | تعمل، لا فيض أفقي |
| المشتريات (`/purchases`) | 200 | 200 |
| المحادثات (`#novaInboxTab`) | تظهر فقط مع العلم `nova.flags.inbox=1`؛ تعمل (محادثة تجريبية) | نفس الشيء |
| أيقونة واتساب `#novaWaBtn` | بدون العلم تفتح `integrations/whatsapp/inbox.html` (فيها «رجوع للتطبيق»)؛ مع العلم تفتح تبويب المحادثات | نفس الشيء |
| `btnRefreshApp` | لم يُضغط (يعيد تحميل الصفحة) | — |

أخطاء الكونسول/HTTP: فقط `404 /api/whatsapp/chats` من الخادم الاستاتيكي المحلي (لا خلفية محلية) و`/favicon.ico` — **ليست علة في الواجهة** (النسخة الحية تخدمهما). لا أخطاء JavaScript.

## 2. البيع السريع والباركود — ما يعمل
- باركود دقيق + Enter يضيف السطر ويفرّغ الحقل؛ تكراره يزيد الكمية (2 → 300.00)؛ أرقام عربية (٣٠٠١٨٦٥٨) تُطبَّع وتُضاف؛ مسافات/Tab حول الباركود تُتجاهل؛ البحث بالاسم العربي/اللاتيني يعمل؛ `F2`/`F4` يبدآن فاتورة جديدة.

## 3. الملاحظات
**Q1 — متوسطة: باركود غير معروف + Enter صامت ويترك الرقم في الحقل.** القائمة تقول «لا توجد منتجات مطابقة»، لكن لا رسالة خطأ ولا صوت، ويبقى `9999999999999` في الحقل فيلتصق به الباركود التالي (مسح متتالٍ ⇒ رقم مشوّه ⇒ «لا نتائج» مضلّل). الكود: معالج `Enter` في وضع المنتج (`index.html` ~3320–3346) يتجاهل غياب النتيجة. (`d-barcode.png`)

**Q2 — متوسطة: «الرصيد null · منخفض» في اقتراحات البحث مع الأسعار الحقيقية.** القائمة السعرية (STOCK LIVE) بلا أرصدة، فيظهر في كل اقتراح «الرصيد null» مع وسم «منخفض» وزر «الموردين» (لأن `null < 30`)، فيبدو كل صنف ناقصاً. (`supplier-lookup.js` ~440–448؛ `d-null-stock.png`، `m-search.png`)

لم يُختبر: ماسح باركود فعلي (سرعة الإدخال الحقيقية)، الصوت، الطابعة، الشبكة الحقيقية.

## UX83 — unknown barcode + Enter
index.html Enter handler (PRODUCT mode): barcode-like query (digits only, >=6, Arabic digits included) with no exact match and no suggestions now shows the error toast 'لا يوجد صنف بهذا الباركود: <code>', keeps the 'سجّل نقص' button, and selects the input text. Test: tests/ui-ux83-unknown-barcode.mjs (5 checks pass); ui-pos01 (8), ui-cat05 (6), ui-pos05 pass.

## UX84 — unknown stock in suggestions
supplier-lookup.js decorateRow: non-finite stock now shows neutral 'غير متوفر' chip + icon-only suppliers button (no 'null', no 'منخفض'). Numeric stock unchanged (<30 low badge).
Tests: tests/ui-ux84-unknown-stock.mjs OK; ui-pos01-sale-flow OK (8 checks); ui-cat05-instant-search PASS (6 cases).
