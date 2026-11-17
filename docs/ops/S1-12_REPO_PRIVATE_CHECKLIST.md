# S1-12 — قائمة تحويل الريبو إلى Private (للمالك أو Nova فقط)

> المهمة دي **ما بتغيرش رؤية الريبو**. التحويل نفسه قرار المالك.

## قبل التحويل
1. **الفوترة:** على الريبو الخاص، GitHub Actions بتتحسب دقائق. لو الحساب مفيهوش وسيلة دفع شغالة أو حد صرف مناسب، **كل الـworkflows بتفشل في 3 ثواني** ("recent account payments have failed or your spending limit needs to be increased") — حصل ده فعلاً يوم 2026-11-17. حدّث الفوترة الأول: Settings → Billing and plans.
2. **secret-scan نظيف:** `node scripts/secret-scan.mjs` (آخر تشغيل: نظيف، exit 0). أي نتيجة تتصلح بتغيير الكود من غير إعادة كتابة تاريخ git.
3. **النسخ الاحتياطية تفضل مشفّرة:** `.github/workflows/d1-backup.yml` بيرفع `*.sql.gz.enc` + manifest بس (AES-256-CBC + PBKDF2). التشفير بيفضل إجباري حتى بعد ما الريبو يبقى خاص.
4. **الإيميل المكتوب في الكود:** فيه إيميل المالك متكتب كفحص أدمن جوه الـbundle؛ تحويل الريبو لخاص بيقلل الانكشاف بس **ما بيشيلوش** من الكود المنشور على الإنترنت (الـWorker). شيله من الكود مهمة مستقلة.

## التحويل
- من الواجهة: Settings → General → Danger Zone → Change visibility → Make private (هيطلب تأكيد هوية: GitHub Mobile أو كود على الإيميل).
- أو بالأمر (بعد موافقة المالك):

```bash
gh repo edit elsousypharmacy-create/nova-rx --visibility private --accept-visibility-change-consequences
```

## بعد التحويل
- **WebFetch والقراءة المجهولة** للريبو هتقف (404)؛ الأدوات لازم تستخدم حساب مسجّل.
- الـforks الموجودة (لو فيه) بتفضل public ومنفصلة.
- Dependabot المخصص و Advanced Security بيتعطلوا لو مش مفعلين على الخطة.
- اتأكد إن "Backend unit checks" و"Auto-deploy preview artifact" لسه بيشتغلوا (مش بيفشلوا في 3 ثواني).
- سجّل التاريخ والنتيجة في `CURRENT.md` (S1-13).
