// N17 (CAT-05): instant product search in index.html — Arabic variants (أ/ا/إ, ة/ه, ى/ي), Latin names, small typos,
// exact barcode match, name/strength/pack highlighting, and local p95 <= 150ms on a 5000-item mock catalog.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
let n = 0;
const t = async (name, fn) => {
  try { await fn(); n++; console.log('  ok', name); }
  catch (e) { console.error('  FAIL', name, '\n   ', e && e.stack ? e.stack : e); process.exit(1); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// Keep deterministic local catalog (no external fetch required)
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: 'offline' }));
await page.addInitScript(() => {
  try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {}
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.NOVA_DEMO && window.novaSearch);

// Add extra local items covering ة/ه, ى/ي, and numeric boundary cases (1500 vs 500)
await page.evaluate(() => {
  window.NOVA_DEMO.products.push(
    { id: 'PRD013', barcode: '6281001234579', name: 'مرهم عناية البشرة 50 جم (Skin Care Ointment 50g)', generic: 'Panthenol 50mg', strength: '50 مجم', pack: '1 عبوة', form: '1 عبوة', price: 30, stock: 20, category: 'Topical' },
    { id: 'PRD014', barcode: '6281001234580', name: 'شراب مستشفى الشفاء 100 مل (Hospital Syrup 100ml)', generic: 'Herbal Cough', strength: '100 مل', pack: '1 زجاجة', form: '1 زجاجة', price: 25, stock: 15, category: 'Syrup' },
    { id: 'PRD015', barcode: '6281001234581', name: 'أقراص سلوى مقوي عام 1500 مجم (Salwa Tonic 1500mg)', generic: 'Multivitamin 1500mg', strength: '1500 مجم', pack: '30 قرص', form: '30 قرص', price: 55, stock: 10, category: 'Vitamins' }
  );
  window.novaSearch.rebuild();
});

const search = async q => {
  const inp = page.locator('#mainSearchInput');
  await inp.fill('');
  await inp.fill(q);
  await page.waitForTimeout(80);
};
const suggItems = () => page.locator('#suggestionsBox .suggestion-item');
const suggText = () => page.locator('#suggestionsBox').innerText();

console.log('Running N17 CAT-05 instant search UI & perf checks...');

await t('Arabic letter variants (أ/ا/إ/آ, ة/ه, ى/ي) and Arabic digits match interchangeably', async () => {
  // أ / ا / إ
  for (const q of ['أوجمنتين', 'اوجمنتين', 'إوجمنتين', 'آوجمنتين']) {
    await search(q);
    assert.ok((await suggText()).includes('أوجمنتين'), `alef variant ${q}`);
  }
  for (const q of ['بانادول اكسترا', 'بانادول إكسترا', 'بانادول أكسترا']) {
    await search(q);
    assert.ok((await suggText()).includes('بانادول إكسترا'), `hamza variant ${q}`);
  }
  // ة / ه
  for (const q of ['عناية البشرة', 'عنايه البشره', 'عناية البشره', 'عنايه البشرة']) {
    await search(q);
    assert.ok((await suggText()).includes('مرهم عناية البشرة'), `ta marbuta / ha variant ${q}`);
  }
  // ى / ي
  for (const q of ['مستشفى', 'مستشفي', 'سلوى مقوي', 'سلوي مقوى']) {
    await search(q);
    const txt = await suggText();
    assert.ok(txt.includes('مستشفى') || txt.includes('سلوى'), `alef maqsura / ya variant ${q}`);
  }
  // Arabic-Indic digits
  await search('جلوكوفاج ٥٠٠');
  assert.ok((await suggText()).includes('جلوكوفاج 500 مجم'), 'Arabic-Indic digits ٥٠٠ match 500');
});

await t('Latin names (brand and generic) and mixed Arabic/Latin queries match', async () => {
  await search('concor 5mg');
  assert.ok((await suggText()).includes('Concor 5mg'));
  await search('AUGMENTIN');
  assert.ok((await suggText()).includes('Augmentin 1g'));
  await search('esomeprazole');
  assert.ok((await suggText()).includes('Nexium 40mg'));
  await search('بانادول extra');
  assert.ok((await suggText()).includes('Panadol Extra'));
});

await t('small typos (1 edit on 4-7 letters, 2 edits on 8+, adjacent swap) match; numbers are whole-number only', async () => {
  await search('panadool');
  assert.ok((await suggText()).includes('Panadol Extra'), '1-edit insertion on 7-letter word');
  await search('بنادول');
  assert.ok((await suggText()).includes('بانادول إكسترا'), 'common Arabic typo بنادول -> بانادول');
  await search('concro');
  assert.ok((await suggText()).includes('Concor 5mg'), 'adjacent transposition');
  await search('augmntn');
  assert.ok((await suggText()).includes('Augmentin 1g'), '2 edits on 9-letter word');
  // Whole-number check: 500 finds 500mg, never 1500mg
  await search('500');
  const txt500 = await suggText();
  assert.ok(txt500.includes('جلوكوفاج 500 مجم') || txt500.includes('Panadol Extra'));
  assert.ok(!txt500.includes('1500 مجم'), '500 never matches 1500');
});

await t('exact barcode match (Latin digits, separators, Arabic digits) and unknown barcode rejection', async () => {
  await search('6281001234568');
  assert.equal(await suggItems().count(), 1);
  assert.ok((await suggText()).includes('Panadol Extra'));
  await search('٦٢٨١٠٠١٢٣٤٥٦٩');
  assert.equal(await suggItems().count(), 1);
  assert.ok((await suggText()).includes('Augmentin 1g'));
  await search('6281-001234570');
  assert.equal(await suggItems().count(), 1);
  assert.ok((await suggText()).includes('Glucophage 500mg'));
  // Pressing Enter on exact barcode adds the item to the invoice
  await page.locator('#mainSearchInput').press('Enter');
  await page.waitForTimeout(100);
  assert.ok((await page.locator('#invoiceTableBody').innerText()).includes('Glucophage 500mg'));
  // Unknown 13-digit barcode returns 0 items (never a fuzzy guess)
  await search('6281009999999');
  assert.equal(await suggItems().count(), 0);
});

await t('highlighting marks matched tokens in name, strength and pack (including variants and typos) safely', async () => {
  await search('concor 5 30');
  const first = suggItems().first();
  assert.ok(await first.count() > 0);
  const nameMarks = await first.locator('[data-hl="name"] mark.sugg-hl').allInnerTexts();
  const strMarks = await first.locator('[data-hl="strength"] mark.sugg-hl').allInnerTexts();
  const packMarks = await first.locator('[data-hl="pack"] mark.sugg-hl').allInnerTexts();
  assert.ok(nameMarks.some(x => /concor/i.test(x)), 'name highlighted: ' + nameMarks.join(','));
  assert.ok(strMarks.some(x => x.includes('5')), 'strength highlighted: ' + strMarks.join(','));
  assert.ok(packMarks.some(x => x.includes('30')), 'pack highlighted: ' + packMarks.join(','));

  // Variant & typo highlighting
  await search('اكسترا panadool 24');
  const pFirst = suggItems().first();
  const pNameMarks = await pFirst.locator('[data-hl="name"] mark.sugg-hl').allInnerTexts();
  const pPackMarks = await pFirst.locator('[data-hl="pack"] mark.sugg-hl').allInnerTexts();
  assert.ok(pNameMarks.includes('إكسترا') && pNameMarks.includes('Panadol'), 'variant + typo highlighted in name: ' + pNameMarks.join(','));
  assert.ok(pPackMarks.includes('24'), 'pack highlighted: ' + pPackMarks.join(','));

  // Hostile markup is escaped, never executed
  const safeHtml = await page.evaluate(() => window.novaSearch.highlight('<img src=x onerror="window.__xss=1">بانادول', 'بانادول'));
  assert.ok(safeHtml.includes('&lt;img') && safeHtml.includes('<mark class="sugg-hl">بانادول</mark>'));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});

await t('perf check: local results p95 <= 150ms on a 5000-item mock catalog (engine + live UI)', async () => {
  const perf = await page.evaluate(() => window.novaSearch.benchmark(5000));
  console.log(`      5000-item benchmark: build=${perf.buildMs.toFixed(1)}ms, p50=${perf.p50Ms.toFixed(2)}ms, p95=${perf.p95Ms.toFixed(2)}ms, max=${perf.maxMs.toFixed(2)}ms (${perf.queries} queries)`);
  assert.equal(perf.catalogSize, 5000);
  assert.ok(perf.p95Ms <= 150, `expected p95 <= 150ms, got ${perf.p95Ms}ms`);
  assert.equal(perf.pass, true);

  // Also verify live UI input + renderProductSuggestions on 5000 items in the page
  const uiP95 = await page.evaluate(() => {
    const ar = ['بانادول', 'أوجمنتين', 'كونكور', 'جافيسكون', 'أوميبرازول', 'زيرتك', 'فولتارين', 'ليبيتور', 'جلوكوفاج', 'أسبرين'];
    const en = ['Panadol', 'Augmentin', 'Concor', 'Gaviscon', 'Omeprazole', 'Zyrtec', 'Voltaren', 'Lipitor', 'Glucophage', 'Aspirin'];
    const mock5k = Array.from({ length: 5000 }, (_, i) => ({
      id: 'MK' + i,
      barcode: String(6222000000000 + i),
      name: `${ar[i % 10]} ${i} ${(i % 5 + 1) * 10} مجم (${en[i % 10]} ${(i % 5 + 1) * 10}mg)`,
      strength: `${(i % 5 + 1) * 10} مجم`,
      pack: `${(i % 3 + 1) * 10} قرص`,
      form: `${(i % 3 + 1) * 10} Tabs`,
      generic: `${en[i % 10]} base`,
      price: 20 + (i % 100)
    }));
    window.NOVA_DEMO.products.splice(0, window.NOVA_DEMO.products.length, ...mock5k);
    window.novaSearch.rebuild();
    const inp = document.getElementById('mainSearchInput');
    const qs = ['اوجمنتين 20', 'panadool 10', 'كونكور 30', '6222000002500', 'اسبرين 50', 'gavsicon 40'];
    const times = [];
    for (let k = 0; k < 60; k++) {
      const q = qs[k % qs.length];
      const t0 = performance.now();
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { count: window.NOVA_DEMO.products.length, p95: times[Math.floor(times.length * 0.95)] };
  });
  assert.equal(uiP95.count, 5000);
  assert.ok(uiP95.p95 <= 150, `UI input+render p95 <= 150ms, got ${uiP95.p95.toFixed(2)}ms`);
  assert.equal(errors.length, 0, errors.join(' | '));
});

await ctx.close();
await browser.close();
console.log(`PASS N17 CAT-05 instant search checks: ${n} cases`);
