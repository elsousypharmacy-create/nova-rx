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

العمود «الحالة» يفرّق: `current` = موجود فعلًا النهارده (بوصفه في FND-01)، `proposed` = مقترح في النموذج الجديد.

| الكيان | المفتاح الأساسي | مفاتيح بديلة / قيود UNIQUE | علاقات وقيود | المالك الحالي (FND-01) | المقترح | الحالة |
|---|---|---|---|---|---|---|
| **tenant** | `id` نص ثابت | — | أب لكل حاجة | غير موجود (صيدلية واحدة ضمنية) | صف واحد حاليًا | proposed |
| **branch** | `id` | `(tenant_id, code)` | `tenant_id → tenant`؛ كل مستند يشاور عليه | غير موجود؛ سؤال للمالك (FND-01 س7/3) | فرع واحد أولًا، النموذج متعدد | proposed |
| **user** | `id` | `(tenant_id, username)` | `tenant_id`، `branch_id` (نطاق)؛ role من مصفوفة SEC-02 | رقم سري واحد مشترك (فجوة 3) | حسابات فردية (SEC-01/02) | proposed |
| **product** | `id` | `(tenant_id, sku)`؛ barcode/gtin فريد عند وجوده | أب لـ variant؛ تصنيف taxClass (يلزم قرار CAT-03) | لقطة شيت STOCK LIVE (code, gtin, namear, nameen, price, stock, units, expire, multistock, category) — لقطة مش ماستر (فجوة 4) | ماستر كتالوج في NOVA | current (لقطة) + proposed |
| **variant** | `id` | `(tenant_id, product_id, packDesc)`؛ barcode خاص بالعبوة | `product_id → product`؛ عنده `baseUnitId` | عمود `multistock` يلمّح لتعدد عبوات بلا مفاتيح | عبوة/تركيز/شكل لكل variant | proposed |
| **unit** | `id` | `(tenant_id, name)` | تربط بـ variant؛ تحويل للوحدة الأساسية | عمود `units` نصي في اللقطة؛ مفيش تحويل وحدات (فجوة 4) | جدول وحدات + معامل تحويل (قرار مفتوح §7) | proposed |
| **batch** | `id` | `(tenant_id, variant_id, batchNo, expiryDate)` | `variant_id → variant`؛ `branch_id` | **غير موجود**؛ الصلاحية عمود واحد `expire` (فجوة 2، سؤال 2) | تشغيلة بتاريخ صلاحية وتكلفة | proposed |
| **stockMovement** | `id` | `(tenant_id, idempotencyKey)` فريد | `branch_id`، `variant_id`، `batch_id` (إلزاميته قرار مفتوح §7)، `refDoc` (invoice/purchaseOrder/return/adjustment)، `userId` | **مفيش دفتر حركة**؛ الرصيد لقطة (فجوة 2) | دفتر موقّع بالكمية (±وحدة أساسية) لا يُعدّل | proposed |
| **invoice** | `id` | `(tenant_id, branch_id, invoiceNo)` تسلسلي لكل فرع | `branch_id`، `customerId` (اختياري)، `userId`؛ بنود invoice_line: `variant_id`، qty، unitPrice، discount، taxClass | ملفات تصدير `sales<تاريخ>.txt` من النظام القديم (E) — قراءة فقط | مستند مبيعات NOVA بعد G1 | current (في E) + proposed |
| **payment** | `id` | `(tenant_id, idempotencyKey)` فريد | `invoice_id → invoice`؛ method (cash/visa/wallet/debt) | جزء من ملفات الإغلاق اليومي PDF (قراءة فقط) | سطر دفع مرتبط بالفاتورة | current (في E) + proposed |
| **return** (مرتجع مبيعات) | `id` | `(tenant_id, branch_id, returnNo)` | `invoice_id → invoice` (الأصل إلزامي)؛ بنود qty ≤ المباع الصافي | ملفات `Returnsales<تاريخ>.txt` (قراءة فقط) | مستند مرتجع مرتبط بالأصل | current (في E) + proposed |
| **purchaseOrder** | `id` | `(tenant_id, branch_id, poNo)` | `supplierId`؛ بنود: `variant_id`/اسم، qty، سعر متفق | **مفيش PO منظم** (فجوة 6) — فيه مسودات شراء محلية وعقود procurement (#53) بلا كيان مالي | أمر شراء + استلام لاحق (BUY) | proposed |
| **receipt** (سند مالي) | `id` | `(tenant_id, branch_id, receiptNo)` | `journalEntryId`؛ طرف (عميل/مورد/مصروف)؛ نوع قبض/صرف | مدخلات ميزانية يدوية في إعدادات السيرفر (FND-01 §2) | سند قبض/صرف مرتبط بقيد | proposed (المعنى الدقيق مفتوح §7) |
| **journal** (قيد) | entry: `id` | `(tenant_id, branch_id, entryNo)` | entry ← refDoc؛ lines: accountId، debit، credit | **مفيش دفتر حسابات** (فجوة 1) | قيد مزدوج لكل مستند posted | proposed |

## 3. حالات المستندات

| المستند | الحالات | قواعد الانتقال |
|---|---|---|
| invoice | `draft → posted → voided` | draft قابلة للتعديل؛ posted تنشئ payment وstockMovement وقيد في معاملة واحدة (بروتوكول FND-02 §6) ولا تُعدّل بعدها؛ voided بعكس كامل مع سبب وصلاحية، ولا يمسح القيد |
| payment | `settled → refunded` | يُنشأ settled مع الفاتورة؛ الاسترداد عبر مستند return، مش تعديل الدفعة |
| return | `draft → posted` | posted يعيد الكمية بحركة مخزون موجبة وينشئ قيد عكسي/استرداد؛ المرتجع التراكمي ≤ الأصل الصافي (ثابت §4) |
| purchaseOrder | `draft → approved → sent → partiallyReceived → received` + `cancelled` | approved يحتاج اسم معتمد (موجود فعلًا في procurement drafts)؛ الاستلام مستند مستقل يولّد stockMovement وبـbatch |
| receipt | `draft → posted → voided` | مثل الفاتورة: القيد لا يُمسح، الإلغاء بعكس |
| stockMovement / journal line | `posted` فقط | **بلا حالات تعديل**: مُدرجة نهائية، التصحيح بحركة/قيد عكسي يشاور للأصل |

## 4. ثوابت التكامل (Invariants) — تُختبر في قياس FND-02 §4
1. مجموع دفعات الفاتورة `posted` = إجماليها.
2. كل قيد: مجموع المدين = مجموع الدائن.
3. مجموع حركات stockMovement لكل (branch, variant[, batch]) = الرصيد الحالي.
4. المرتجع التراكمي لكل بند ≤ الكمية المباعة الصافية للأصل.
5. نفس idempotency key + محتوى مختلف = رفض.
6. كل مستند مالك كتابته واحد (§5).

## 5. ملكية المصدر (source ownership) — قاعدة الكاتب الواحد لحد G1
من FND-01 §6: **لحد قبول الفرع الأول (G1)، النظام القديم (E) هو اللي بيكتب** المبيعات والمرتجعات والمخزون والديون، وNOVA بتقرا بس. بعد G1 والترحيل (مخطط FND-02 §8): NOVA تصبح الماستر للكيانات المقترحة فوق داخل tenant. العملاء: **مفتاح موحّد قرار مؤجل** (FND-01 فجوة 5: أكتر من مصدر لنفس العميل) — الكيان مش متوثق هنا لأن مفتاحه غير محسوم، ويُعالج في CRM/CAT. الموظفون يفضلوا خارجيين (Connecteam) وNOVA تقراهم (OPS-01)؛ user هنا هو مستخدم النظام مش سجل الموظف.

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
      { "variant_id": "var-panadol-24", "qty": 2, "unitPrice": "51.00", "discount": "0.00", "taxClass": "exempt" },
      { "variant_id": "var-vitc-20", "qty": 1, "unitPrice": "95.00", "discount": "10.00", "taxClass": "vat14" }
    ],
    "subtotal": "187.00", "discountTotal": "10.00", "taxTotal": "0.00", "total": "187.00",
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
  }
}
```

(تم التحقق من صلاحية الـJSON بـ `python3 -m json.tool` — انظر BUILD_REPORT.)

## 7. قرارات التخزين غير المحسومة (لا قرار في الوثيقة دي)
1. **تقنية التخزين نفسها**: D1/SQLite مقابل Postgres مُدار — بانتظار قياس FND-02 (حالته PROPOSED، «ما اتقاسش حاجة»). القرار بيأثر على القيود والعزل (RLS) ونوع numeric.
2. **تمثيل المال**: decimal ثابت واجب؛ في SQLite التمثيل TEXT مقابل أصغر وحدة (قروش INTEGER) — يُحسم مع اختيار التقنية.
3. **شكل المفتاح الأساسي**: نص عشوائي (ULID/UUID) مقابل رقمي؛ الرقم الظاهر للفرع (`invoiceNo`) منفصل في الحالتين.
4. **تحويل الوحدات**: جدول تحويل لكل variant مقابل معامل واحد على الـvariant — مرتبط بإغلاق فجوة الكتالوج (FND-01 فجوة 4) في CAT.
5. **إلزامية batch في حركة المخزون**: إلزامي من اليوم الأول مقابل nullable مع «رصيد غير مخصص» — متوقف على إجابة المالك عن تسجيل التشغيلات (FND-01 سؤال 2).
6. **عدد الفروع والمخازن**: النموذج متعدد الفروع من البداية بصف واحد؛ قرار التشغيل الفعلي عند المالك (FND-01 سؤال 3).
7. **معنى receipt**: سند قبض/صرف (المقترح فوق) مقابل إيصال بيع ورقي مشتق من invoice — يتأكد مع مالك الخطة.
8. **taxClass**: قواعد الضريبة حسب تصنيف الصنف (CAT-03) وسؤال إعفاء الأدوية (FND-01 سؤال 6) — enum المثال مبدئي.
9. **نقل سجل المبيعات التاريخي**: مش لازم في أول مرحلة؛ قرار مع المالك (FND-02 §8).
10. **مفتاح العميل الموحد** والكيان الكامل للعميل: مؤجل لحين توحيد المصادر (FND-01 فجوة 5).

## 8. ملاحظات المراجعة والتحقق
- الوثيقة مراجعة يدوية للاتساق فقط: المفاتيح والعلاقات والحالات متقابلة مع §2–§4 ومع نص قبول البند في الخطة و`reports/erp-roadmap.json`.
- **NOT TESTED**: لا كود ولا قاعدة بيانات ولا migration اتكتب؛ المثال JSON synthetic واتفحص صلاحيته فقط.
- ما اتقراش `DATABASE_SCHEMA.md` نفسه في الدورة دي (خارج قائمة الملفات المسموحة)؛ أسماء مجموعاته اتاخدت من ملخص FND-02 §7 (هوية، كتالوج، مخزون، مشتريات، مبيعات، مالية، سلامة وعمليات) ويتطابق تقسيم §2 معها: هوية (tenant/branch/user)، كتالوج (product/variant/unit)، مخزون (batch/stockMovement)، مبيعات (invoice/payment/return)، مشتريات (purchaseOrder)، مالية (receipt/journal).
