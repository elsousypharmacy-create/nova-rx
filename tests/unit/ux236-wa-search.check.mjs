// UX236: Arabic-insensitive inbox search (hamza/diacritics/ta-marbuta/ya/digits), message text + phone, no-result + clear button.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const conv = (id, customer, texts) => ({ id, customer, updatedAt: 5, messages: texts.map((x, i) => ({ id: 'm' + i, dir: 'in', kind: 'in', text: x, at: i + 1, status: null })) });
const C = [conv('wa_201012345678', 'أحمد علي', ['عايز بنادول']), conv('wa_201099999999', 'منى', ['فيه إسعافات؟', 'رقمي ٠١٠٢٣٤'])];
const ids = (q) => (U.chatListHtml(C, null, q, 9).match(/data-conv="([^"]+)"/g) || []).map((x) => x.slice(11, -1));
t('normAr folds hamza, tashkeel, tatweel, ya, ta marbuta, digits', () => {
  assert.equal(U.normAr('أَحْمَد'), U.normAr('احمد'));
  assert.equal(U.normAr('إسعافات'), 'اسعافات'); assert.equal(U.normAr('مدرسة'), U.normAr('مدرسه'));
  assert.equal(U.normAr('على'), U.normAr('علي')); assert.equal(U.normAr('كـــريم'), 'كريم');
  assert.equal(U.normAr('٠١٢٣٤٥٦٧٨٩۰۱'), '012345678901');
});
t('names match with or without hamza', () => { assert.deepEqual(ids('احمد'), ['wa_201012345678']); assert.deepEqual(ids('أحمد'), ['wa_201012345678']); });
t('message text matches ignoring hamza', () => assert.deepEqual(ids('اسعافات'), ['wa_201099999999']));
t('phone digits match, Arabic-Indic too', () => { assert.deepEqual(ids('01012345678'), ['wa_201012345678']); assert.deepEqual(ids('٠١٠١٢٣٤٥٦٧٨'), ['wa_201012345678']); });
t('message digits fold', () => assert.deepEqual(ids('010234'), ['wa_201099999999']));
t('no result message includes escaped query', () => assert.ok(U.chatListHtml(C, null, '<zz>', 9).includes('لا نتائج لـ “&lt;zz&gt;”')));
t('clear button rendered hidden when empty, visible with query', () => {
  assert.match(U.renderWa(C, { query: '' }), /data-wa-sclear[^>]*hidden/);
  assert.doesNotMatch(U.renderWa(C, { query: 'ا' }), /data-wa-sclear[^>]*hidden/);
});
console.log('ux236 unit OK', n);
