# NOVA Rx — تقرير خط أساس UX/UI (Baseline Visual Audit)

| الحقل | القيمة |
|---|---|
| **Commit المراجع** | `9410b646ae4e1fd74de18e162cd4041929616fd3` — Persist unfinished NOVA Rx invoice across page reloads |
| **التاريخ** | 2026-11-05 (Asia/Riyadh) |
| **المالك** | Ahmed Elsousy |
| **البيئة** | استنساخ محلي لـ `main` + `python3 -m http.server`؛ Chromium headless عبر Playwright؛ بدون مراجعة للكود المصدري |
| **Viewports** | Desktop 1920×1080، Laptop 1366×768، Tablet landscape 1194×834 (ومقارنة جوال 390×844) |
| **الدرجة الكلية** | **60/100** |
| **الحكم** | **غير جاهز للتشغيل اليومي (Needs Work)** — يوجد P0 يفقد بيانات مالية بعد إعادة التحميل |

## تفصيل الدرجة

| المحور | الدرجة | ملاحظات موجزة |
|---|---:|---|
| Usability سهولة التشغيل | 18/35 | مسار بيع 3 أصناف ≈ 9 إجراءات؛ لكن ضياع الخصم/العميل بعد reload، وsearchModeTag غير قابل للنقر، وإغلاق الإيصال محجوب |
| Design التصميم | 21/30 | هوية داكنة فاخرة (Cairo، RTL، تباين أزرار الدفع جيد)؛ لا overflow على الـ viewports المطلوبة؛ خلط إنجليزي يضعف الفخامة المحلية |
| Information clarity وضوح المعلومات | 8/15 | لا رسالة «لا نتائج»؛ خصم 999% بلا تنبيه؛ تسميات EN في NET TOTAL/CHECKOUT |
| Responsiveness الاستجابة | 7/10 | تفاعل سريع على سطح المكتب/اللابتوب/التابلت؛ تداخل FAB على الجوال؛ بعد offline يكون حقل البحث غير ظاهر |
| Consistency الاتساق | 6/10 | إطار موحّد للأزرار/الأيقونات؛ لكن خلط لغوي + تسمية FAB مضللة |
| **المجموع** | **60/100** | |

## ملخص تنفيذي للصّيدلي تحت الضغط

- بيع نموذجي لـ 3 أصناف (تخطي العميل، بدون خصم): **9 إجراءات** ≈ 22 ضغطة مفاتيح أسماء + 3 Enter + 3 نقرات ماوس — سريع ومقبول.
- البنود تُستعاد بعد reload، لكن **الخصم يختفي ويتغيّر الإجمالي** (مثال مثبت: 126.90 → 141.00 SAR) و**العميل المرفق يضيع**.
- شارة وضع البحث `منتج` ظاهرة لكن `pointer-events: none` ومغطاة بحقل البحث — التبديل بالماوس مستحيل (F3 فقط).
- بعد إتمام الدفع، زر ✕ في الإيصال يُعترض بواسطة `#emptyInvoiceState` (الزر يبدو يعمل ولا يستجيب).

## المشاكل المثبتة

عدد المشاكل حسب الأولوية: **P0=1 · P1=6 · P2=4 · P3=1**

### 1. [P0] UX-DISCOUNT-LOST-RELOAD — ضياع خصم الفاتورة/تغيّر الإجمالي بعد إعادة التحميل

- **الشاشة:** البيع / المسودة
- **الوصف:** قبل: pct=10 grand=126.90 SAR؛ بعد: pct= grand=141.00 SAR
- **خطوات إعادة الإنتاج:** أضف أصنافًا → خصم 10% → لاحظ الإجمالي → أعد تحميل الصفحة.
- **لقطة:** [`shots/17-after-reload-persist.png`](shots/17-after-reload-persist.png)
- **أثر UX:** فقد بيانات مالية تحت ضغط العمل؛ خطر تحصيل مبلغ خاطئ.
- **إصلاح محدد:** زامن state مع حقلي الخصم عند كل إدخال، واملأ الحقول من المسودة عند الاستعادة.
- **معيار قبول Kimi:** بعد reload يظهر نفس الإجمالي ونفس قيمة حقل الخصم.

### 2. [P1] UX-CUSTOMER-LOST-RELOAD — العميل المرفق يُفقد بعد إعادة التحميل

- **الشاشة:** البيع / المسودة
- **الوصف:** قبل: 'د. طارق المنصور' → بعد: ''
- **خطوات إعادة الإنتاج:** أرفق عميلاً مع أصناف ثم أعد تحميل الصفحة.
- **لقطة:** [`shots/17-after-reload-persist.png`](shots/17-after-reload-persist.png)
- **أثر UX:** فقد سياق الولاء أثناء انقطاع الصفحة.
- **إصلاح محدد:** احفظ customerId في المسودة واستعد العرض.
- **معيار قبول Kimi:** بعد reload يبقى نفس العميل ظاهرًا.

### 3. [P1] UX-FAB-MOBILE-OVERLAP — تداخل الزر العائم مع زر الدفع على 390×844

- **الشاشة:** البيع / جوال
- **الوصف:** تقاطع هندسي مثبت: {'overlap': True, 'a': {'l': 18, 't': 780, 'w': 124, 'h': 46}, 'b': {'l': 6, 't': 770, 'w': 377, 'h': 67}}
- **خطوات إعادة الإنتاج:** Viewport 390×844 مع صنف في السلة.
- **لقطة:** [`shots/61-mobile-390-fab.png`](shots/61-mobile-390-fab.png)
- **أثر UX:** قد يمنع إتمام البيع على الجوال.
- **إصلاح محدد:** أخفِ أو حرّك FAB عند ظهور زر الدفع.
- **معيار قبول Kimi:** لا تقاطع بين FAB وزر الدفع على 390×844.

### 4. [P1] UX-I18N-PAGEERROR — أخطاء صفحة من متحكّم اللغة

- **الشاشة:** عام
- **الوصف:** ["Failed to set a named property 'novaOriginalaria-label' on 'DOMStringMap': 'novaOriginalaria-label' is not a valid property name.", "Failed to set a named property 'novaOriginalaria-label' on 'DOMStringMap': 'novaOriginalaria-label' is not a valid property name."]
- **خطوات إعادة الإنتاج:** جلسة بيع عادية.
- **لقطة:** —
- **أثر UX:** قد يكسر الترجمة.
- **إصلاح محدد:** لا تستخدم dataset لمفتاح aria-label.
- **معيار قبول Kimi:** جلسة بلا هذا الـ pageerror.

### 5. [P1] UX-MIXED-LANG — واجهة عربية مختلطة بنصوص إنجليزية كثيرة

- **الشاشة:** البيع / شريط الأدوات
- **الوصف:** ظاهرة: ['CHECKOUT', 'NET TOTAL', 'Walk-in', 'Exact', 'Cancel (Esc)', 'F9 / Pay']
- **خطوات إعادة الإنتاج:** افتح شاشة البيع باللغة الافتراضية (ar).
- **لقطة:** [`shots/02-mixed-language-ui.png`](shots/02-mixed-language-ui.png)
- **أثر UX:** حمل معرفي على الصيدلي ويضعف هوية المنتج المحلي.
- **إصلاح محدد:** أكمل تعريب تسميات الأزرار والفوتر والمودالات مع الإبقاء على اختصارات F-keys.
- **معيار قبول Kimi:** في lang=ar لا تظهر تسميات أزرار إنجليزية في شريط البيع (باستثناء العلامة).

### 6. [P1] UX-RECEIPT-CLOSE-BLOCKED — زر إغلاق الإيصال محجوب بطبقة emptyInvoiceState

- **الشاشة:** الإيصال
- **الوصف:** elementFromPoint على مركز #btnCloseReceipt يعيد #emptyInvoiceState. قياسات: {'btnVisible': True, 'topId': 'emptyInvoiceState', 'topCls': 'empty-invoice-state', 'receiptHidden': False}
- **خطوات إعادة الإنتاج:** أتمم بيعًا حتى يظهر الإيصال ثم حاول إغلاقه بالزر ✕.
- **لقطة:** [`shots/24-receipt-preview.png`](shots/24-receipt-preview.png)
- **أثر UX:** الصيدلي لا يستطيع إغلاق الإيصال بالزر الظاهر؛ يبدو أنه يعمل لكنه لا يستجيب.
- **إصلاح محدد:** ارفع z-index لمودال الإيصال فوق empty state، أو أخفِ emptyInvoiceState طوال فتح الإيصال، وفعّل pointer-events بشكل صحيح.
- **معيار قبول Kimi:** النقر على ✕ يغلق الإيصال فورًا دون اعتراض طبقات أخرى.

### 7. [P1] UX-SEARCH-OVERLAP — زر وضع البحث مغطى بحقل الإدخال وغير قابل للنقر

- **الشاشة:** البيع / البحث
- **الوصف:** elementFromPoint → mainSearchInput; z=2 pe=none
- **خطوات إعادة الإنتاج:** حاول النقر على شارة Product/Customer داخل شريط البحث.
- **لقطة:** [`shots/03-search-mode-tag.png`](shots/03-search-mode-tag.png)
- **أثر UX:** لا يمكن تبديل وضع البحث بالماوس؛ الاعتماد على F3 فقط.
- **إصلاح محدد:** ارفع z-index وpointer-events للشارة مع padding صحيح في RTL.
- **معيار قبول Kimi:** النقر على مركز الشارة يبدّل الوضع دون تركيز الحقل.

### 8. [P2] UX-DISCOUNT-NO-FEEDBACK — قبول خصم مبالغ فيه بلا رسالة توجيهية

- **الشاشة:** البيع / الخصم
- **الوصف:** pct=999 والناتج=0.00 SAR بلا رسالة خطأ ظاهرة.
- **خطوات إعادة الإنتاج:** أدخل 999 في خصم %.
- **لقطة:** [`shots/70-invalid-discount.png`](shots/70-invalid-discount.png)
- **أثر UX:** قد يُنفَّذ بيع بخصم غير مقصود.
- **إصلاح محدد:** اقصُر النسبة (مثلاً ≤100) مع toast عربي.
- **معيار قبول Kimi:** قيمة >100 تُرفض أو تُقصّ مع تنبيه.

### 9. [P2] UX-FAB-MISLABEL — الزر العائم يوحي بـ AI لكنه يفتح الاستيكرات

- **الشاشة:** عائم
- **الوصف:** نص: ✦ AI الاستيكرات; labelsOpen=True aiOpen=True
- **خطوات إعادة الإنتاج:** اضغط الزر العائم.
- **لقطة:** [`shots/40-ai-interaction.png`](shots/40-ai-interaction.png)
- **أثر UX:** تسمية مضللة.
- **إصلاح محدد:** سمِّ الزر وفق الفعل الفعلي (استيكرات أو AI مشتريات).
- **معيار قبول Kimi:** النص يطابق الفعل.

### 10. [P2] UX-NO-RETURNS-NAV — لا يوجد مسار مرتجعات في التنقل

- **الشاشة:** التنقل
- **الوصف:** لا تبويب/زر مرتجعات ظاهر.
- **خطوات إعادة الإنتاج:** تصفح شريط التنقل.
- **لقطة:** [`shots/30-nav-invoices.png`](shots/30-nav-invoices.png)
- **أثر UX:** عملية يومية غير مكتشفة في الواجهة.
- **إصلاح محدد:** أضف تبويب مرتجعات أو إجراء من الفاتورة.
- **معيار قبول Kimi:** يوجد مسار واجهة لبدء مرتجع.

### 11. [P2] UX-SEARCH-EMPTY — حالة عدم وجود نتائج بحث غير واضحة

- **الشاشة:** البيع / البحث
- **الوصف:** hint='Enter: Add Item'
- **خطوات إعادة الإنتاج:** اكتب ZZZZNOMATCH999 في البحث.
- **لقطة:** [`shots/07-search-no-results.png`](shots/07-search-no-results.png)
- **أثر UX:** الصيدلي لا يميّز بين التحميل وغياب النتيجة.
- **إصلاح محدد:** أظهر empty state عربيًا واضحًا تحت الحقل.
- **معيار قبول Kimi:** رسالة «لا نتائج» تظهر خلال 300ms.

### 12. [P3] UX-NEW-SALE-MODE — بعد New Sale يبدأ وضع المنتج لا وضع العميل

- **الشاشة:** البيع
- **الوصف:** الوضع: Product / Barcode Scan Mode
- **خطوات إعادة الإنتاج:** اضغط New Sale/F2.
- **لقطة:** [`shots/43-new-sale-mode.png`](shots/43-new-sale-mode.png)
- **أثر UX:** انحراف عن بعض التوثيق؛ أثر تدريبي خفيف.
- **إصلاح محدد:** وحّد السلوك مع التوثيق أو حدّث التوثيق.
- **معيار قبول Kimi:** السلوك موثّق ومتّسق.

## مقارنة مع تقرير QA السابق (Commit Comment 208251505)

| معرّف سابق | الحالة الآن | ملاحظة |
|---|---|---|
| `P0-CALC-PERSIST` — ضياع خصم الفاتورة بعد reload | **ما زالت موجودة** | `still_present` |
| `P1-UI-SEARCH-OVERLAP` — searchModeTag مغطى | **ما زالت موجودة** | `still_present` |
| `P1-UX-MIXED-LANG` — خلط عربي/إنجليزي | **ما زالت موجودة** | `still_present` |
| `P1-FUNC-NO-RETURNS` — لا مرتجعات | **ما زالت موجودة** | `still_present` |
| `P1-FUNC-NO-STOCK-LEDGER` — لا خصم مخزون | **تعذّر الاختبار الكامل (يتطلب خادم/مخزون حي)** | `not_retestable_full` |
| `P1-ENG-NO-RBAC` — لا صلاحيات | **ما زالت موجودة** | `still_present` |
| `P1-UI-MOBILE-FAB` — تداخل FAB جوال | **ما زالت موجودة** | `still_present` |
| `P1-FUNC-CUSTOMER-DRAFT` — عميل المسودة يضيع | **ما زالت موجودة** | `still_present` |
| `P1-ENG-I18N-DATASET` — pageerror dataset aria-label | **ما زالت موجودة** | `still_present` |
| `P2-UX-NEW-SALE-MODE` — New Sale يبدأ Product | **ما زالت موجودة** | `still_present` |
| `P2-UX-AI-RETRY` — لا زر Retry بعد فشل AI | **تعذّر إعادة الاختبار بالكامل** | `not_retestable` |
| `P2-UX-FAB-MISLABEL` — FAB يوحي بـ AI | **ما زالت موجودة** | `still_present` |

**لم تُرصد أي مشكلة سابقة كـ «أُصلحت» بالكامل في هذا المسح.** المشاكل الجديدة المثبتة مقارنة بالتقرير السابق: `UX-RECEIPT-CLOSE-BLOCKED`، `UX-SEARCH-EMPTY`، `UX-DISCOUNT-NO-FEEDBACK`.

## ما تم اختباره فعليًا (من المتصفح فقط)

- Loaded 1920x1080 in 1079ms
- Arabic search: {'val': 'بنادول', 'hint': 'Enter: Add Item', 'bodyHas': True}
- No-results search tested
- 3-item cart: {'grand': '115.00 SAR', 'discount': '-0.00 SAR', 'pct': '', 'fixed': '', 'lines': 3, 'cust': None, 'emptyHidden': False}
- No number qty input; row controls={'inputs': [{'type': 'text', 'value': '1', 'cls': 'qty-input'}], 'btns': [{'text': '−', 'cls': 'qty-btn', 'title': None}, {'text': '+', 'cls': 'qty-btn', 'title': None}, {'text': '', 'cls': 'btn-icon-del', 'title': 'Remove item'}], 'rowText': '1\t\nأوجمنتين 1 جم (Augmentin 1g)\nAmoxicillin / Clavulanic Acid • 14 Tabs\n\t6281001234569\t64.50\t\n−\n+\n\t0.00\t64.50\t'}
- Removed item, lines now=2
- Customer attach → 'د. طارق المنصور' mode وضع البحث عن منتج أو باركود->Customer Search Mode
- Register customer affordance present=True
- Discount 10%: {'grand': '141.00 SAR', 'discount': '-0.00 SAR', 'pct': '', 'fixed': '', 'lines': 2, 'cust': 'د. طارق المنصور', 'emptyHidden': False} → {'grand': '126.90 SAR', 'discount': '-14.10 SAR', 'pct': '10', 'fixed': '', 'lines': 2, 'cust': 'د. طارق المنصور', 'emptyHidden': False}
- No item-level discount field observed in row
- Reload: before={'pct': '10', 'fixed': '', 'grand': '126.90 SAR', 'cust': 'د. طارق المنصور', 'lines': 2} after={'pct': '', 'fixed': '', 'grand': '141.00 SAR', 'cust': '', 'lines': 2}
- Cart lines persist across reload
- Checkout gate: {'hidden': False, 'display': 'flex', 'text': 'رقم العميل قبل الدفع\n\nسجّل رقم العميل أو اضغط تخطي للمتابعة بدون تسجيل.\n\nمتابعة بالرقم\nتخطي · عميل نقدي رجوع للفاتورة'}
- Skipped via #gateSkipCustomer
- Reload mid-payment → {'grand': '141.00 SAR', 'discount': '-0.00 SAR', 'pct': '', 'fixed': '', 'lines': 2, 'cust': None, 'emptyHidden': False, 'payOpen': True}
- Receipt: {'hidden': False, 'text': 'Transaction Receipt / إيصال الدفع\n✕\n======================================== NOVA Rx PHARMACY POS Branch #01 - Sulaimaniyah ======================================== Invoice: S-000003 Date: 05/11/2026 ١٢:٠٨ م Cashier: Station 01 (Gemini Flash) Customer: Walk-in Customer Phone: N/A ---------------------------------------- ITEM QTY PRICE TOTAL ---------------------------------------- أوجمنتين 1 جم (A', 'print': True}
- Nav sale + reload
- Nav invoices + reload
- Nav products + reload
- Nav customers + reload
- Nav reports + reload
- Nav settings + reload
- Back/forward → {'active': 'invoices', 'hash': '#invoices'}
- FAB/AI: {'before': {'text': '✦ AI الاستيكرات'}, 'after': {'text': '✦ AI الاستيكرات', 'labelsOpen': True, 'aiOpen': True, 'aiStatus': None}}
- Offline reload: {'hasInput': True, 'visible': False, 'title': 'NOVA Rx | صيدلية السوسي', 'bodyLen': 2070}
- Typical sale: {'steps': ['type:Augmentin', 'Enter', 'type:Panadol', 'Enter', 'type:Concor', 'Enter', 'click:checkout', 'click:skip', 'click:confirm'], 'total_actions': 9, 'keystrokes_approx': 25, 'mouse_clicks': 3, 'enters': 3, 'note': 'مسار تخطي العميل بدون خصم/ولاء؛ عدّ من سلة فارغة'}
- Design desktop 1920x1080: [] overlap=False clipped=0
- Design laptop 1366x768: [] overlap=False clipped=0
- Design tablet-land 1194x834: [] overlap=False clipped=0
- Mobile FAB: {'overlap': True, 'a': {'l': 18, 't': 780, 'w': 124, 'h': 46}, 'b': {'l': 6, 't': 770, 'w': 377, 'h': 67}}
- Invalid discount: {'grand': '0.00 SAR', 'discount': '-322.50 SAR', 'pct': '999', 'fixed': '-50', 'lines': 1, 'cust': None, 'emptyHidden': False, 'bodyHasError': False}
- Empty/content invoices: {'has': False}
- Empty/content customers: {'has': False}
- Empty/content reports: {'has': False}
- Hold OK count=1

- زمن التحميل الأولي 1920×1080: **1079 ms**
- html lang/dir: `{'lang': 'ar', 'dir': 'rtl'}`
- تسميات إنجليزية ظاهرة: ['CHECKOUT', 'NET TOTAL', 'Walk-in', 'Exact', 'Cancel (Esc)', 'F9 / Pay']

## ما لم يمكن اختباره

- خصم على مستوى الصنف — لا يوجد حقل ظاهر في صف السلة
- حالات التحميل الحقيقية لـ API/AI (لا خادم خلفي مع السيرفر الثابت)
- طباعة حرارية ESC/POS / درج نقدي / ميزان
- نجاح مسار AI الحقيقي
- مصادقة متعددة المستخدمين
- خصم المخزون الفعلي بعد البيع على خادم حي
- طباعة الإيصال الفعلية على طابعة (زر الطباعة موجود؛ لم تُرسل مهمة طباعة جهاز)
- فرعا `feature/black-edition-existing-app` و `fix/i18n-exact-ui-translation` (خارج نطاق main الحالي)

## ملاحظات تصميم مرصودة (ليست بالضرورة عيوبًا)

- الهوية البصرية داكنة متماسكة مع خط **Cairo** وأزرار دفع عالية التباين (`#btnCheckout` خلفية rgb(53,93,130)).
- RTL صحيح في الهيكل العام؛ شريط العميل على يمين التدفق العربي.
- أزرار كمية −/+ موجودة وواضحة في صف السلة (تحسّن عن الاعتماد على الإدخال فقط).
- لا قصّ نص ولا overflow أفقي على 1920 / 1366 / 1194.
- بعد الدفع تُفتح لوحة **استيكرات الأدوية** تلقائيًا — مفيد تشغيليًا لكنه يسرق التركيز عن الإيصال.

## توصيات أولوية لـ Kimi (بدون لمس ملفات خارج الإصلاح)

1. **P0:** مزامنة خصم الفاتورة مع state + localStorage وملء الحقول عند الاستعادة.
2. **P1:** حفظ/استعادة العميل في المسودة النشطة.
3. **P1:** إصلاح قابلية نقر `#searchModeTag` (`pointer-events` + z-index RTL).
4. **P1:** جعل مودال الإيصال فوق `#emptyInvoiceState` مع pointer-events صحيحة.
5. **P1:** إصلاح pageerror لـ `novaOriginalaria-label` في متحكّم اللغة.

---
*أُنشئ آليًا عبر تدقيق UX/UI بصري (Playwright headless). لا تعديل على ملفات المنتج. بيانات DEMO فقط.*
