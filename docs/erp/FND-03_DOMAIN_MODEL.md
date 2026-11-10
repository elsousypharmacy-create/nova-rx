# FND-03 — نموذج المجال والكيانات (مسودة للمراجعة)

البند: FND-03 من [ERP-1.0](../ERP_MASTER_PLAN.md) · المتابعة [#87](https://github.com/elsousypharmacy-create/nova-rx/issues/87).

**الحالة: DRAFT — وثيقة تصميم قابلة للمراجعة (ChatGPT)، مش قبول نهائي.** حالة البند في `reports/erp-roadmap.json` تفضل `queued` وما اتغيرتش؛ دي دفعة تصميم ضمن بند أكبر. **مفيش migrations ولا تنفيذ قاعدة بيانات**، وتقنية التخزين نفسها **لم تُحسم** (بانتظار قياس FND-02) — كل أسماء الجداول والأعمدة هنا منطقية، مش DDL.

المراجع: الواقع من [FND-01](FND-01_REALITY_MAP.md)، مبادئ التخزين وبروتوكول الكتابة من [FND-02](FND-02_STORAGE_ADR_DRAFT.md) (حالته PROPOSED). معيار قبول البند: توثيق الكيانات والمفاتيح الثابتة وقيود العلاقات وحالات المستندات.

## 1. مبادئ عامة (موروثة من الخطة وFND-02 §6)
- `tenant_id` إلزامي في كل كيان، ومعاه `branch_id` في كل مستند وحركة مخزون.
- مفاتيح مستقرة لا تعتمد الاسم؛ رقم المستند الظاهر للإنسان (رقم فاتورة) مفتاح بديل منفصل عن المفتاح الأساسي.
- كل تاريخ UTC داخليًا، والعرض حسب فرع العميل (`Africa/Cairo` حاليًا).
- المبالغ decimal ثابت (طريقة التمثيل = قرار مفتوح مع FND-02، انظر §7).
- حركة المخزون والقيد المحاسبي دفتران لا يُعدَّلان؛ التصحيح بعكس (reversal) لا حذف.
- كل كتابة مالية/مخزنية بمفتاح idempotency؛ إعادة نفس المفتاح تعيد نفس النتيجة.
- العملة الأساسية جنيه مصري (FND-01 فجوة 8: الحالي ريال/ضريبة 15% — خطأ لازم يتصحح في CAT-03).

## 2. الكيانات والمفاتيح والقيود

العمود «الحالة» يفرّق: `current` = موجود فعلًا النهارده (بوصفه في FND-01 وآخر checkpoints المدموجة)، `proposed` = مقترح في النموذج الجديد.

| الكيان | المفتاح الأساسي | مفاتيح بديلة / قيود UNIQUE | علاقات وقيود | المالك الحالي | المقترح | الحالة |
|---|---|---|---|---|---|---|
| **tenant** | `id` نص ثابت | — | أب لكل حاجة | غير موجود (صيدلية واحدة ضمنية) | صف واحد حاليًا | proposed |
| **branch** | `id` | `(tenant_id, code)` | `tenant_id → tenant`؛ كل مستند يشاور عليه | غير موجود؛ سؤال للمالك (FND-01 س7/3) | فرع واحد أولًا، النموذج متعدد | proposed |
| **user** | `id` | `(tenant_id, username)` | `tenant_id`، `branch_id` (نطاق)؛ role من مصفوفة SEC-02 | رقم سري واحد مشترك (فجوة 3) | حسابات فردية (SEC-01/02) | proposed |
| **product** | `id` | `(tenant_id, sku)`؛ barcode/gtin فريد عند وجوده | أب لـ variant؛ تصنيف taxClass (يلزم قرار CAT-03) | لقطة شيت STOCK LIVE (code, gtin, namear, nameen, price, stock, units, expire, multistock, category) — لقطة مش ماستر (فجوة 4) | ماستر كتالوج في NOVA | current (لقطة) + proposed |
| **variant** | `id` | `(tenant_id, product_id, packDesc)`؛ barcode خاص بالعبوة | `product_id → product`؛ عنده `baseUnitId` | عمود `multistock` يلمّح لتعدد عبوات بلا مفاتيح | عبوة/تركيز/شكل لكل variant | proposed |
| **unit** | `id` | `(tenant_id, name)` | تربط بـ variant؛ تحويل للوحدة الأساسية | عمود `units` نصي في اللقطة؛ مفيش تحويل وحدات (فجوة 4) | جدول وحدات + معامل تحويل (قرار مفتوح §7) | proposed |
| **batch** | `id` | `(tenant_id, variant_id, batchNo, expiryDate)` | `variant_id → variant`؛ `branch_id` | **غير موجود**؛ الصلاحية عمود واحد `expire` (فجوة 2، سؤال 2) | تشغيلة بتاريخ صلاحية وتكلفة | proposed |
| **stockMovement** | `id` | `(tenant_id, idempotencyKey)` فريد | `branch_id`، `variant_id`، `batch_id` (إلزاميته قرار مفتوح §7)، `refDoc` (invoice/goodsReceipt/return/adjustment)، `userId` | **مفيش دفتر حركة**؛ الرصيد لقطة (فجوة 2) | دفتر موقّع بالكمية (±وحدة أساسية) لا يُعدّل | proposed |
| **invoice** | `id` | `(tenant_id, branch_id, invoiceNo)` تسلسلي لكل فرع | `branch_id`، `customerId` (اختياري)، `userId`؛ بنود invoice_line: `variant_id`، qty، unitPrice، discount، taxClass | ملفات تصدير `sales<تاريخ>.txt` من النظام القديم (E) — قراءة فقط | مستند مبيعات NOVA بعد G1 | current (في E) + proposed |
| **payment** | `id` | `(tenant_id, idempotencyKey)` فريد | `invoice_id → invoice`؛ method (cash/visa/wallet/debt) | جزء من ملفات الإغلاق اليومي PDF (قراءة فقط) | سطر دفع مرتبط بالفاتورة | current (في E) + proposed |
| **return** (مرتجع مبيعات) | `id` | `(tenant_id, branch_id, returnNo)` | `invoice_id → invoice` (الأصل إلزامي)؛ بنود qty ≤ المباع الصافي | ملفات `Returnsales<تاريخ>.txt` (قراءة فقط) | مستند مرتجع مرتبط بالأصل | current (في E) + proposed |
| **purchaseOrder** | `id` | `(tenant_id, branch_id, poNo)` | `supplierId`؛ بنود: `variant_id`/اسم، qty، سعر متفق | **تشغيليًا موجود جزئيًا** (BUY-04/05، PRs ‏#98–#100): سلال موردين فعلية تُكتب بعد مراجعة مع read-back للمعرف والكمية، وتأكيد بشري منشور يرسل طلبًا للمورد بأرقام طلب مورد مقروءة، وسجل عمليات D1 ذري (`NOVA_PURCHASE_OPS`) يمنع التكرار؛ لكن **مفيش كيان PO مالي داخلي** (فجوة 6) ولا ترقيم/حالات PO موحدة | أمر شراء داخلي + استلام لاحق عبر goodsReceipt | current (سلال/طلبات موردين) + proposed (كيان مالي) |
| **goodsReceipt** (استلام بضاعة / GRN) | `id` | `(tenant_id, branch_id, grnNo)` تسلسلي لكل فرع | `purchaseOrder_id → purchaseOrder` (إلزامي)، `supplierId`، `userId`؛ بنود grn_line: `po_line`‏/`variant_id`، qty المستلمة، `batch_id` (يُنشأ أو يُطابَق عند الاستلام)، تكلفة الشراء الفعلية؛ المستلم التراكمي لكل بند ≤ المطلوب (ثابت §4)؛ عند posting يولّد stockMovement موجبة ويحدّث حالة الـPO | **غير موجود**؛ الاستلام والمطابقة PO/GRN/فاتورة بند BUY-05 لم يُقبل بعد | مستند استلام مستقل، جزئي أو كامل، يغذي المخزون والتكلفة | proposed |
| **paymentVoucher** (سند قبض/صرف) | `id` | `(tenant_id, branch_id, voucherNo)` | `journalEntryId`؛ طرف (عميل/مورد/مصروف)؛ نوع قبض/صرف | مدخلات ميزانية يدوية في إعدادات السيرفر (FND-01 §2) | سند قبض/صرف مرتبط بقيد | proposed |
| **journal** (قيد) | entry: `id` | `(tenant_id, branch_id, entryNo)` | entry ← refDoc؛ lines: accountId، debit، credit | **مفيش دفتر حسابات** (فجوة 1) | قيد مزدوج لكل مستند posted | proposed |

> **تسمية «receipt» في نص قبول FND-03:** كلمة receipt في الخطة تحمل معنيين مختلفين، واتفصلا هنا ككيانين مستقلين: **goodsReceipt** (استلام بضاعة مرتبط بأمر الشراء، صريح في قائمة كيانات الخطة الأساسية وتدفق PO→استلام جزئي→فاتورة مورد) و**paymentVoucher** (سند مالي قبض/صرف). الإيصال الورقي المطبوع للبيع مش كيان مستقل — محتواه مشتق من invoice ويُعالج في POS-05، ولو احتجنا تخزين نسخة مطبوعة يبقى artifact مرتبط بالفاتورة مش كيان مالي. فاتورة المورد (SupplierInvoice) ومطابقتها الثلاثية PO/GRN/فاتورة ضمن نطاق BUY-05/FIN-04 وتُوثق هناك.

## 3. حالات المستندات

| المستند | الحالات | قواعد الانتقال |
|---|---|---|
| invoice | `draft → posted → voided` | draft قابلة للتعديل؛ posted تنشئ payment وstockMovement وقيد في معاملة واحدة (بروتوكول FND-02 §6) ولا تُعدّل بعدها؛ voided بعكس كامل مع سبب وصلاحية، ولا يمسح القيد |
| payment | `settled → refunded` | يُنشأ settled مع الفاتورة؛ الاسترداد عبر مستند return، مش تعديل الدفعة |
| return | `draft → posted` | posted يعيد الكمية بحركة مخزون موجبة وينشئ قيد عكسي/استرداد؛ المرتجع التراكمي ≤ الأصل الصافي (ثابت §4) |
| purchaseOrder | `draft → approved → sent → partiallyReceived → received` + `cancelled` | approved يحتاج اسم معتمد (موجود فعلًا في procurement drafts)؛ الانتقال لـ partiallyReceived/received **لا يتم يدويًا** — ينتج تلقائيًا من posting مستندات goodsReceipt المرتبطة؛ cancelled بسبب وصلاحية ولا يمسح ما اتسلّم فعلًا |
| goodsReceipt | `draft → posted` (+ عكس بقيد/حركة reversal) | draft قابل للتعديل وتسجيل التشغيلات؛ posted يولّد stockMovement موجبة لكل بند (مع batch)، ويحدّث تراكم المستلم وحالة الـPO، ولا يُعدّل بعدها؛ التصحيح بمستند عكسي يشاور للأصل (موافقًا لقاعدة «الحركة النهائية تُعكس ولا تُحذف») |
| paymentVoucher | `draft → posted → voided` | مثل الفاتورة: القيد لا يُمسح، الإلغاء بعكس |
| stockMovement / journal line | `posted` فقط | **بلا حالات تعديل**: مُدرجة نهائية، التصحيح بحركة/قيد عكسي يشاور للأصل |

## 4. ثوابت التكامل (Invariants) — تُختبر في قياس FND-02 §4
1. مجموع دفعات الفاتورة `posted` = إجماليها.
2. كل قيد: مجموع المدين = مجموع الدائن.
3. مجموع حركات stockMovement لكل (branch, variant[, batch]) = الرصيد الحالي.
4. المرتجع التراكمي لكل بند ≤ الكمية المباعة الصافية للأصل.
5. المستلم التراكمي لكل بند PO (عبر goodsReceipt posted) ≤ الكمية المطلوبة في البند، وحالة الـPO مشتقة منه لا مدخلة يدويًا.
6. نفس idempotency key + محتوى مختلف = رفض.
7. كل مستند مالك كتابته واحد (§5).

## 5. ملكية المصدر (source ownership) — قاعدة الكاتب الواحد لحد G1
من FND-01 §6: **لحد قبول الفرع الأول (G1)، النظام القديم (E) هو اللي بيكتب** المبيعات والمرتجعات والمخزون والديون، وNOVA بتقرا بس. استثناء تشغيلي موثق: طبقة المشتريات (BUY-04/05) بتكتب فعلًا في **سلال الموردين الخارجية** وتنشر تأكيد طلب بعد مراجعة بشرية، مع سجل عمليات D1 ذري — ده تكامل خارجي مُقيد، مش كتابة في الدفاتر المالية/المخزنية الداخلية اللي لسه ملكية E. بعد G1 والترحيل (مخطط FND-02 §8): NOVA تصبح الماستر للكيانات المقترحة فوق داخل tenant. العملاء: **مفتاح موحّد قرار مؤجل** (FND-01 فجوة 5: أكتر من مصدر لنفس العميل) — الكيان مش متوثق هنا لأن مفتاحه غير محسوم، ويُعالج في CRM/CAT. الموظفون يفضلوا خارجيين (Connecteam) وNOVA تقراهم (OPS-01)؛ user هنا هو مستخدم النظام مش سجل الموظف.

## 6. مثال synthetic (أرقام وأسماء مفترضة)

```json
{
  "tenant": { "id": "t1", "name": "صيدلية تجريبية", "currency": "EGP" },
  "branch": { "id": "b1", "tenant_id": "t1", "code": "MAIN", "timezone": "Africa/Cairo" },
  "invoice": {
    "id": "inv-001", "tenant_id": "t1", "branch_id": "b1", "invoiceNo": 10042,
    "status": "posted", "customerId": null, "userId": "u1",
    "occurredAt": "2026-11-10T09:30:00Z",
    "lines": [
      { "variant_id": "var-panadol-24", "qty": 2, "unitPrice": "51.00", "discount": "0.00", "taxClass": "synthetic-exempt" },
      { "variant_id": "var-vitc-20", "qty": 1, "unitPrice": "95.00", "discount": "10.00", "taxClass": "synthetic-exempt" }
    ],
    "subtotal": "197.00", "discountTotal": "10.00", "taxTotal": "0.00", "total": "187.00",
    "idempotencyKey": "b1-2026-11-10-0001"
  },
  "payment": { "id": "pay-001", "invoice_id": "inv-001", "method": "cash", "amount": "187.00", "status": "settled" },
  "stockMovements": [
    { "id": "sm-001", "refDoc": "inv-001", "variant_id": "var-panadol-24", "batch_id": "batch-p1", "qty": "-2", "unit": "pack" },
    { "id": "sm-002", "refDoc": "inv-001", "variant_id": "var-vitc-20", "batch_id": "batch-v1", "qty": "-1", "unit": "pack" }
  ],
  "journalEntry": {
    "id": "je-001", "refDoc": "inv-001", "status": "posted",
    "lines": [
      { "accountId": "cash", "debit": "187.00", "credit": "0.00" },
      { "accountId": "sales", "debit": "0.00", "credit": "187.00" }
    ]
  },
  "purchaseOrder": {
    "id": "po-001", "tenant_id": "t1", "branch_id": "b1", "poNo": 500,
    "supplierId": "sup-aumet", "status": "partiallyReceived",
    "lines": [
      { "id": "pol-1", "variant_id": "var-panadol-24", "qty": 10, "agreedPrice": "40.00" },
      { "id": "pol-2", "variant_id": "var-vitc-20", "qty": 5, "agreedPrice": "70.00" }
    ]
  },
  "goodsReceipt": {
    "id": "grn-001", "tenant_id": "t1", "branch_id": "b1", "grnNo": 9001,
    "purchaseOrder_id": "po-001", "supplierId": "sup-aumet", "userId": "u1",
    "status": "posted", "occurredAt": "2026-11-10T12:00:00Z",
    "lines": [
      { "po_line": "pol-1", "variant_id": "var-panadol-24", "qty": 4, "batch_id": "batch-p2", "unitCost": "40.00" }
    ],
    "stockMovements": [
      { "id": "sm-101", "refDoc": "grn-001", "variant_id": "var-panadol-24", "batch_id": "batch-p2", "qty": "+4", "unit": "pack" }
    ],
    "idempotencyKey": "b1-grn-2026-11-10-0001"
  }
}
```

(تم التحقق من صلاحية الـJSON بـ `python3 -m json.tool` — انظر BUILD_REPORT.)

**ملاحظات على المثال:** الحساب مضبوط: مجموع البنود قبل الخصم = 2×51.00 + 95.00 = **197.00**، ناقص خصم 10.00 = **187.00** مستحق ومدفوع، والقيد متوازن على نفس المبلغ. فئة الضريبة `synthetic-exempt` فئة افتراضية **بلا ضريبة** عمدًا — الـenum الحقيقي وقواعده غير موثقين لحد ما CAT-03 يتحسم (FND-01 سؤال 6)، فالمثال لا يفترض أي قاعدة ضريبية. مثال الاستلام جزئي عمدًا (4 من 10 في البند الأول) ليبيّن اشتقاق حالة `partiallyReceived` من تراكم المستلم.

## 7. قرارات التخزين غير المحسومة (لا قرار في الوثيقة دي)
1. **تقنية التخزين نفسها**: D1/SQLite مقابل Postgres مُدار — بانتظار قياس FND-02 (حالته PROPOSED، «ما اتقاسش حاجة»). القرار بيأثر على القيود والعزل (RLS) ونوع numeric.
2. **تمثيل المال**: decimal ثابت واجب؛ في SQLite التمثيل TEXT مقابل أصغر وحدة (قروش INTEGER) — يُحسم مع اختيار التقنية.
3. **شكل المفتاح الأساسي**: نص عشوائي (ULID/UUID) مقابل رقمي؛ الرقم الظاهر للفرع (`invoiceNo`) منفصل في الحالتين.
4. **تحويل الوحدات**: جدول تحويل لكل variant مقابل معامل واحد على الـvariant — مرتبط بإغلاق فجوة الكتالوج (FND-01 فجوة 4) في CAT.
5. **إلزامية batch في حركة المخزون**: إلزامي من اليوم الأول مقابل nullable مع «رصيد غير مخصص» — متوقف على إجابة المالك عن تسجيل التشغيلات (FND-01 سؤال 2). ملاحظة: goodsReceipt مصمم على إنشاء/مطابقة batch عند الاستلام، فلو القرار nullable هيبقى محتاج مسار استلام بلا تشغيلة.
6. **عدد الفروع والمخازن**: النموذج متعدد الفروع من البداية بصف واحد؛ قرار التشغيل الفعلي عند المالك (FND-01 سؤال 3).
7. **taxClass**: قواعد الضريبة حسب تصنيف الصنف (CAT-03) وسؤال إعفاء الأدوية (FND-01 سؤال 6) — فئة المثال synthetic مؤقتة بلا أي افتراض ضريبي.
8. **نقل سجل المبيعات التاريخي**: مش لازم في أول مرحلة؛ قرار مع المالك (FND-02 §8).
9. **مفتاح العميل الموحد** والكيان الكامل للعميل: مؤجل لحين توحيد المصادر (FND-01 فجوة 5).
10. **نطاق SupplierInvoice في FND-03**: فاتورة المورد والمطابقة الثلاثية مذكورة هنا كعلاقة فقط؛ توثيقها الكامل مع BUY-05/FIN-04 أم إضافتها ككيان هنا — يُحسم عند مراجعة المدير.

## 8. ملاحظات المراجعة والتحقق
- الوثيقة مراجعة يدوية للاتساق فقط: المفاتيح والعلاقات والحالات متقابلة مع §2–§4 ومع نص قبول البند في الخطة و`reports/erp-roadmap.json`، ومع قائمة الكيانات الأساسية في الخطة (ضمنها GoodsReceipt وSupplierInvoice).
- **NOT TESTED**: لا كود ولا قاعدة بيانات ولا migration اتكتب؛ المثال JSON synthetic واتفحص صلاحيته وحساباته يدويًا فقط (2×51+95=197، ناقص 10 = 187).
- ما اتقراش `DATABASE_SCHEMA.md` نفسه في الدورة دي (خارج قائمة الملفات المسموحة)؛ أسماء مجموعاته اتاخدت من ملخص FND-02 §7 (هوية، كتالوج، مخزون، مشتريات، مبيعات، مالية، سلامة وعمليات) ويتطابق تقسيم §2 معها: هوية (tenant/branch/user)، كتالوج (product/variant/unit)، مخزون (batch/stockMovement)، مبيعات (invoice/payment/return)، مشتريات (purchaseOrder/goodsReceipt)، مالية (paymentVoucher/journal).
- وصف المشتريات الحالي اتصحّح بناءً على PRs ‏#98–#100 المدموجة (سلال موردين فعلية، تأكيد طلب منشور بأرقام مورد، سجل D1 ذري) بدل وصف «مسودات محلية فقط» — بلا ادعاء قبول BUY-04/05 النهائي.
