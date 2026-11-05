# NOVA Rx — Full-Product UX/UI QA Report

| الحقل | القيمة |
|---|---|
| **Commit** | `9410b646ae4e1fd74de18e162cd4041929616fd3` (`9410b64`) — Persist unfinished NOVA Rx invoice across page reloads |
| **التاريخ** | 2026-11-05 (Asia/Riyadh) |
| **المراجع** | Grok — Independent UX/UI & Functional QA |
| **المالك** | Ahmed Elsousy |
| **البيئة** | استنساخ محلي لـ main + `python3 -m http.server`؛ Chromium headless (Playwright)؛ بيانات DEMO فقط؛ **بدون قراءة كود مصدري** |
| **Viewports** | 1920×1080، 1366×768، 1194×834، 390×844 |
| **الدرجة** | **55/100** |
| **الحكم** | **غير صالح للتشغيل اليومي (Blocked for daily pharmacy use)** — P0 فقد بيانات مالية + عدة P1 تعيق البيع |

## تفصيل الدرجة

| المحور | الدرجة | ملاحظات |
|---|---:|---|
| Usability | 16/35 | بيع 3 أصناف سريع؛ لكن ضياع خصم/عميل بعد reload، searchMode غير قابل للنقر، تداخل مودالات، إغلاق إيصال محجوب |
| Design | 20/30 | هوية داكنة متماسكة على Desktop/Tablet؛ تداخل FAB على الجوال؛ تسرّب مودال الدفع لصفحات أخرى |
| Clarity | 7/15 | خلط لغوي؛ لا نتائج بحث بلا رسالة؛ خصم 999 بلا تنبيه؛ تبديل لغة لا يغيّر dir/lang |
| Responsiveness | 7/10 | لا overflow على الـ4 أحجام؛ Offline يعيد الصفحة؛ تداخل على 390×844 |
| Consistency | 5/10 | إطار موحّد لكن EN/AR وToast إنجليزي وFAB مضلل |
| **المجموع** | **55/100** | |

## ملخص تنفيذي

- مشاكل مثبتة: **18** (P0=1 · P1=8 · P2=6 · P3=3)
- منها **NEW=5** و **STILL PRESENT=13** و **FIXED=0**
- فجوات نطاق المنتج (ليست أعطال واجهة موجودة): **7**
- سيناريو S6 (reload): البنود تبقى، الخصم والعميل يضيعان (مثال: 74.65 → 88.50 SAR).
- تبديل English في الإعدادات **لا يغيّر** `documentElement.lang/dir` (يبقى ar/rtl).
- Hold/Restore وF9 وبوابة العميل وتخطيها والدفع والإيصال تعمل كمسار أساسي.

## المشاكل المثبتة

### 1. [P0] `UX-DISCOUNT-LOST-RELOAD` — ضياع خصم الفاتورة/تغيّر الإجمالي بعد إعادة التحميل

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / المسودة
- **خطوات إعادة الإنتاج:** أضف أصنافًا → خصم 10% → لاحظ الإجمالي → أعد تحميل الصفحة.
- **السلوك الفعلي:** قبل pct=10 grand=74.65 SAR؛ بعد pct= grand=88.50 SAR
- **السلوك المتوقع:** نفس الإجمالي ونفس قيمة حقل الخصم بعد reload.
- **أثر على الصيدلي:** فقد بيانات مالية تحت الضغط؛ خطر تحصيل مبلغ خاطئ.
- **لقطة:** [`shots/9410b64/S06-after-reload.png`](shots/9410b64/S06-after-reload.png)
- **معيار القبول:** بعد reload يظهر نفس الإجمالي ونفس الخصم.

### 2. [P1] `UX-CHECKOUT-OVERLAY-LEAK` — عناصر مودال الدفع تتداخل مع صفحات أخرى (العملاء)

- **الحالة مقابل خط الأساس:** **NEW**
- **الشاشة:** العملاء / مودال الدفع
- **خطوات إعادة الإنتاج:** افتح صفحة العملاء بعد أي تفاعل بيع.
- **السلوك الفعلي:** زر #checkoutAddCustomer ظاهر ويتقاطع مع الجدول: {'visible': True, 'opacity': '1', 'pe': 'none', 'w': 154, 'h': 37, 'text': 'إضافة رقم العميل (اختياري)', 'checkoutHidden': False}
- **السلوك المتوقع:** عند إغلاق الدفع لا تُعترض نقرات صفحات أخرى.
- **أثر على الصيدلي:** يمنع التفاعل مع دليل العملاء ويبدو كخلل واجهة.
- **لقطة:** [`shots/9410b64/S-customers.png`](shots/9410b64/S-customers.png)
- **معيار القبول:** في صفحات غير البيع لا تُعترض النقرات بمودال دفع مغلق/عالق.

### 3. [P1] `UX-CUSTOMER-LOST-RELOAD` — العميل المرفق يُفقد بعد إعادة التحميل

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / المسودة
- **خطوات إعادة الإنتاج:** أرفق عميلاً مع أصناف ثم أعد التحميل.
- **السلوك الفعلي:** قبل 'د. طارق المنصور' → بعد ''
- **السلوك المتوقع:** نفس العميل ظاهر بعد reload.
- **أثر على الصيدلي:** فقد سياق الولاء أثناء انقطاع الصفحة.
- **لقطة:** [`shots/9410b64/S06-after-reload.png`](shots/9410b64/S06-after-reload.png)
- **معيار القبول:** بعد reload يبقى نفس العميل.

### 4. [P1] `UX-FAB-OVERLAP-mobile` — تداخل الزر العائم مع زر الدفع على 390×844

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع
- **خطوات إعادة الإنتاج:** Viewport 390x844 مع صنف.
- **السلوك الفعلي:** تقاطع هندسي بين FAB و CHECKOUT.
- **السلوك المتوقع:** لا تقاطع بين الزرين.
- **أثر على الصيدلي:** قد يمنع إتمام البيع.
- **لقطة:** [`shots/9410b64/VP-mobile-390x844.png`](shots/9410b64/VP-mobile-390x844.png)
- **معيار القبول:** لا تقاطع هندسي.

### 5. [P1] `UX-I18N-PAGEERROR` — أخطاء صفحة متكررة من متحكّم اللغة

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** عام
- **خطوات إعادة الإنتاج:** جلسة تنقل عادية بين الشاشات.
- **السلوك الفعلي:** pageerror متكرر: Failed to set a named property 'novaOriginalaria-label' on 'DOMStringMap': 'novaOriginalaria-label' is not a valid prope (×14)
- **السلوك المتوقع:** جلسة بلا هذا الـ pageerror.
- **أثر على الصيدلي:** قد يكسر الترجمة أو يلوّث الاستقرار.
- **لقطة:** —
- **معيار القبول:** جلسة بلا pageerror من هذا المصدر.

### 6. [P1] `UX-LANG-SWITCH-WEAK` — تبديل اللغة لا يغيّر اتجاه/لغة المستند بوضوح

- **الحالة مقابل خط الأساس:** **NEW**
- **الشاشة:** الإعدادات
- **خطوات إعادة الإنتاج:** الإعدادات → English.
- **السلوك الفعلي:** بعد English: {'lang': 'ar', 'dir': 'rtl', 'checkout': '\n            CHECKOUT\n            F9 / P'}
- **السلوك المتوقع:** lang=en و dir=ltr (أو تجربة إنجليزية متسقة).
- **أثر على الصيدلي:** تبديل اللغة شكلي إن لم تتغير الواجهة.
- **لقطة:** [`shots/9410b64/S15-lang-english.png`](shots/9410b64/S15-lang-english.png)
- **معيار القبول:** بعد English تصبح الواجهة إنجليزية وLTR.

### 7. [P1] `UX-MIXED-LANG` — واجهة عربية مختلطة بنصوص إنجليزية كثيرة

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / عام
- **خطوات إعادة الإنتاج:** افتح شاشة البيع باللغة الافتراضية ar.
- **السلوك الفعلي:** تظهر تسميات إنجليزية: ['CHECKOUT', 'NET TOTAL', 'Walk-in', 'Exact', 'Cancel (Esc)', 'F9 / Pay', 'Print', 'Got it']
- **السلوك المتوقع:** في lang=ar تكون تسميات الأزرار والفوتر عربية (مع الإبقاء على F-keys).
- **أثر على الصيدلي:** حمل معرفي ويضعف هوية المنتج المحلي تحت ضغط الوردية.
- **لقطة:** [`shots/9410b64/S-mixed-lang.png`](shots/9410b64/S-mixed-lang.png)
- **معيار القبول:** لا تسميات أزرار إنجليزية في شريط البيع عند ar (باستثناء العلامة).

### 8. [P1] `UX-SEARCH-OVERLAP` — زر وضع البحث مغطى/غير قابل للنقر

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / البحث
- **خطوات إعادة الإنتاج:** حاول النقر على شارة منتج/عميل داخل شريط البحث.
- **السلوك الفعلي:** pe=none top=mainSearchInput
- **السلوك المتوقع:** النقر يبدّل الوضع دون تركيز الحقل.
- **أثر على الصيدلي:** لا يمكن تبديل وضع البحث بالماوس؛ الاعتماد على F3 فقط.
- **لقطة:** [`shots/9410b64/S-search-mode-tag.png`](shots/9410b64/S-search-mode-tag.png)
- **معيار القبول:** النقر على مركز الشارة يبدّل الوضع.

### 9. [P2] `UX-AI-NO-RETRY` — فشل AI بلا زر إعادة محاولة واضح

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** المنتجات / AI مشتريات
- **خطوات إعادة الإنتاج:** احظر /api/ai/* ثم شغّل تحليل فاتورة مشتريات.
- **السلوك الفعلي:** رسالة فشل دون Retry؛ status=تعذر التحليل: Failed to fetch
- **السلوك المتوقع:** زر «إعادة المحاولة» ظاهر ويعيد الطلب.
- **أثر على الصيدلي:** احتكاك تحت الضغط.
- **لقطة:** [`shots/9410b64/S12-ai-fail.png`](shots/9410b64/S12-ai-fail.png)
- **معيار القبول:** الزر يعيد الطلب.

### 10. [P2] `UX-DISCOUNT-NO-FEEDBACK` — قبول خصم مبالغ فيه بلا رسالة توجيهية

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / الخصم
- **خطوات إعادة الإنتاج:** أدخل 999 في خصم %.
- **السلوك الفعلي:** القيمة مقبولة والناتج=0.00 SAR بلا تنبيه.
- **السلوك المتوقع:** تُرفض أو تُقصّ النسبة مع رسالة عربية.
- **أثر على الصيدلي:** قد يُنفَّذ بيع بخصم غير مقصود.
- **لقطة:** [`shots/9410b64/S-invalid-discount.png`](shots/9410b64/S-invalid-discount.png)
- **معيار القبول:** قيمة >100 تُرفض/تُقصّ مع تنبيه.

### 11. [P2] `UX-FAB-MISLABEL` — الزر العائم يوحي بـ AI لكنه يفتح الاستيكرات

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** عائم
- **خطوات إعادة الإنتاج:** اضغط الزر العائم ✦.
- **السلوك الفعلي:** النص=✦ AI الاستيكرات؛ labelsOpen=True
- **السلوك المتوقع:** النص يطابق الفعل.
- **أثر على الصيدلي:** تسمية مضللة.
- **لقطة:** [`shots/9410b64/S-fab.png`](shots/9410b64/S-fab.png)
- **معيار القبول:** النص يطابق الفعل.

### 12. [P2] `UX-NO-RETURNS-NAV` — لا يوجد مسار مرتجعات في التنقل

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** التنقل
- **خطوات إعادة الإنتاج:** تصفح شريط التنقل الرئيسي.
- **السلوك الفعلي:** لا تبويب/زر مرتجعات ظاهر.
- **السلوك المتوقع:** يوجد مسار واجهة لبدء مرتجع من فاتورة.
- **أثر على الصيدلي:** عملية يومية غير مكتشفة في الواجهة.
- **لقطة:** [`shots/9410b64/S10-nav-invoices.png`](shots/9410b64/S10-nav-invoices.png)
- **معيار القبول:** مسار مرتجع قابل للاكتشاف.

### 13. [P2] `UX-PRODUCTS-FILTER-EMPTY` — تصفية المنتجات بلا نتائج دون رسالة فارغة واضحة

- **الحالة مقابل خط الأساس:** **NEW**
- **الشاشة:** المنتجات
- **خطوات إعادة الإنتاج:** اكتب ZZZZNONE في بحث المنتجات.
- **السلوك الفعلي:** لا رسالة empty واضحة.
- **السلوك المتوقع:** رسالة «لا نتائج» ظاهرة.
- **أثر على الصيدلي:** غموض هل البحث يعمل.
- **لقطة:** [`shots/9410b64/S-products-empty-filter.png`](shots/9410b64/S-products-empty-filter.png)
- **معيار القبول:** رسالة فارغة ظاهرة.

### 14. [P2] `UX-SEARCH-EMPTY` — حالة عدم وجود نتائج بحث غير واضحة

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع / البحث
- **خطوات إعادة الإنتاج:** اكتب ZZZZNOMATCH999 في البحث.
- **السلوك الفعلي:** لا رسالة فارغة واضحة؛ hint='Enter: Add Item'
- **السلوك المتوقع:** رسالة عربية «لا نتائج» ظاهرة خلال 300ms.
- **أثر على الصيدلي:** الصيدلي لا يميّز بين التحميل وغياب النتيجة.
- **لقطة:** [`shots/9410b64/S09-no-results.png`](shots/9410b64/S09-no-results.png)
- **معيار القبول:** رسالة لا نتائج مرئية.

### 15. [P3] `UX-EMPTY-CHECKOUT-NO-HINT` — زر الدفع معطّل عند سلة فارغة بلا تلميح واضح

- **الحالة مقابل خط الأساس:** **NEW**
- **الشاشة:** البيع
- **خطوات إعادة الإنتاج:** افتح بيعًا بسلة فارغة ولاحظ CHECKOUT.
- **السلوك الفعلي:** الزر disabled دون title/toast: {'disabled': True, 'ariaDisabled': None, 'text': 'CHECKOUT\nF9 / Pay', 'title': ''}
- **السلوك المتوقع:** تلميح عربي يوضح لماذا الزر غير متاح.
- **أثر على الصيدلي:** أثر خفيف على الاكتشاف.
- **لقطة:** [`shots/9410b64/S14-checkout-empty.png`](shots/9410b64/S14-checkout-empty.png)
- **معيار القبول:** تلميح أو رسالة عند التعطيل.

### 16. [P3] `UX-NEW-SALE-MODE` — بعد New Sale/F2 يبدأ وضع المنتج لا وضع العميل

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** البيع
- **خطوات إعادة الإنتاج:** اضغط F2 أو فاتورة جديدة.
- **السلوك الفعلي:** الوضع=Product / Barcode Scan Mode
- **السلوك المتوقع:** سلوك موثّق ومتّسق مع التوثيق.
- **أثر على الصيدلي:** انحراف تدريبي خفيف.
- **لقطة:** [`shots/9410b64/S11-f2.png`](shots/9410b64/S11-f2.png)
- **معيار القبول:** السلوك موثّق.

### 17. [P3] `UX-TOAST-EN` — رسائل Toast إنجليزية داخل واجهة عربية

- **الحالة مقابل خط الأساس:** **NEW**
- **الشاشة:** عام / التنبيهات
- **خطوات إعادة الإنتاج:** أضف صنفًا وراقب التوست.
- **السلوك الفعلي:** نص التوست: ●
Added: أوجمنتين 1 جم (Augmentin 1g)
- **السلوك المتوقع:** توست عربي متّسق مع lang=ar.
- **أثر على الصيدلي:** يكسر اتساق اللغة.
- **لقطة:** [`shots/9410b64/S01-cart-3.png`](shots/9410b64/S01-cart-3.png)
- **معيار القبول:** التوست عربي عند ar.

### [P1] `UX-RECEIPT-CLOSE-BLOCKED` — زر إغلاق الإيصال محجوب بطبقة فوقه (لوحة الاستيكرات)

- **الحالة مقابل خط الأساس:** **STILL PRESENT**
- **الشاشة:** الإيصال
- **خطوات إعادة الإنتاج:** أتمم بيعًا حتى يظهر الإيصال ثم حاول إغلاقه بالزر ✕ (غالبًا تُفتح الاستيكرات فوقه).
- **السلوك الفعلي:** elementFromPoint على مركز زر الإغلاق يقع على طبقة `nova-label-editor` وليس على الزر.
- **السلوك المتوقع:** النقر على ✕ يغلق الإيصال فورًا، أو تُغلق الطبقات الحاجبة أولاً بشكل واضح.
- **أثر على الصيدلي:** بعد البيع يبدو الزر غير مستجيب؛ يبطئ إغلاق العملية.
- **لقطة:** [`shots/9410b64/S01-receipt.png`](shots/9410b64/S01-receipt.png)
- **معيار القبول:** ✕ يغلق الإيصال دون اعتراض طبقات أخرى، أو مسار إغلاق واضح بنفس النتيجة.

## فجوات نطاق المنتج (ليست Bugs)

هذه قدرات غير مبنية أو مصرَّح بأنها تجريبية. لا تُحسب أعطالًا لوظيفة موجودة تدّعي العمل.

- **`GAP-ITEM-DISCOUNT` — خصم على مستوى الصنف غير ظاهر في واجهة السلة**
  - دليل: لا حقل خصم صنف في صف #invoiceTableBody
- **`GAP-RETURNS` — لا يوجد مسار مرتجعات في التنقل أو شاشة مخصصة**
  - دليل: تصفح التبويبات الستة — لا data-page=returns
- **`GAP-STOCK-LEDGER` — البيع لا يُحدّث رصيد المخزون الظاهر (بيانات تجريبية ثابتة كما تصرّح الشاشة)**
  - دليل: صفحة المنتجات: «بدون تعديل المخزون الحقيقي»
- **`GAP-INVOICE-LEDGER` — سجل الفواتير المعروض بيانات تجريبية وليس سجل مبيعات محفوظًا**
  - دليل: صفحة الفواتير تصرّح بذلك
- **`GAP-CUSTOMER-CRUD` — إدارة عملاء كاملة (إضافة/تعديل مستمرة) غير متاحة — دليل تجريبي**
  - دليل: شاشة العملاء تصرّح بالحاجة لقاعدة بيانات
- **`GAP-RBAC` — لا نظام مستخدمين/صلاحيات بعد — مصرّح في الإعدادات**
  - دليل: نص الإعدادات: لم يتم ربط قاعدة بيانات أو نظام مستخدمين أو صلاحيات
- **`GAP-PURCHASES-PAGE` — لا تبويب مشتريات مستقل — الدخول عبر زر AI في المنتجات**
  - دليل: لا data-page=purchases

## نتائج السيناريوهات (القسم 7)

| # | السيناريو | النتيجة |
|---|---|---|
| 1 | بيع سريع 3 أصناف | `"PASS"` |
| 2 | بحث عميل وربطه | `"د. طارق المنصور"` |
| 3 | إضافة/بوابة عميل بعد الأدوية | `"تم اختبار بوابة الهاتف/التخطي"` |
| 4 | تعديل كمية وحذف | `"PASS/PASS"` |
| 5 | خصم % وثابت | `"PASS"` |
| 6 | تحديث الصفحة وبقاء البيانات | `{"lines_ok": true, "discount_ok": false, "cust_ok": false}` |
| 7 | تعليق واستعادة | `{"count": "1", "lines_after": 3, "restored_attempt": true}` |
| 8 | دفع وإيصال | `{"print_visible": true}` |
| 9 | دواء غير موجود | `{"hint": "Enter: Add Item", "has": false}` |
| 10 | كل التنقل | `"PASS"` |
| 11 | اختصارات لوحة المفاتيح | `{"mode_f2": "Product / Barcode Scan Mode", "mode_f3": "Customer Search Mode", "f9": {"pay": true, "gate": false}}` |
| 12 | فشل AI وإعادة المحاولة | `{"status": "تعذر التحليل: Failed to fetch", "failed": true, "hasRetry": false}` |
| 13 | مراجعة استيكرات | `{"preview": true, "text": "✦ استيكرات الأدوية\nتصميم وطباعة داخل NOVA Rx\nإغلاق ✕\nفواتير NOVA Rx\n#S-000009 · 3 صنف\n#S-000001 · 3 صنف\nاختار فاتورة، وبعدها را` |
| 14 | رسائل الخطأ | `{"btn": {"disabled": true, "ariaDisabled": null, "text": "CHECKOUT\nF9 / Pay", "title": ""}, "toast": ""}` |
| 15 | تغيير اللغة/الاتجاه | `{"before": {"lang": "ar", "dir": "rtl"}, "en": {"lang": "ar", "dir": "rtl", "checkout": "\n            CHECKOUT\n            F9 / P"}, "ar": {"lang": "ar", "dir` |

سيناريوهات إضافية: Offline reload؛ mid-payment reload؛ viewports الأربعة؛ تصفية المنتجات/الفواتير؛ Back/Forward.

## مقارنة المراجعات السابقة

المراجع: `qa/ux-baseline-20261105` + Commit Comment 208251505 على `9410b64`.

| ID | الحالة |
|---|---|
| `UX-DISCOUNT-LOST-RELOAD` (P0) | **STILL PRESENT** — alias P0-CALC-PERSIST |
| `P0-CALC-PERSIST` (P0) | **STILL PRESENT** — alias of UX-DISCOUNT-LOST-RELOAD |
| `UX-SEARCH-OVERLAP` (P1) | **STILL PRESENT** — alias P1-UI-SEARCH-OVERLAP |
| `P1-UI-SEARCH-OVERLAP` (P1) | **STILL PRESENT** — alias of UX-SEARCH-OVERLAP |
| `UX-MIXED-LANG` (P1) | **STILL PRESENT** — alias P1-UX-MIXED-LANG |
| `P1-UX-MIXED-LANG` (P1) | **STILL PRESENT** — alias of UX-MIXED-LANG |
| `UX-CUSTOMER-LOST-RELOAD` (P1) | **STILL PRESENT** — alias P1-FUNC-CUSTOMER-DRAFT |
| `P1-FUNC-CUSTOMER-DRAFT` (P1) | **STILL PRESENT** — alias of UX-CUSTOMER-LOST-RELOAD |
| `UX-RECEIPT-CLOSE-BLOCKED` (P1) | **STILL PRESENT** |
| `UX-I18N-PAGEERROR` (P1) | **STILL PRESENT** — alias P1-ENG-I18N-DATASET |
| `P1-ENG-I18N-DATASET` (P1) | **STILL PRESENT** — alias of UX-I18N-PAGEERROR |
| `UX-FAB-OVERLAP-mobile` (P1) | **STILL PRESENT** — alias P1-UI-MOBILE-FAB |
| `P1-UI-MOBILE-FAB` (P1) | **STILL PRESENT** — alias of UX-FAB-OVERLAP-mobile |
| `UX-CHECKOUT-OVERLAY-LEAK` (P1) | **NEW** |
| `UX-LANG-SWITCH-WEAK` (P1) | **NEW** |
| `UX-NO-RETURNS-NAV` (P2) | **STILL PRESENT** — also tracked as GAP-RETURNS |
| `P1-FUNC-NO-RETURNS` (P1) | **STILL PRESENT** — product gap + nav absence; see GAP-RETURNS |
| `UX-SEARCH-EMPTY` (P2) | **STILL PRESENT** |
| `UX-DISCOUNT-NO-FEEDBACK` (P2) | **STILL PRESENT** |
| `UX-AI-NO-RETRY` (P2) | **STILL PRESENT** — alias P2-UX-AI-RETRY |
| `P2-UX-AI-RETRY` (P2) | **STILL PRESENT** — alias of UX-AI-NO-RETRY |
| `UX-FAB-MISLABEL` (P2) | **STILL PRESENT** — alias P2-UX-FAB-MISLABEL |
| `P2-UX-FAB-MISLABEL` (P2) | **STILL PRESENT** — alias of UX-FAB-MISLABEL |
| `UX-PRODUCTS-FILTER-EMPTY` (P2) | **NEW** |
| `UX-NEW-SALE-MODE` (P3) | **STILL PRESENT** — alias P2-UX-NEW-SALE-MODE |
| `P2-UX-NEW-SALE-MODE` (P2) | **STILL PRESENT** — alias of UX-NEW-SALE-MODE (priority reframed P3 in UX audit) |
| `UX-EMPTY-CHECKOUT-NO-HINT` (P3) | **NEW** |
| `UX-TOAST-EN` (P3) | **NEW** |
| `P1-FUNC-NO-STOCK-LEDGER` (P1) | **STILL PRESENT** — tracked as GAP-STOCK-LEDGER (product scope) |
| `P1-ENG-NO-RBAC` (P1) | **STILL PRESENT** — tracked as GAP-RBAC (product scope) |

**لا توجد مشاكل FIXED مؤكدة في هذا المسح.**

## ما تم اختباره

- S1 quick sale steps=['type:Augmentin', 'Enter', 'type:Panadol', 'Enter', 'type:Concor', 'Enter', 'checkout', 'skip', 'confirm']
- S9 no-results
- S4 qty/remove {'btns': ['−', '+', ''], 'inputs': [{'cls': 'qty-input', 'val': '1', 'type': 'text'}]}
- S2 customer=د. طارق المنصور
- S5 discounts {'grand': '88.50 SAR', 'discount': '-0.00 SAR', 'pct': '', 'fixed': '', 'lines': 2, 'cust': None}->{'grand': '79.65 SAR', 'discount': '-8.85 SAR', 'pct': '10', 'fixed': '', 'lines': 2, 'cust': None}->{'grand': '74.65 SAR', 'discount': '-13.85 SAR', 'pct': '10', 'fixed': '5', 'lines': 2, 'cust': None}
- S6 reload before={'pct': '10', 'fixed': '5', 'grand': '74.65 SAR', 'cust': 'د. طارق المنصور', 'lines': 2} after={'pct': '', 'fixed': '', 'grand': '88.50 SAR', 'cust': '', 'lines': 2}
- S7 hold/restore {'count': '1', 'lines_after': 3, 'restored_attempt': True}
- S8 Mada method clicked
- S8 pay/receipt print_visible=True
- S10 all tabs + reload
- Invoices filter used
- Invoices row click attempted
- Reports viewed
- S15 language switch {'before': {'lang': 'ar', 'dir': 'rtl'}, 'en': {'lang': 'ar', 'dir': 'rtl', 'checkout': '\n            CHECKOUT\n            F9 / P'}, 'ar': {'lang': 'ar', 'dir': 'rtl'}}
- S11 shortcuts {'mode_f2': 'Product / Barcode Scan Mode', 'mode_f3': 'Customer Search Mode', 'f9': {'pay': True, 'gate': False}}
- S12 AI fail {'status': 'تعذر التحليل: Failed to fetch', 'failed': True, 'hasRetry': False}
- S13 stickers {'preview': True, 'text': '✦ استيكرات الأدوية\nتصميم وطباعة داخل NOVA Rx\nإغلاق ✕\nفواتير NOVA Rx\n#S-000009 · 3 صنف\n#S-000001 · 3 صنف\nاختار فاتورة، وبعدها راجع كل دواء قبل طباعة استيكره.\nبيانات الاستيكر\nاسم المريض\nاسم الدواء\nالكمية / الجرعة الموصوفة\nالتكرار\nالمدة\nتوقيت الاستعمال\nغير محدد\nقبل الأكل\nبعد الأكل\nمع الأكل\nقبل النوم\nحسب تعليمات الطبيب\nالعمر\nالوزن (كجم)\nالحالة\nغير محدد'}
- S14 empty checkout {'disabled': True, 'ariaDisabled': None, 'text': 'CHECKOUT\nF9 / Pay', 'title': ''}
- Offline {'hasInput': True, 'visible': True, 'bodyLen': 1354}
- VP desktop {'issues': [], 'overlap': False, 'clipped': [], 'sw': 1920, 'cw': 1920}
- VP laptop {'issues': [], 'overlap': False, 'clipped': [], 'sw': 1366, 'cw': 1366}
- VP tablet {'issues': [], 'overlap': False, 'clipped': [], 'sw': 1194, 'cw': 1194}
- VP mobile {'issues': [], 'overlap': True, 'clipped': [], 'sw': 390, 'cw': 390}
- Mid-payment reload {'grand': '334.50 SAR', 'discount': '-0.00 SAR', 'pct': '', 'fixed': '', 'lines': 2, 'cust': None, 'payOpen': True}
- Back/forward {'active': 'sale', 'hash': '#sale'}
- زمن تحميل أولي ≈ **1259 ms**

## ما لم يمكن اختباره

- خصم على مستوى الصنف — لا حقل ظاهر في صف السلة
- نجاح مسار AI الحقيقي (لا خادم /api/ai مع السيرفر الثابت)
- طباعة حرارية ESC/POS / درج نقدي / ميزان
- مصادقة متعددة المستخدمين (غير مبنية)
- مرتجع كامل مرتبط بمخزون حي
- مزامنة سحابية

## أولويات لـ ChatGPT وKimi

1. إصلاح بقاء خصم الفاتورة عبر reload (P0) قبل أي تجميل.
2. بقاء العميل في المسودة + قابلية نقر searchModeTag + إغلاق الإيصال دون طبقات حاجبة.
3. إغلاق/إخفاء مودال الدفع عند مغادرة البيع (تسرّب لصفحة العملاء).
4. جعل تبديل English يغيّر اللغة والاتجاه فعليًا.
5. معالجة pageerror الخاص بمتحكّم اللغة وتعريب التسميات الظاهرة.

---
*تقرير Grok Full-Product Baseline — أدلة لقطات تحت shots/9410b64/. لا تعديل على ملفات المنتج.*
