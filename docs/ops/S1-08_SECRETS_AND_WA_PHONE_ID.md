# S1-08 — أسرار الإنتاج بالاسم فقط + WA_PHONE_ID

## فحص الأسرار (أسماء فقط، من غير قيم)
- الأداة: `node tools/backend/check-secret-names.mjs` — بتطبع **yes/NO** لكل اسم:
  - أسرار GitHub Actions: `NOVA_API_PIN`، `NOVA_INGEST_SECRET` (من قائمة الأسماء؛ GitHub ما بيرجّعش قيم أصلاً).
  - الـWorker `nova-rx-api` (الإنتاج): bindings بنفس الأسماء ونوعها `secret_text` (Cloudflare API، أسماء وأنواع بس).
- المتغيرات المطلوبة (بالاسم): `CF_API_TOKEN`، `CF_ACCOUNT_ID`، `GH_TOKEN` (صلاحية قراءة قائمة الأسرار)، `GH_REPO`.
- لو صلاحية ناقصة: بتطبع **اسم الصلاحية** بس (`Account.Workers Scripts:Read` أو `secrets:read`) وتخرج بكود 2، من غير أي تغيير.
- لو سر ناقص على الـWorker: الحل هو نشر الإنتاج الموجود (`.github/workflows/deploy-backend-production.yml`، dry_run الأول، ثم `DEPLOY nova-rx-api production`) لأنه بيحط الأسرار بالاسم. **ممنوع** اختراع سر جديد أو طباعة أي قيمة.
- `set-worker-secrets.yml` بينسخ الأسرار على `nova-rx-preview` (الواجهة) بس، مش على `nova-rx-api`.

## WA_PHONE_ID
- القيمة المتوقعة: **`515646411625617`**.
- الحالي في الكود: `WA_PHONE_ID` بيتقرا بالاسم بس في `backend/src/wa-sender.js` (المرسل المستقبلي)، ومش موجود في `wrangler.toml` (سر، مش متغير عادي). الإرسال الحالي بيتم عبر بوت الصيدلية (bridge) مش عبر Meta مباشرة.
- **ممنوع** في المهمة دي: `/register` أو `/deregister`، نقل الرقم، لمس `WA_TOKEN`، أو تغيير إعدادات Meta. مقارنة القيمة الحية على الـWorker بتتعمل بالاسم فقط (وجود السر) لأن القيمة ما ينفعش تتقري.

## اختبار
`tests/unit/check-secret-names.check.mjs` (fetch وهمي، من غير شبكة).
