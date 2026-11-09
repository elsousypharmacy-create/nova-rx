# تقييم إعادة استخدام المخزون والمشتريات — FND-02 / INV / BUY
تاريخ الفحص: 2026-11-09. الحالة: مراجعة مصدر محدودة؛ لم تُنفذ تجربة تشغيل أو تثبيت أو قياس أداء. الأولوية الجديدة من أحمد: المخزون والمشتريات أولًا. هذه الأولوية لا تلغي متطلبات CAT/SEC/FND.

## النتيجة
AureusERP مرشح لإعادة استخدام وحدات فعلية للمخزون والمشتريات برخصة MIT. ليس حزمة JavaScript تدخل مباشرة في Cloudflare Worker الحالي. يحتاج تطبيق Laravel/PHP وقاعدة SQL واستضافة مستقلة، ثم بوابة NOVA تربطه بالواجهة. القرار النهائي مشروط بتجربة تدفق واحدة على بيانات اصطناعية. لا تقدير زمني أو نسبة توفير مثبتة حتى تشغيل هذه التجربة.

## الموجود في NOVA والذي يعاد استخدامه
- package.json: واجهة POS/Sticker Studio ثابتة، Node لاختبارات التطوير؛ ليس تطبيق Laravel.
- supplier-provider.js: بحث الموردين وحالتهم عبر /api/suppliers/search و/status، والمصادقة الحالية PIN.
- worker/procurement/po-draft.js: buildDrafts وapproveDraft وdraftToText؛ تجميع مسودات حسب المورد واعتماد وتصدير نص. لا يعني ذلك حفظ أمر شراء معاملاتي أو إضافته لسلة موقع المورد.
- يظل STOCK LIVE مصدر التشغيل الحالي حتى استيراد نسخة ومطابقة الأرصدة واعتماد الترحيل.

## دليل المصدر الخارجي المثبت
مرجع Aureus: c31a0db21e00fa436c4949eb4f60ceef81e116ec، من commits/master وقت الفحص.
كل الروابط التالية مثبتة على هذا المرجع:
- [LICENSE](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/LICENSE)
- [composer.json](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/composer.json)
- [plugins/webkul/inventories/src/InventoryServiceProvider.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/inventories/src/InventoryServiceProvider.php)
- [plugins/webkul/inventories/src/InventoryManager.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/inventories/src/InventoryManager.php)
- [plugins/webkul/inventories/src/Models/Lot.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/inventories/src/Models/Lot.php)
- [plugins/webkul/inventories/routes/api.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/inventories/routes/api.php)
- [plugins/webkul/purchases/src/PurchaseServiceProvider.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/purchases/src/PurchaseServiceProvider.php)
- [plugins/webkul/purchases/src/PurchaseOrder.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/purchases/src/PurchaseOrder.php)
- [plugins/webkul/purchases/routes/api.php](https://github.com/aureuserp/aureuserp/blob/c31a0db21e00fa436c4949eb4f60ceef81e116ec/plugins/webkul/purchases/routes/api.php)

## ما ثبت من قراءة الملفات
| الجزء | الكود الموجود | حدود الإثبات |
|---|---|---|
| المنتجات والمخازن | migrations للمخازن والمواقع والكميات والحركات، اعتماد Inventory على Products | لا إثبات أداء أو سلامة الرصيد تحت التزامن |
| التشغيلات | Lot به product_id وexpiration_date وlocation_id وuom_id؛ علاقات بالكميات | وجود تاريخ لا يثبت حظر المنتهي أو FEFO |
| الاستلام والتحويل والمرتجع | InventoryManager يفوض confirm/reserve/complete/cancel/createReturn/backorder لخدماته؛ routes للاستلام والتحويل والمرتجع | لم تُراجع كل الخدمات أو تُشغّل |
| المشتريات | PurchaseOrder يفوض الاعتماد والإلغاء والفاتورة وحساب حالة الاستلام والتسعير إلى خدمات | لم يثبت استلام جزئي صحيح أو قيد مالي مطابق بالتشغيل |
| API | routes فعلية للمخزون ولأوامر الشراء، middleware auth:sanctum | المصادقة لا تثبت كفاية الصلاحيات أو عزل الصيدليات |
| الاعتماديات | purchases يتطلب invoices؛ inventory يتطلب products، مع علاقات إلى accounts/security/support/plugin manager | نسخ مجلدي المخزون والمشتريات وحدهما لن يكون تطبيقًا مستقلًا |

الرخصة الأساسية MIT تسمح بالنسخ والتعديل والدمج والتوزيع وإعادة البيع مع إبقاء إشعارات الحقوق والترخيص. يجب جرد تراخيص dependencies/assets للنسخة المثبتة قبل توزيع المنتج؛ قراءة رخصة الجذر ليست جردًا مكتملًا. لا يلزم طلب إذن خاص لاستخدام الكود المغطى بهذه الرخصة وفق شروطها. العلامة والاسم لا يُفترض أنهما مشمولان بإذن إعادة التسمية أو الادعاء بالرعاية.

## تقسيم الواجهة المقترح للمراجعة
- المخزون: الأصناف / الأرصدة / التشغيلات والصلاحية / الحركات / الجرد والتسويات / التحويلات.
- المشتريات: النواقص / مقارنة الموردين / أوامر الشراء / الاستلام / مرتجعات المورد / فواتير المورد.
- واجهة Orders بالداشبورد تظل مدخلًا مستقلًا للنواقص؛ الخدمات المشتركة تتعامل بمعرفات أصناف ووحدات واضحة.

## الربط المقترح
1. Orders يرسل النواقص إلى خدمة NOVA الحالية للمقارنة والمسودات.
2. ربط externalProductId وunitConversion وsupplierId وsellerId. في Aumet يجب حفظ المخزن/البائع؛ اسم المورد وحده لا يكفي.
3. المستخدم يراجع ثم ينشأ أمر شراء داخلي في الخلفية الجديدة بمفتاح تكرار ثابت. إعادة الطلب لا تنشئ أمرًا ثانيًا.
4. الأمر الداخلي لا يساوي سلة المورد. السلة الخارجية تحتاج connector مستقلًا وقراءة تأكيد بعد الإضافة؛ إنهاء الشراء يبقى بتأكيد المستخدم.
5. عند وصول البضاعة: استلام فعلي بالكمية والوحدة والتشغيلة والصلاحية والتكلفة. عند اعتماد الاستلام فقط تنشأ حركة الرصيد؛ لا تزيده مسودة أو أمر شراء.
6. مخزن NOVA/API لا يكتب في SQL مباشرة؛ يستخدم طبقة خدمات الأعمال. المفاتيح تبقى على الخادم. حتى الترحيل يظل الاستيراد من STOCK LIVE نسخة تجريبية للقراءة.

## تجربة الحسم قبل اعتماد Aureus
بيانات اصطناعية: صنف 24 قرصًا، رصيد افتتاحي معلوم، أمر 10 علب، استلام 6 ثم 4 بتشغيلتين، مرتجع علبة، محاولة إعادة نفس الاستلام، محاولة بيع منتهي، بيع متزامن لآخر وحدة.
معايير النجاح:
- الرصيد بعد 6 ثم 4 ثم -1 = 9 علب إضافية، مع تتبع كل تشغيلة.
- منع تكرار الاستلام عند timeout/retry، وفشل العملية لا يترك حركة جزئية.
- علبة/شريط/قرص متطابقة مع ledger والتكلفة.
- صلاحيات مخزن مقابل شراء مقابل مدير، وتجربة عبور شركتين تفشل.
- لا تعديل أو حذف لحركة معتمدة؛ التصحيح بعكس مرجعي.
- شراء داخلي لا يرسل طلب شراء خارجي دون تأكيد.
- تحقق الواجهة العربية RTL و1280×800 وقياس زمن البحث والاستلام.
هذه ليست اختبارات منفذة؛ كلها بوابات معلقة.

## حجم الدمج
خمس حزم عمل مستقلة للتقدير بعد التجربة: تشغيل Laravel/SQL ونسخ الاستعادة؛ جرد التراخيص/الصلاحيات؛ مطابقة الأصناف والوحدات؛ بوابة API مع idempotency وقراءة النتيجة؛ واجهة NOVA واستيراد تجريبي ومطابقة.
لا يصح وصف الدمج بأنه زر واحد أو وعد بتشغيل المخزون والمشتريات في أسبوع بناءً على هذه القراءة وحدها.

## الخطوة التنفيذية التالية
تجربة Aureus مع Products + Inventory + Purchases واعتمادياتها في بيئة منفصلة ببيانات اصطناعية، ثم تقرير نجاح/فشل بالمعايير أعلاه. لا اختيار لقاعدة NOVA أو ترحيل بيانات حية بمجرد هذا التقرير.
المهام INV-01..05 وBUY تظل بحالات القبول الحالية؛ هذا التقرير لا يثبت أي بند verified.
