import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// BUY-02 (N27): supplier comparison shows strength, form, pack size, quantity, cost and date
// per offer with a clear expired-session message (mock data only; never contacts real suppliers).
const stamp = '2026-11-12T10:30:00.000Z';
const stock = [
  { id: '1', code: '2101', name: 'أوجمنتين 500 مجم', nameEn: 'Augmentin 500mg 20 tabs', stock: 1, minStock: 4, idealStock: 10, dailySales: null, observedDays: 0 },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buy02-lookup-'));
fs.writeFileSync(
  path.join(dir, 'in.html'),
  '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="UTF-8"><body><input id="mainSearchInput" value="Augmentin"><div id="suggestionsBox"><div>لا توجد منتجات مطابقة</div></div></body></html>',
);
execFileSync('node', ['tools/inject-supplier-ui.mjs', path.join(dir, 'in.html'), path.join(dir, 'out.html')]);
const lookupHtml = fs.readFileSync(path.join(dir, 'out.html'), 'utf8');

const executablePath = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Offers expire after 6h; pin the page clock near the fixture stamp so the test is date-independent.
  await context.clock.install({ time: new Date(Date.parse(stamp) + 3600000) });
  await context.addInitScript(() => {
    localStorage.setItem('novaApiPin', 'test-pin');
    localStorage.setItem(
      'novaPurchasePrefsV1',
      JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet', 'pharmaoverseas'], aumetSellers: ['s1'] }),
    );
  });
  await context.route('**/lookup-fixture', route => route.fulfill({ contentType: 'text/html', body: lookupHtml }));
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/purchases/stock') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock }) });
    }
    if (pathname === '/api/suppliers/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suppliers: [{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'expired' }] }),
      });
    }
    if (pathname === '/api/suppliers/sellers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sellers: [{ id: 's1', name: 'مخزن المتقدم' }] }),
      });
    }
    if (pathname === '/api/suppliers/search') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fetchedAt: stamp,
          suppliers: [
            { id: 'aumet', name: 'Aumet', state: 'ok' },
            { id: 'pharmaoverseas', name: 'PharmaOverseas', state: 'expired', message: 'الجلسة انتهت، سجّل دخول المورد' },
          ],
          results: [
            {
              item: { name: 'Augmentin 500mg 20 tabs' },
              offers: [
                {
                  offer: {
                    supplierId: 'aumet',
                    supplierName: 'Aumet',
                    sellerId: 's1',
                    sellerName: 'مخزن المتقدم',
                    supplierProductId: 'a1',
                    productName: 'Augmentin 500mg 20 tabs',
                    availableQuantity: 15,
                    unitPrice: 55,
                    publicPrice: 100,
                    discountPct: 45,
                    stockStatus: 'in_stock',
                    currency: 'EGP',
                    lastUpdated: stamp,
                  },
                  packPrice: 55,
                  unitPriceComparable: 2.75,
                  eligible: true,
                  reasons: [],
                },
                {
                  offer: {
                    supplierId: 'aumet',
                    supplierName: 'Aumet',
                    sellerId: 's1',
                    sellerName: 'مخزن المتقدم',
                    supplierProductId: 'a2',
                    productName: 'Augmentin 500mg 12 cap',
                    availableQuantity: 40,
                    unitPrice: 48,
                    publicPrice: 80,
                    discountPct: 40,
                    stockStatus: 'in_stock',
                    currency: 'EGP',
                    lastUpdated: stamp,
                  },
                  packPrice: 48,
                  unitPriceComparable: 4,
                  eligible: false,
                  reasons: ['pack-differs'],
                },
              ],
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 1. Test purchases.html supplier comparison modal & row specs + expired-session message
  await page.goto('http://127.0.0.1:8766/purchases.html');
  await page.locator('#load').click();
  await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#dashboardPin').fill('synthetic-owner-pin');
  await page.locator('#saveSettings').click();
  await page.locator('[data-action=offers]').first().waitFor();

  await page.locator('[data-action=offers]').first().click();
  await page.locator('#offers .offer').first().waitFor({ state: 'visible' });

  const modalText = await page.locator('#offerRows').innerText();
  // UX-P37 turned the comparison into a table (columns instead of «التركيز:/الشكل:/العبوة:» labels). Strength and the word for the form are no longer
  // printed in these rows; the pack line and the product/pack match warning are. Row 1 = the eligible 20-tablet offer, row 2 = the 12-capsule offer.
  const lines = modalText.split('\n').map((x) => x.trim()).filter(Boolean);
  const row = (needle) => { const k = lines.findIndex((x) => x.includes(needle)); assert(k >= 0, 'offer row present: ' + needle); return lines.slice(k, k + 8).join(' | '); };
  const r1 = row('20 قرص'), r2 = row('12 كبسولة');
  assert(r1.includes('أوميت') && r1.includes('الحد الأدنى 1 علبة'), 'comparison row 1 shows supplier, 20-tab pack size and minimum order');
  assert(r2.includes('أوميت') && r2.includes('الحد الأدنى 1 علبة'), 'comparison row 2 shows supplier, 12-cap pack size and minimum order');
  assert(r1.includes('15'), 'comparison row 1 shows available quantity 15');
  assert(r2.includes('40'), 'comparison row 2 shows available quantity 40');
  assert(r1.includes('55 ج.م') && r2.includes('48 ج.م'), 'comparison rows show cost 55 and 48 EGP');
  assert(r1.includes('45٪') && r2.includes('40٪'), 'comparison rows show the discount');
  assert(r1.includes('2026-11-12') && r2.includes('2026-11-12'), 'comparison rows show the offer date');
  assert(r2.includes('راجع مطابقة الصنف والعبوة') && !r1.includes('راجع مطابقة الصنف والعبوة'), 'only the mismatching capsule offer asks to review the product/pack match');
  assert(
    modalText.includes('الجلسة منتهية عند فارما أوفرسيز — جدّد جلسة المورد لإكمال المقارنة'),
    'comparison modal shows clear expired-session message',
  );

  // Select the eligible offer and verify row specs + expired-session warning in the table
  await page.locator('#offerRows [data-offer="0"]').click();
  const rowText = await page.locator('#rows tr').first().innerText();
  assert(rowText.includes('500 mg'), 'allocated row shows strength');
  assert(rowText.includes('أقراص'), 'allocated row shows form');
  assert(rowText.includes('20 قرص'), 'allocated row shows pack size');
  assert(rowText.includes('متاح 15'), 'allocated row shows available quantity');
  assert(rowText.includes('55 ج.م'), 'allocated row shows cost');
  assert(rowText.includes('2026-11-12'), 'allocated row shows date');
  assert(rowText.includes('الجلسة منتهية عند فارما أوفرسيز'), 'allocated row shows expired-session warning');

  // 2. Test supplier-lookup.js popup shows strength, form, pack size, quantity, cost, date and expired session
  await page.goto('http://127.0.0.1:8766/lookup-fixture');
  await page.locator('.su-empty button').click();
  await page.locator('.sp-row').first().waitFor({ state: 'visible' });
  const lookupText = await page.locator('.sp-body').innerText();
  assert(lookupText.includes('500 mg'), 'lookup shows strength');
  assert(lookupText.includes('أقراص'), 'lookup shows form');
  assert(lookupText.includes('20 قرص'), 'lookup shows pack size');
  assert(lookupText.includes('55.00'), 'lookup shows cost');
  assert(lookupText.includes('2026-11-12'), 'lookup shows date');
  assert(lookupText.includes('PharmaOverseas: الجلسة انتهت، سجّل دخول المورد'), 'lookup shows expired-session message');

  assert.deepEqual(errors, []);
  console.log('PASS BUY-02 browser: supplier compare shows strength/form/pack/qty/cost/date and expired-session message (mock data)');
} finally {
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
