import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = 'file://' + path.join(root, 'emergency-sales.html');
const CSV = path.join(root, 'tests/fixtures/emergency/snapshot-sample.csv');
const out = path.join(root, 'reports'); fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (n, c) => { results.push([n, c ? 'PASS' : 'FAIL']); assert.ok(c, n); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'ar-EG' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_);
ok('no snapshot -> explicit warning, data tab open', /لا توجد أسعار/.test(await page.textContent('#srcBanner')));
await page.setInputFiles('#file', CSV);
await page.waitForSelector('#dataMsg:has-text("تم تحميل 4")');
await page.click('#nSell');
ok('unknown export time -> warning, source stamp, never claims fresh', /غير معروف/.test(await page.textContent('#srcBanner')) && /المصدر: STOCK LIVE/.test(await page.textContent('#srcBanner')) && /ليس لحظي/.test(await page.textContent('#srcBanner')) && (await page.getAttribute('#srcBanner','class')).includes('unknown'));
await page.fill('#who', 'اختبار');
await page.fill('#q', 'بانادول');
await page.waitForSelector('[data-add]');
ok('search shows price and never presents stale stock balance as available', /12\.50/.test(await page.textContent('#results')) && /الرصيد غير متاح حاليًا/.test(await page.textContent('#results')) && !/متاح حاليًا:\s*\d/.test(await page.textContent('#results')));
await page.click('[data-add="0"]');
await page.fill('#q', 'اوجمنتين'); await page.click('[data-add="0"]');
ok('total = 77.00', /77\.00/.test(await page.textContent('#tTot')));
// no-price item has no add button
await page.fill('#q', 'بدون سعر'); ok('no-price item cannot be added', (await page.locator('[data-add]').count()) === 0 && /لا يوجد سعر/.test(await page.textContent('#results')));
await page.fill('#q', '');
// refresh recovery
await page.reload(); await page.waitForSelector('#lines .line');
ok('draft restored after refresh', (await page.locator('#lines .line').count()) === 2 && /استرجاع/.test(await page.textContent('#msg')));
await page.screenshot({ path: path.join(out, 'emergency-mobile.png') });
// discount needs approver
await page.fill('#disc', '7');
await page.click('#bMake'); // staff name restored from storage
ok('discount without approver blocked', /اعتمد/.test(await page.textContent('#msg')) || (await page.locator('#queue .line').count()) === 0);
await page.fill('#discBy', 'د. أحمد');

// connectivity lost during PDF: must still work (no network use)
await ctx.setOffline(true);
const dl = page.waitForEvent('download');
await page.click('#bMake');
const d = await dl; const pdfPath = path.join(out, 'emergency-sample-2items.pdf'); await d.saveAs(pdfPath);
await ctx.setOffline(false);
const bytes = fs.readFileSync(pdfPath);
ok('PDF produced offline, valid header', bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-6).toString().includes('%%EOF'));
await page.waitForSelector('#msg:has-text("تم تنزيل")');
await page.click('#nQueue');
ok('invoice pending in queue with warning', /في الانتظار/.test(await page.textContent('#queue')) && /هذا الجهاز فقط/.test(await page.textContent('#vQueue')));
const exp = await page.evaluate(() => JSON.parse(window.__nova.queue.exportForImport()));
ok('export has stable externalId', exp.invoices.length === 1 && /^[0-9a-f-]{36}$/.test(exp.invoices[0].externalId) && exp.invoices[0].discount === 7 && exp.invoices[0].total === 70);
await page.screenshot({ path: path.join(out, 'emergency-queue.png') });

// 1 / 6 / 20 items + long name
async function pdfFor(n, name) {
  await page.click('#nSell');
  await page.evaluate(n => { const E = window.__nova.E, b = window.__nova.getBasket(); for (let i = 0; i < n; i++) E.addLine(b, { code: '2000' + String(i).padStart(4, '0'), name: i === 0 ? 'اختبار صنف باسم طويل جدا جدا جدا يتكرر ليختبر الالتفاف في الفاتورة ويتجاوز سطرين كاملين من العرض المتاح في الجدول لازم يتقص بنقط' : 'صنف اختبار ' + (i + 1), price: 10.5 + i }, 1 + (i % 3)); }, n);
  await page.fill('#cust', ''); await page.evaluate(() => document.getElementById('q').dispatchEvent(new Event('input')));
  // trigger render + persist through a field event
  await page.fill('#disc', ''); await page.fill('#discBy', '');
  await page.evaluate(() => document.getElementById('who').dispatchEvent(new Event('input')));
  const w = page.waitForEvent('download'); await page.evaluate(() => document.getElementById('bMake').click());
  const dd = await w; const p = path.join(out, name); await dd.saveAs(p); return fs.readFileSync(p);
}
for (const n of [1, 6, 20]) {
  const b = await pdfFor(n, `emergency-sample-${n}items.pdf`);
  const pages = (b.toString('latin1').match(/\/Type \/Page /g) || []).length;
  ok(`PDF ${n} items -> ${n === 20 ? 3 : 1} page(s)`, pages === (n === 20 ? 3 : 1));
}
ok('no page errors', errors.length === 0);
fs.writeFileSync(path.join(out, 'emergency-sales-results.txt'), results.map(r => r.join('  ')).join('\n') + '\n');
await browser.close();
console.log(results.map(r => r.join('  ')).join('\n')); console.log('emergency-sales browser checks passed');
