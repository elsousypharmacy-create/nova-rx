import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../sticker-studio.html', import.meta.url), 'utf8');

const requiredTexts = [
  'استوديو استيكرات الأدوية',
  'بيانات المريض والأدوية',
  'إعدادات الطباعة والمعاينة',
  'موافقة الصيدلي إلزامية قبل الطباعة',
  'لا تخمن الجرعة',
  'إعادة توليد AI',
  'طباعة اختبار',
  'ورق مقسوم',
  'مقاس مخصص',
  '01143404023'
];
for (const text of requiredTexts) assert(html.includes(text), `missing required UI text: ${text}`);

const requiredPresets = ['50x30','40x30','40x25','50x25','58x40','60x40','70x50','100x50'];
for (const preset of requiredPresets) assert(html.includes(`'${preset}'`), `missing preset ${preset}`);

assert(html.includes("const DRAFT_KEY='nova.stickerStudio.draft.v1'"), 'draft persistence key missing');
assert(html.includes("const SETTINGS_KEY='nova.stickerStudio.settings.v1'"), 'print settings persistence key missing');
assert(html.includes("const QUEUE_KEY='nova.label.invoices.v1'"), 'existing POS invoice queue key not preserved');
assert(html.includes("fetch('/api/ai/medication-label'"), 'Gemini Worker route integration missing');
assert(html.includes("reviewRequired:true"), 'pharmacist review enforcement missing');
assert(html.includes('med.missing=required.filter'), 'incomplete-field tracking missing');
assert(html.includes("if(!state.approved)"), 'approval gate missing');
assert(html.includes('@page{size:'), 'physical @page size generation missing');
assert(html.includes('width:${w}mm;height:${h}mm'), 'physical preview dimensions missing');
assert(html.includes('logo-mark.png'), 'owner logo reference missing');
assert(!html.includes('GEMINI_API_KEY'), 'frontend must not contain API key');
assert(!html.includes('sk-'), 'frontend must not contain obvious secrets');

const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert(script, 'inline script missing');
assert(script.includes('generateForMedication'), 'AI generation function missing');
assert(script.includes('printPage'), 'print function missing');
assert(script.includes('normalizeMedication'), 'normalization function missing');

console.log('✓ sticker-studio static regression checks passed');
