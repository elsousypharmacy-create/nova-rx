# NOVA Rx — QA Report — `85b8209` (Kimi fix for issue #2)

| الحقل | القيمة |
|---|---|
| **Commit** | `85b8209d16254ab7ec6fdf3a72e2718c8762393a` (`85b8209`) — fix: address NOVA Rx issue #2 via Kimi |
| **الفرع** | `kimi/issue-2-42022855182` (الأب: main `05e83c2`) — لا يوجد PR مفتوح لهذا الفرع وقت المراجعة |
| **التاريخ** | 2026-11-05 (Asia/Riyadh) |
| **نوع المراجعة** | مراجعة تزايدية (Incremental): إعادة اختبار كل P0/P1 المفتوحة + اختبارات قبول issue #2 من جهة المستخدم + التدفقات المتصلة |
| **البيئة** | نسخة ملفات التشغيل لنفس الـ commit مخدومة محليًا (`python3 -m http.server`)؛ Chromium headless (Playwright)؛ ar-SA / RTL؛ بيانات DEMO فقط؛ **بدون قراءة كود** — `BUILD_REPORT.md` قُرئ فقط كادعاءات وتم التحقق منها من المتصفح |
| **Viewports** | 1920×1080، 1366×768، 1194×834، 390×844 |
| **الدرجة** | **64/100** (السابق 55/100 على `9410b64`) |
| **الحكم** | **إصلاح issue #2 مقبول (البنود الخمسة FIXED)** — لكن النظام **غير جاهز للتشغيل اليومي** بعد: P1 جديدة (لوحة الاستيكرات تحجب البيع التالي) + P1 مستمرة (لغة/موبايل) |

## تفصيل الدرجة

| المحور | الدرجة | السابق | ملاحظات |
|---|---:|---:|---|
| Usability | 22/35 | 16 | الخصم والعميل يبقيان بعد reload، الشارة قابلة للنقر، × يغلق الإيصال؛ لكن لوحة الاستيكرات تبقى فوق شاشة البيع بعد كل دفع |
| Design | 21/30 | 20 | هوية Black Edition محفوظة دون تغيير بصري؛ الإيصال فوق اللوحات الآن؛ التوستات تغطي جزءًا من CHECKOUT على 1194/1366 |
| Clarity | 8/15 | 7 | لا أخطاء صفحة؛ لكن قيم خصم سالبة/مفرطة مقبولة بلا رسالة، خلط لغوي مستمر |
| Responsiveness | 7/10 | 7 | لا overflow أفقي على الأحجام الأربعة؛ تداخل FAB مع CHECKOUT على 390×844 مستمر |
| Consistency | 6/10 | 5 | جلسة بلا pageerror؛ الإيصال وToast وأزرار البيع ما زالت إنجليزية |
| **المجموع** | **64/100** | 55 | |

## ملخص تنفيذي

- **P0 `UX-DISCOUNT-LOST-RELOAD` / `P0-CALC-PERSIST`: FIXED** — Augmentin + Panadol + د. طارق المنصور + 10% + 5 SAR → قبل: 76.50 / −12.65 / **63.85 SAR** → بعد reload (مرتين) نفس الحقول ونفس البنود ونفس الإجمالي **63.85 SAR** على 1920 و1366.
- بنود issue #2 الخمسة: **5/5 FIXED** (خصم، عميل، شارة البحث، إغلاق الإيصال ×، pageerror الترجمة).
- **NEW P1 `UX-LABELS-PANEL-BLOCKS-NEXT-SALE`**: بعد كل دفع وإغلاق الإيصال (× أو «فاتورة جديدة») تبقى لوحة «استيكرات الأدوية» مفتوحة فوق شاشة البيع؛ المؤشر في حقل البحث المخفي، والكتابة + Enter تضيف صنفًا لسلة لا يراها الصيدلي.
- لا P0 جديدة، لا Regression خطير، لا فشل بيع أساسي، لا فقد بيانات، النسخة صالحة للتشغيل.
- Pageerrors: **0** في 4 جلسات متصفح منفصلة (القبول + الشامل + الإضافيان).

## اختبارات قبول issue #2 (من جهة المستخدم)

| # | الاختبار | 1920×1080 | 1366×768 | 1194×834 | 390×844 | الدليل |
|---|---|---|---|---|---|---|
| 1 | Augmentin + Panadol + عميل تجريبي + 10% + 5 SAR → reload → نفس العميل/الحقول/البنود/الإجمالي | ✅ 63.85=63.85 | ✅ 63.85=63.85 | — | — | `A1-before-reload-*`, `A2-after-reload-*` |
| 1b | reload ثانٍ متتالٍ | ✅ ثابت | ✅ ثابت | — | — | — |
| 2a | خصم صفر → reload | ✅ الإجمالي 76.50 ثابت (الحقل "0" يظهر فارغًا بعد reload — P3) | ✅ | — | — | `B1-zero-after-reload-*` |
| 2b | خصم ثابت مفرط 99999 → reload | ✅ 0.00 SAR، لا سالب، يُستعاد 99999 | ✅ | — | — | `B2-excess-fixed-after-reload-*` |
| 2c | خصم نسبة مفرط 150% → reload | ✅ 0.00 SAR، لا سالب | ✅ | — | — | `B3-excess-pct-after-reload-*` |
| 2d | قيم سالبة (−20%، −10) | ⚠️ الإجمالي لا يتغير (76.50) لكن القيم السالبة مقبولة بلا رسالة | ⚠️ | — | — | `B4-negative-input-*` |
| 2e | عميل فقط بلا أصناف → reload | ✅ العميل باقٍ | ✅ | — | — | — |
| 3 | نقر حقيقي بالماوس في مركز شارة وضع البحث | ✅ منتج→عميل→منتج؛ العنصر الأعلى = الشارة | ✅ | ✅ | ✅ | `C1-badge-after-click-*` |
| 4 | دفع تجريبي ثم نقر × حقيقي (بدون force) | ✅ × في الأعلى ويُغلق الإيصال | ✅ | ✅ | ✅ | `D2-receipt-*`, `D3-after-close-*` |
| 5 | التدفق كاملًا بلا pageerror | ✅ 0 | ✅ 0 | ✅ 0 | ✅ 0 | — |
| 6 | تداخلات جديدة على 1366 و1194 | ✅ لا overflow أفقي؛ ⚠️ التوستات تغطي جزءًا من CHECKOUT (P3) | ✅ | ⚠️ | — | `C1-badge-after-click-1194` |
| 7 | الحفاظ على Black Edition والعربية | ✅ لا تغيير بصري ملحوظ مقابل `9410b64` | ✅ | ✅ | ✅ | `00-home-1920`, `R-VP-*` |
| 8 | بعد البيع: reload لا يعيد الفاتورة المكتملة | ✅ السلة الجديدة فقط، العميل يعود «عميل عابر» | ✅ | ✅ | ✅ | `D4-next-sale-*` |

## المشاكل الجديدة (NEW)

### N1. [P1] `UX-LABELS-PANEL-BLOCKS-NEXT-SALE` — لوحة الاستيكرات تبقى فوق شاشة البيع بعد إغلاق الإيصال

- **الحالة:** **NEW** (كانت مخفية سابقًا لأن × نفسه كان محجوبًا بنفس اللوحة)
- **الشاشة:** البيع / الإيصال / استيكرات الأدوية
- **ماذا فعلت:** أضفت أصنافًا → CHECKOUT → تخطّي العميل → تأكيد الدفع → نقرت × في الإيصال (وكررت بزر «Start فاتورة جديدة (F2)»).
- **ماذا حدث:** الإيصال أُغلق، لكن لوحة «✦ استيكرات الأدوية» تغطي شاشة البيع بالكامل. المؤشر داخل حقل البحث المخفي؛ كتبت Panadol + Enter فأُضيف الصنف لسلة غير مرئية (عدد البنود = 1 واللوحة ما زالت مفتوحة). Esc أو «إغلاق ✕» يغلقها.
- **المتوقع:** بعد إغلاق الإيصال يعود الصيدلي مباشرة لشاشة بيع جاهزة ومرئية؛ الاستيكرات تُفتح فقط عند الطلب أو كخطوة اختيارية واضحة لا تحجب البيع.
- **التأثير:** خطوة إضافية بعد **كل** بيع، وإضافة أصناف «عمياء» تحت لوحة أخرى أثناء الزحام.
- **إعادة الإنتاج:** أي بيع كامل على 1920 أو 1366 أو 1194.
- **الدليل:** [`D3-after-close-1920.png`](shots/85b8209/D3-after-close-1920.png)، [`D5-after-newsale-button-1920.png`](shots/85b8209/D5-after-newsale-button-1920.png)، [`D6-blind-typing-under-labels-1366.png`](shots/85b8209/D6-blind-typing-under-labels-1366.png)
- **معيار القبول:** بعد × أو «فاتورة جديدة» يكون حقل البحث مرئيًا وفي الأعلى (لا لوحة فوقه)، وأي صنف يُضاف يظهر فورًا في السلة.

### N2. [P3] `UX-TOAST-COVERS-CHECKOUT` — التوستات تغطي جزءًا من زر CHECKOUT على 1194×834 و1366×768

- **الحالة:** **NEW** (لوحظ في هذه المراجعة)
- **الشاشة:** البيع
- **ماذا فعلت/ماذا حدث:** بعد إضافة صنفين وربط عميل تتكدس 3 توستات أسفل اليسار وتمتد فوق الحافة اليسرى لزر CHECKOUT لعدة ثوانٍ.
- **المتوقع:** التوستات لا تغطي أزرار الدفع.
- **التأثير:** محدود (مؤقت)، لكنه يربك على التابلت.
- **الدليل:** [`C1-badge-after-click-1194.png`](shots/85b8209/C1-badge-after-click-1194.png)
- **معيار القبول:** لا تقاطع بين منطقة التوست وزر CHECKOUT على 1194 و1366.

### N3. [P3] `UX-DISCOUNT-ZERO-FIELD-CLEARED` — خصم "0" يظهر حقلًا فارغًا بعد reload

- **الحالة:** **NEW**
- **ماذا حدث:** أدخلت 0% و0 SAR → reload → الحقلان فارغان (الإجمالي 76.50 لم يتغير).
- **التأثير:** شكلي فقط؛ لا خطأ مالي.
- **الدليل:** [`B1-zero-after-reload-1920.png`](shots/85b8209/B1-zero-after-reload-1920.png)
- **معيار القبول:** الحقل يُستعاد كما أُدخل أو يُوحَّد السلوك (فارغ = صفر) بشكل متسق قبل وبعد reload.

## المشاكل التي تم إصلاحها والتحقق منها (FIXED)

| ID | الأولوية | الدليل من المتصفح |
|---|---|---|
| `UX-DISCOUNT-LOST-RELOAD` / `P0-CALC-PERSIST` | P0 | 10% + 5 SAR: 63.85 قبل وبعد reload (مرتين) على 1920 و1366؛ الحقول 10 و5 مستعادة. [`A2-after-reload-1366.png`](shots/85b8209/A2-after-reload-1366.png) |
| `UX-CUSTOMER-LOST-RELOAD` / `P1-FUNC-CUSTOMER-DRAFT` | P1 | د. طارق المنصور باقٍ بعد reload مع البنود، وحتى بدون بنود. [`A2-after-reload-1920.png`](shots/85b8209/A2-after-reload-1920.png) |
| `UX-SEARCH-OVERLAP` / `P1-UI-SEARCH-OVERLAP` | P1 | نقر ماوس حقيقي في مركز الشارة يبدّل منتج↔عميل على الأحجام الأربعة. [`C1-badge-after-click-1920.png`](shots/85b8209/C1-badge-after-click-1920.png) |
| `UX-RECEIPT-CLOSE-BLOCKED` | P1 | × في الأعلى عند مركزه ونقره يُغلق الإيصال على الأحجام الأربعة (انظر N1 لما يظهر بعده). [`D2-receipt-1366.png`](shots/85b8209/D2-receipt-1366.png) |
| `UX-I18N-PAGEERROR` / `P1-ENG-I18N-DATASET` | P1 | 0 pageerror في كل الجلسات، بما فيها تبديل اللغة والتنقل بين كل الصفحات. |

## المشاكل المستمرة (STILL PRESENT)

| ID | الأولوية | الملاحظة في `85b8209` | الدليل |
|---|---|---|---|
| `UX-MIXED-LANG` / `P1-UX-MIXED-LANG` | P1 | CHECKOUT، NET TOTAL، Walk-in، Exact، Cancel (Esc)، F9 / Pay، Print، Got it، «Transaction Receipt»، placeholder البحث إنجليزي | [`R-S-mixed-lang.png`](shots/85b8209/R-S-mixed-lang.png)، [`D2-receipt-1366.png`](shots/85b8209/D2-receipt-1366.png) |
| `UX-LANG-SWITCH-WEAK` | P1 | الإعدادات → English: يبقى lang=ar وdir=rtl وتبقى القوائم عربية في شاشة البيع | [`R-S15-lang-english.png`](shots/85b8209/R-S15-lang-english.png)، [`F1-english-sale-1920.png`](shots/85b8209/F1-english-sale-1920.png) |
| `UX-FAB-OVERLAP-mobile` / `P1-UI-MOBILE-FAB` | P1 | زر «AI الاستيكرات» العائم يتقاطع مع CHECKOUT على 390×844 | [`R-VP-mobile-390x844.png`](shots/85b8209/R-VP-mobile-390x844.png) |
| `UX-CHECKOUT-OVERLAY-LEAK` | P1 | نفس الحالة التقنية في صفحة العملاء (عنصر من مودال الدفع يُعدّ ظاهرًا)، **لكن** لا أثر مرئي واختبار النقر في مركزه يصيب صف الجدول نفسه (لا اعتراض). **توصية لـChatGPT: خفضها إلى P3 أو إغلاقها** بعد قرار | [`R-S-customers-overlay-leak.png`](shots/85b8209/R-S-customers-overlay-leak.png) |
| `UX-NO-RETURNS-NAV` / `P1-FUNC-NO-RETURNS` | P2/P1 | لا مسار مرتجعات (فجوة نطاق) | — |
| `UX-SEARCH-EMPTY` | P2 | ZZZZNOMATCH999 → التلميح «Enter: Add Item» بلا «لا نتائج» | [`R-S09-no-results.png`](shots/85b8209/R-S09-no-results.png) |
| `UX-DISCOUNT-NO-FEEDBACK` | P2 | 999% و99999 SAR تُقبل بصمت (الإجمالي 0.00) والقيم السالبة تُقبل بصمت | [`R-S-invalid-discount.png`](shots/85b8209/R-S-invalid-discount.png)، [`B4-negative-input-1920.png`](shots/85b8209/B4-negative-input-1920.png) |
| `UX-AI-NO-RETRY` / `P2-UX-AI-RETRY` | P2 | «تعذر التحليل: Failed to fetch» بلا زر إعادة محاولة | [`R-S12-ai-fail.png`](shots/85b8209/R-S12-ai-fail.png) |
| `UX-FAB-MISLABEL` / `P2-UX-FAB-MISLABEL` | P2 | «✦ AI الاستيكرات» يفتح الاستيكرات | [`R-S13-stickers.png`](shots/85b8209/R-S13-stickers.png) |
| `UX-PRODUCTS-FILTER-EMPTY` | P2 | ZZZZNONE في المنتجات بلا رسالة فارغة | [`R-S-products-empty-filter.png`](shots/85b8209/R-S-products-empty-filter.png) |
| `UX-NEW-SALE-MODE` / `P2-UX-NEW-SALE-MODE` | P3 | F2 يبدأ وضع المنتج | [`R-S11-f2.png`](shots/85b8209/R-S11-f2.png) |
| `UX-EMPTY-CHECKOUT-NO-HINT` | P3 | CHECKOUT معطّل بسلة فارغة بلا تلميح | [`R-S14-checkout-empty.png`](shots/85b8209/R-S14-checkout-empty.png) |
| `UX-TOAST-EN` | P3 | «Added: …»، «Customer detached…» إنجليزية | [`D4-next-sale-1920.png`](shots/85b8209/D4-next-sale-1920.png) |
| فجوات النطاق | — | GAP-ITEM-DISCOUNT، GAP-RETURNS، GAP-STOCK-LEDGER، GAP-INVOICE-LEDGER، GAP-CUSTOMER-CRUD، GAP-RBAC، GAP-PURCHASES-PAGE — بلا تغيير | — |

## اختبار التدفقات المتصلة (Regression sweep)

| التدفق | النتيجة |
|---|---|
| بيع سريع 3 أصناف → دفع → إيصال | ✅ يعمل |
| ربط عميل بالبحث (F3) وبعد إضافة الأدوية | ✅ |
| تعديل كمية + / حذف صنف | ✅ |
| تعليق فاتورة واستعادتها | ✅ (عدد المعلّقة 1، البنود تعود) |
| دفع Mada / Cash / Exact | ✅ |
| reload أثناء نافذة الدفع | ✅ البنود والخصم 5% محفوظة |
| فاتورة جديدة بعد البيع | ✅ السلة والعميل يُصفّران (مرئيًا «عميل عابر») — مع N1 |
| المنتجات / الفواتير / العملاء / التقارير / الإعدادات + reload لكل صفحة | ✅ تفتح وتبقى الصفحة النشطة |
| تبديل اللغة ذهابًا وإيابًا | ✅ بلا أخطاء — لكن English لا يغيّر الواجهة (`UX-LANG-SWITCH-WEAK`) |
| Offline + reload | ✅ شاشة البيع تظهر |
| Back/Forward | ✅ |
| زمن التحميل المحلي | ~0.33 ثانية |

## الإيصال/الاستيكرات — مقارنة ادعاءات BUILD_REPORT

- ادعاء «21/21 PASS» لاختبارات القبول: **متّسق** مع نتائج المتصفح للبنود الخمسة.
- ادعاء «لوحة الاستيكرات تبقى خلف الإيصال بعد إغلاقه — سلوك مقصود»: **مؤكَّد من المتصفح، ويُسجَّل كمشكلة UX جديدة P1 (N1)** لأنه يحجب البيع التالي.

## لم يُختبر (NOT TESTED)

- نجاح AI الحقيقي (لا خادم AI مع الخدمة المحلية الثابتة)، الطباعة الحرارية والدرج، المزامنة السحابية، المستخدمون المتعددون.

## أولويات لـChatGPT وKimi

1. `UX-LABELS-PANEL-BLOCKS-NEXT-SALE` (P1 جديدة): بعد إغلاق الإيصال يعود البيع مرئيًا ومباشرًا.
2. `UX-MIXED-LANG` + `UX-LANG-SWITCH-WEAK` (P1): تسميات البيع والإيصال والتوست عربية عند ar، وEnglish يغيّر الواجهة فعليًا.
3. `UX-FAB-OVERLAP-mobile` (P1).
4. `UX-DISCOUNT-NO-FEEDBACK` (P2): رسالة عربية عند خصم سالب أو أكبر من الإجمالي/100%.
5. قرار ChatGPT بخصوص خفض/إغلاق `UX-CHECKOUT-OVERLAY-LEAK`.

---


# السجل السابق — Baseline `9410b64`


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
