# FND-05 — بيئات العمل والنشر والاسترجاع (مسودة تصميم للمراجعة)

البند: FND-05 من [ERP_MASTER_PLAN.md](../ERP_MASTER_PLAN.md) · المتابعة [#87](https://github.com/elsousypharmacy-create/nova-rx/issues/87) · التفويض [#105](https://github.com/elsousypharmacy-create/nova-rx/issues/105).

**الحالة: DRAFT للمراجعة — مش verified ولا استيفاء لمعيار القبول.** معيار القبول من الخطة: «development/staging/production منفصلة؛ migrations مرقمة؛ سجل نسخة ونشر واسترجاع؛ منع نشر artifact قديم فوق تحديث أحدث». الوثيقة دي جرد للموجود مقابل المطلوب واقتراحات تصميم فقط. **ما اتنفذش أي تغيير في workflow أو Cloudflare أو migrations أو deploy** في هذه الدورة. كل حكم موسوم: **[مُثبت]** (موجود في الكود المقروء) / **[مقترح]** / **[غير مختبر NOT TESTED]**.

## 1. جرد البيئات: الحالي مقابل المطلوب

| البيئة | الحالة الحالية | الدليل | الفجوة مقابل القبول |
|---|---|---|---|
| development | **غير موجودة** كبيئة منفصلة على Cloudflare | `.github/scripts/deploy_worker.sh:19` يرفض أي سكربت غير `nova-rx-preview` | مفيش Worker تطوير منفصل؛ التطوير المحلي فقط (ملفات repo) |
| staging / preview | **موجودة جزئيًا** = Worker واحد `nova-rx-preview` على `https://nova-rx-preview.elsousypharmacy.workers.dev` | `.github/workflows/deploy-worker.yml:63,70` | هي staging فعليًا لكن اسمها preview؛ لا توجد قاعدة بيانات staging مستقلة (قاعدة البيانات نفسها لسه قيد قرار FND-02) |
| production | **غير موجودة** | نفس المرجع: الحارس يقبل `nova-rx-preview` فقط، ومفيش أي تعريف لـWorker إنتاج في الملفين المقروءين | قبول FND-05 يتطلب production منفصلة بحارس أقوى — **لم يُنفذ** |

**خلاصة الجرد [مُثبت]:** البنية الحالية = بيئة واحدة فقط (preview). فصل dev/staging/production الكامل **لم يُنفذ** وهو خارج صلاحية هذه الدورة.

## 2. عزل البيانات والأسرار

### الموجود [مُثبت]
- النشر اليدوي المحروس يستخدم سرّين في GitHub Actions: `CLOUDFLARE_API_TOKEN` (إلزامي، يفشل بوضوح لو غائب) و`CLOUDFLARE_ACCOUNT_ID` (اختياري؛ لو غائب يُستنتج من حساب واحد فقط، ويرفض لو التوكن يرى أكثر من حساب) — `deploy-worker.yml:55-58,62` و`deploy_worker.sh:38-45`.
- صلاحيات الـworkflow مقيدة `contents: read` (`deploy-worker.yml:35-36`)، و`persist-credentials: false` في checkout (`deploy-worker.yml:53-54`).
- الـWorker يحتفظ بـbindings الموجودة (`keep_bindings`) ولا يضيف أو يحذف binding (`deploy_worker.sh:59,68-72`)، وأسرار التطبيق نفسها (PIN، مفاتيح التشفير) تُدار خارج هذا السكربت — سكربت النشر لا يقرأها ولا يكتبها.

### الفجوات [غير منفذ]
- لا يوجد فصل أسرار لكل بيئة (سر production مستقل بصلاحيات أضيق، ممنوع استخدام سر staging على production) — لأن production غير موجودة أصلًا.
- لا يوجد سياسة موثقة لدوران `CLOUDFLARE_API_TOKEN` أو لحد صلاحياته الدنيا.
- عزل بيانات العملاء بين البيئات غير قابل للتقييم حاليًا: لا توجد قاعدة بيانات معاملات بعد (قرار التقنية معلّق على القياس في [FND-02](FND-02_STORAGE_ADR_DRAFT.md))، والبيانات التشغيلية ما زالت في النظام القديم/الشيتات.

### [مقترح]
1. سر API token مستقل لكل بيئة بأسماء ثابتة (`CLOUDFLARE_API_TOKEN_STAGING` / `_PROD`) وصلاحية الحد الأدنى (Workers Scripts:Edit على السكربت المعني فقط).
2. منع مزج البيئات في الحارس نفسه: `SCRIPT_NAME` و`LIVE_URL` واسم السر يُشتقون من input `environment` واحد، وأي عدم تطابق يُفشل التشغيل.
3. ممنوع نسخ بيانات عملاء حقيقية إلى staging/dev؛ fixtures اصطناعية فقط (نفس قاعدة مسار procurement).

## 3. migrations مرقّمة

### الموجود [مُثبت]
- **لا يوجد أي نظام migrations حاليًا**: لا قاعدة معاملات (FND-02 لم يُحسم)، ولا جدول `schema_migrations`، ولا ملفات ترحيل في الملفات المقروءة.

### [مقترح — مواصفة للمراجعة، غير منفذة]
- ملفات باسم `NNNN_description.sql` (تسلسل أربع خانات يزيد فقط، لا يُعاد استخدام رقم أبدًا)، تُطبَّق بالترتيب، وكل ملف غير قابل للتعديل بعد دمجه.
- جدول تتبع واحد لكل بيئة، مثال اصطناعي (synthetic):
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,          -- 0001, 0002, ...
    name TEXT NOT NULL,              -- 0003_add_invoice_version.sql
    applied_at TEXT NOT NULL,        -- UTC ISO-8601
    checksum TEXT NOT NULL           -- sha256 لمحتوى الملف؛ اختلافه = تلاعب
  );
  ```
- كل migration معاملة واحدة حيث يدعمها المحرك؛ فشل أي خطوة = rollback كامل وعدم تسجيل الصف.
- الرجوع: migrations اتجاه واحد (forward-only)؛ الرجوع يكون بـmigration جديدة معكوسة `NNNN_revert_...` وليس بتعديل/حذف القديمة، مع استثناء موثق: استعادة نسخة احتياطية كاملة في الكوارث (انظر §5).
- بوابة النشر: لا deploy لكود يتطلب migration رقمها أعلى من آخر صف مطبّق في بيئة الهدف (فحص توافق نسخة الكود/المخطط قبل الرفع).
- الربط مع FND-02: اختيار الأداة النهائية (D1 batch مقابل أدوات Postgres) معلّق على قياس FND-02؛ هذه المواصفة محايدة تقنيًا.

## 4. منع نشر artifact قديم فوق تحديث أحدث

### الموجود [مُثبت — حارس النشر الحالي]
الحارس `.github/workflows/deploy-worker.yml` + `.github/scripts/deploy_worker.sh` يوفر طبقات الحماية التالية:

| الحماية | الآلية | المرجع |
|---|---|---|
| نشر يدوي فقط (لا تلقائي) | `workflow_dispatch` فقط، dry_run = `true` افتراضيًا | `deploy-worker.yml:6,25-29` |
| تأكيد لفظي للنشر الحقيقي | لازم كتابة `DEPLOY nova-rx-preview` حرفيًا عند `dry_run=false` | `deploy-worker.yml:30-33`, `deploy_worker.sh:24` |
| محاولة واحدة | `github.run_attempt` لازم = 1؛ إعادة التشغيل ممنوعة | `deploy-worker.yml:47-50` |
| منع التزامن | `concurrency: deploy-nova-worker` بدون إلغاء | `deploy-worker.yml:38-40` |
| تثبيت artifact بالمحتوى | `sha256` 64 hex إلزامي ويطابق الملف المقروء من git عند ref محدد | `deploy-worker.yml:17-20`, `deploy_worker.sh:27-31` |
| فحوص سلامة artifact | الحجم > 100KB، وجود `addEventListener(`، و`node --check` | `deploy_worker.sh:32-35` |
| **منع الكتابة فوق تعديل متزامن** | `modified_on` للـWorker الحي لازم يطابق بادئة `expected_modified_on`، وإلا يرفض | `deploy-worker.yml:21-24`, `deploy_worker.sh:47-53` |
| نطاق مسار artifact | `worker/live/*.js` فقط، واسم سكربت واحد مسموح | `deploy_worker.sh:19-22` |

### الفجوة مقابل معيار القبول [مُثبت بالقراءة]
فحص `modified_on` يمنع **الكتابة فوق تعديل حصل بعد خط الأساس** (سباق نشر متزامن)، لكنه **لا يمنع نشر artifact أقدم إصدارًا فوق أحدث** طالما الـWorker لم يتغير منذ خط الأساس: لا يوجد رقم إصدار/توقيت داخل artifact يُقارن بالمنشور حاليًا. مثال: بناء artifact قديم ونشره بعد نشر أحدث — مع مطابقة `expected_modified_on` — سيمر.
- **[مقترح 1]:** ختم `ARTIFACT_VERSION` (timestamp أو رقم تسلسلي) داخل artifact، وفحص في الحارس: `ARTIFACT_VERSION > DEPLOYED_VERSION` وإلا رفض. يتطلب تخزين آخر إصدار منشور (سجل النشر §5) — **[غير مختبر NOT TESTED]**.
- **[مقترح 2]:** اعتماد سياسة «artifact يُنشر من `main` فقط» أو من قائمة فروع مسموحة، لأن `artifact_ref` حاليًا يقبل أي branch/commit يطابق الصيغة (`deploy_worker.sh:22`).

## 5. النسخ الاحتياطي والاستعادة والرجوع (Backup / Restore / Rollback)

### أ. كود الـWorker — checklist [مُثبت، أغلبه داخل التشغيل الواحد]
1. قبل الرفع: قراءة settings وحفظ قائمة الـbindings (أسماء وأنواع فقط) — `deploy_worker.sh:56-60`; يرفض الاستمرار بلا bindings.
2. قبل الرفع: نسخة كاملة من كود الـWorker الحي + فحصها (حجم > 100KB ووجود `addEventListener(`) — `deploy_worker.sh:61-64`. هذه النسخة **هي** ما يستعيده الـrollback.
3. dry run يتوقف هنا ولا يرفع شيئًا — `deploy_worker.sh:103`.
4. بعد الرفع: تحقق آلي = تطابق bindings + `compatibility_date` + `compatibility_flags` + حجم الكود ضمن ±0.5% + تطابق sha256 للكود الحي مع الـartifact — `deploy_worker.sh:82-95`.
5. أي فشل بعد الرفع ⇒ rollback آلي بإعادة نسخة الكود المحفوظة والتحقق منها — `deploy_worker.sh:96-101`.
6. لو فشل الـrollback نفسه: رسالة توجّه للاستعادة اليدوية من Cloudflare (Deployments) مع الإشارة للنسخة `33fe0516-2931-40cb-93a4-808e3c4f7724` — `deploy_worker.sh:98`.

**[غير مختبر NOT TESTED]:** هذه الآلية موثقة من قراءة الكود فقط في هذه الدورة؛ لم يتم تشغيل dry run أو rollback فعلي هنا، وتمرين استعادة كامل لم يُوثق إجراؤه.

### ب. فجوات النسخ الاحتياطي [غير منفذ]
- نسخة الكود الاحتياطية تعيش في مجلد مؤقت على الـrunner (`mktemp`، `deploy_worker.sh:13`) وتُفقد بعد انتهاء التشغيل؛ **[مقترح]** رفعها كـartifact محتفظ به مدة محددة أو تسجيل sha256 + مرجع النسخة في سجل دائم.
- لا يوجد نسخ احتياطي لبيانات التشغيل بعد (لا قاعدة بيانات معاملات؛ انظر FND-02). عند وجودها يلزم: نسخ مجدولة + **تمرين استعادة فعلي لنقطة زمنية** مع قياس RPO/RTO (معيار مذكور أصلًا في FND-02 §3) — **[غير منفذ / غير مختبر]**.
- لا يوجد سجل نشر دائم (انظر §6).

## 6. سجل النسخة والنشر والاسترجاع (Deploy log)

### الموجود [مُثبت]
- ملخص التشغيل يُكتب في `GITHUB_STEP_SUMMARY` لكل خطوة (`deploy_worker.sh:14`) ويشمل sha256 للـartifact والنسخة الاحتياطية و`modified_on` و`etag` بعد النشر (`deploy_worker.sh:115`) — لكنه سجل عابر مرتبط بالـrun وليس سجلًا تشغيليًا دائمًا قابلاً للاستعلام.

### [مقترح — غير منفذ]
سجل واحد لكل بيئة (ملف أو جدول)، صف لكل حدث، مثال اصطناعي (synthetic):
```json
{"env":"staging","script":"nova-rx-preview","event":"deploy","artifact":"worker/live/nova-rx-preview.with-example.js","sha256":"<64-hex>","artifactVersion":"2026-11-10T00:00:00Z","deployedVersionBefore":"…","actor":"<github-actor>","runId":0,"result":"ok|rolled-back","rolledBackTo":null,"at":"2026-11-10T00:00:00Z"}
```
القبول النهائي يتطلب: إمكانية الإجابة فورًا «ماذا يعمل الآن في كل بيئة، ومن نشره، وكيف نرجع خطوة واحدة» من هذا السجل وحده.

## 7. ما تم إثباته مقابل ما لم يُنفذ (ملخص)

**[مُثبت بالكود في هذه الدورة]:** بيئة واحدة فقط (preview)؛ حارس نشر يدوي محروس (sha256، dry run، تأكيد لفظي، محاولة واحدة، منع تزامن، فحص `modified_on`، نسخة كود احتياطية، تحقق آلي، rollback آلي عند الفشل، مسار يدوي موثق عند فشل الـrollback)؛ عزل جزئي للأسرار (توكن Cloudflare فقط في سكربت النشر، keep_bindings).

**[لم يُنفذ]:** بيئتا development وproduction المنفصلتان؛ فصل أسرار لكل بيئة؛ نظام migrations مرقّم بأي شكل؛ منع «artifact أقدم فوق أحدث» بترتيب إصدارات؛ سجل نشر/استرجاع دائم؛ الاحتفاظ الدائم بنسخة الكود الاحتياطية؛ نسخ احتياطي واستعادة لبيانات التشغيل.

**[غير مختبر NOT TESTED]:** كل ما سبق لم يُشغَّل في هذه الدورة — التحقق كان قراءة كود ومراجعة اتساق يدوية فقط، بدون dry run وبدون أي نشر أو migration.

## 8. قرارات مفتوحة (للمالك/المراجعة)
1. اعتماد تسمية البيئات والسكربتات: هل `nova-rx-preview` تبقى staging وننشئ `nova-rx-prod`؟ وهل development تكون Worker منفصل أم محلي فقط؟
2. سياسة أسرار لكل بيئة (§2 مقترح 1-2) وحدود صلاحيات التوكن وموعد دورانه.
3. هل يُقبل مقترح `ARTIFACT_VERSION` التصاعدي (§4) أم يُكتفى بفحص `modified_on` مع سياسة «النشر من main فقط»؟
4. شكل سجل النشر الدائم (§6): ملف في الـrepo أم جدول في قاعدة البيانات بعد قرار FND-02؟
5. مدة الاحتفاظ بنسخة الكود الاحتياطية ومكانها (§5ب).
6. ترتيب التنفيذ مقابل FND-02: migrations المرقّمة بلا معنى قبل اختيار قاعدة البيانات — هل يُجمَّد هذا الجزء حتى قياس FND-02؟

## 9. حدود هذه الدورة
لم يُعدَّل أي workflow أو سكربت نشر أو إعداد Cloudflare؛ لم تُنفذ migration أو deploy أو rollback؛ لم تُقرأ أسرار أو بيانات عملاء؛ لم تُضف ملفات JS/JSON جديدة. هذه مسودة تصميم قابلة للمراجعة ضمن بند FND-05 الأكبر، ولا تغيّر حالة الخطة ولا نسبة قبولها.
