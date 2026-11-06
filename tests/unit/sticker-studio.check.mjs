import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../sticker-studio.html', import.meta.url), 'utf8');
const requiredTexts = [
  'استيكرات الأدوية',
  'المريض والأدوية',
  'الطباعة',
  'موافقة الصيدلي إلزامية قبل الطباعة',
  'لا تخمن الجرعة',
  'إعادة توليد AI',
  'طباعة اختبار',
  'ورق مقسوم',
  'مقاس مخصص',
  '01143404023'
];
for (const text of requiredTexts) assert(html.includes(text), `missing required UI text: ${text}`);
for (const preset of ['50x30','40x30','40x25','50x25','58x40','60x40','70x50','100x50']) assert(html.includes(`'${preset}'`), `missing preset ${preset}`);
for (const token of [
  "const DRAFT_KEY='nova.stickerStudio.draft.v1'",
  "const SETTINGS_KEY='nova.stickerStudio.settings.v1'",
  "const QUEUE_KEY='nova.label.invoices.v1'",
  "fetch('/api/ai/medication-label'",
  'reviewRequired:true',
  'med.missing=required.filter',
  'if(!state.approved)',
  '@page{size:',
  'width:${w}mm;height:${h}mm',
  "const LOGO='https://elsousypharmacy-create.github.io/pharmacy/logo-mark.png'"
]) assert(html.includes(token), `missing implementation token: ${token}`);
assert(!html.includes('GEMINI_API_KEY'), 'frontend must not contain API key');
assert(!html.includes('sk-'), 'frontend must not contain obvious secrets');
console.log('Sticker Studio static regression checks PASS');
