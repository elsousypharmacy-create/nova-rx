# تقرير QA رقم 219 — المرتجعات والاستردادات (فحص عميق)

> محلي فقط (Playwright + Chromium، 1366×768 و390×844)، بيانات وهمية (4 فواتير: نقدي/بطاقة/آجل/مشترك)، **0 طلب كتابة**، 0 اتصال خارجي، بلا نشر.
> السكربت: `tools/qa/qa-loop-219.mjs` · الخام: `.nova/qa/qa-loop-219-raw.json` · اللقطات (15): `.nova/qa/qa-loop-219/`.

## 1. الجولة السريعة
كل التبويبات (البيع، الفواتير، المنتجات، العملاء، التقارير، الإعدادات) + المشتريات (200) + المحادثات عبر `#novaWaBtn`: لا صفحة فارغة ولا «Not found» ولا 404 ولا فيض أفقي ولا أخطاء JS على الشاشتين. تبديل التبويب 27–75ms (المنتجات 207ms سطح المكتب / 98ms موبايل). فتح نافذة المرتجع 61–70ms وتأكيده 50ms. CLS أثناء الرحلة: 0.0065 (سطح مكتب) و0.0245 (موبايل).

## 2. إعادة فحص إصلاحات سابقة
UX204 (الشعار)، UX209 (أيقونة واتساب 36/44px)، UX208 (المحادثات داكنة)، UX205 (تنقل الموبايل): **تعمل** (`d-wa.png`). شاشة الدردشات القديمة بـPIN (FIX46) **لم تُختبر**: العرض المحلي لم يظهر نموذج PIN وبقيت محادثة العرض التجريبية فقط، فلم أصل لمسار `inbox/history`.

## 3. الملاحظات (الأعلى أثرًا أولًا) — كلها مُعاد إنتاجها
1. **عالية — فاتورة مرتجعة بالكامل/ملغاة** تبقى بزر «مرتجع / إلغاء» فعّال، والنافذة تُبقي «إرجاع كل الأصناف» و«تأكيد المرتجع» فعّالين بينما كل الحقول معطلة، بلا شارة حالة (`d-dlg-fully-returned.png`, `d-inv-cancelled.png`) → UX220.
2. **عالية — زر ✕ يغطي عنوان النافذة** فيُقص «مرتجع / إلغاء» (`d-dlg-open.png`, `m-dlg-open.png`) → UX221.
3. **عالية — خطأ «اكتب سبب المرتجع» يبقى** بعد اختيار السبب؛ وكمية أكبر من المتاح/كسر/سالب تمسح «مبلغ الإرجاع» بصمت بلا رسالة (`m-dlg-filled.png`) → UX222.
4. **عالية — لوحة المفاتيح:** لا حبس للـTab (بعد 14 ضغطة يخرج التركيز من النافذة)، وبعد Esc يذهب التركيز إلى BODY بدل زر الفاتورة → UX223.
5. **متوسطة — حقول «إلغاء الفاتورة» رمادية غير مصممة** (rgb 59/107) بلا labels؛ لا `label for` لحقل السبب ولا `aria-label` لحقول الكمية (`d-dlg-cancelbox.png`) → UX224.
6. **متوسطة — أزرار التأكيد تختفي تحت الطية** عند فتح الإلغاء على 1366×768، والشرائح تلتف يتيمة على الموبايل (`d-dlg-cancelbox.png`, `m-dlg-cancelbox.png`) → UX225.
7. **متوسطة — لا إشعار نجاح** بعد المرتجع (النافذة تُغلق بصمت) ولا ذكر لطريقة الرد ولا تراجع → UX226.
8. **متوسطة — أزرار جدول الفواتير** متطابقة رمادية معتمة تبدو معطلة (تباين 5.33 لكن بلا هرمية) (`d-invoices.png`, `m-invoices.png`) → UX227.
9. **منخفضة — سبب المرتجع وطريقة الرد محفوظان لكن غير معروضين** في الفواتير/التقارير (`d-reports.png`) → UX228.
10. **منخفضة — CLS 0.0245 موبايل** أثناء رحلة المرتجع → UX229.

سليم: رفض السبب الفارغ، رفض الاعتماد الذاتي، منع تجاوز الكمية عند التأكيد، حساب المبلغ نسبةً مما دُفع فعليًا، ملاحظة الآجل، قص الاسم الطويل بلا فيض، حفظ جزئي ثم كلي صحيح، انعكاس المرتجعات في التقارير.

## 4. الدرجات
«المرتجعات» 6.0 (8 ملاحظات مفتوحة)، «الفواتير» 7.5، «لوحة المفاتيح» 6.5؛ لا مجال ≥9.5. المحدّث في `.nova/qa/scorecard.json`.

لم يُختبر: أجهزة حقيقية، قارئ شاشة، طباعة إيصال المرتجع، سداد الآجل الفعلي، PIN المحادثات القديمة، شبكة حية.


## UX229 — إصلاح CLS
السبب: نافذة المرتجع (متمركزة) كانت تكبر ~30px عند ظهور «مبلغ الإرجاع» ورسالة الخطأ فتنزاح. الإصلاح: min-height لـ#novaRetAmount (22px) و#novaRetMsg (36px) في index.html. بعد الإصلاح CLS = 0 على 1366 و390 (tests/ui-ux229-returns-cls.mjs؛ قبله 0.0058 / 0.0223).


## UX227 — أزرار إجراءات الفواتير
«إعادة طباعة نسخة» = ghost (حد رمادي #5b6875، نص فاتح، تباين 13.7–14.9)، «مرتجع / إلغاء» = حد كهرماني + خلفية كهرمانية 10% (تباين 8.0)، مع أيقونتين SVG، ارتفاع 36px سطح المكتب / 44px اللمس، حالات hover/active/focus-visible، وعلى الموبايل جنبًا إلى جنب. index.html فقط. الاختبار: tests/ui-ux227-invoice-actions.mjs (17 فحصًا PASS)؛ ui-returns (10 PASS)، ui-pos04-returns-cancel (8 PASS)، ui-sales-ledger (8 PASS). لقطات في /tmp/ux227 (غير محفوظة في المستودع). لم يُختبر: أجهزة حقيقية، قارئ شاشة.

## UX226 — return confirmation toast (frontend only)
- index.html: `novaReturnNotice` (role=status live region: "تم تسجيل مرتجع بقيمة X — ردّ المبلغ نقدًا/على البطاقة/خصم من الآجل"), row highlight (static outline when prefers-reduced-motion), 10s undo via new `novaSales.removeReturn(id)`. Undo not offered for credit returns (customer-ledger collect cannot be reversed from the UI).
- Tests (run from a temp playwright install, chromium): ui-ux226-return-toast 6/6, ui-returns 10/10, ui-pos04-returns-cancel 8/8, ui-sales-ledger 8/8 — all PASS.

## UX223 — return dialog focus trap (frontend only)
- index.html: Tab/Shift+Tab trap, aria-labelledby on h3, focus restored to opener (or re-rendered same data-return button), body scroll locked while open.
- Tests (http.server :8765): ui-ux223-return-focus PASS; ui-returns PASS 10; ui-pos04-returns-cancel PASS 8; ui-sales-ledger PASS 8.
## UX224 — return dialog cancel-invoice fields (2026-11-14)
Fixed in index.html: cancel-box inputs/select styled like #novaRetReason, real `<label for>` (incl. reason label), per-qty `aria-label` with product name, disclosure summary with rotating chevron, danger-tone confirm button. Test: tests/ui-ux224-return-fields.mjs (9 cases PASS). Also PASS: ui-returns (10), ui-pos04-returns-cancel (8), ui-sales-ledger (8).
