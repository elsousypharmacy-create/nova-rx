// #77 step 2: optional «سعر البيع الجديد» on a receiving line becomes the lot's own sale price; an empty field keeps
// today's line shape; a bad price blocks saving. Fake/local data; non-GET and external requests blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(BASE) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  const Q = await page.evaluate(() => { for (const q of ['6281001234567', 'panadol', 'بانادول', 'a', 'ا']) { const p = window.novaSearch.search(q, 1)[0]; if (p && p.barcode && window.novaSearch.search(p.barcode, 1)[0]) return p.barcode; } return null; });
  assert.ok(Q, 'a searchable product with a barcode');
  const key = await page.evaluate(Q => window.novaStock.keyOf(window.novaSearch.search(Q, 1)[0]), Q);
  await page.evaluate(() => { location.hash = '#receiving'; });
  await page.locator('[data-rcv=new]:visible').click();
  await page.locator('#rcvSup').selectOption({ index: 1 });
  await page.locator('#rcvInv').fill('PRICE-1');
  const pickItem = async row => { await row.locator('[data-f=q]').fill(Q); const p = row.locator('[data-pick]').first(); await p.waitFor({ timeout: 5000 }); await p.click(); };
  const row = page.locator('.rcv-line').nth(0);
  await pickItem(row);
  await row.locator('[data-f=qty]').fill('4'); await row.locator('[data-f=cost]').fill('20'); await row.locator('[data-f=exp]').fill('10/35'); await row.locator('[data-f=lot]').fill('NEWP');
  // Enter on the cost field moves to the new price field
  await row.locator('[data-f=cost]').press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-f')), 'price', 'Enter on cost goes to the new sale price');
  // a negative price blocks saving
  await row.locator('[data-f=price]').fill('-3');
  await page.locator('#rcvOk').click();
  await page.waitForFunction(() => (document.querySelector('#rcvMsg') || {}).textContent, null, { timeout: 5000 });
  assert.match(await page.locator('#rcvMsg').textContent(), /سعر بيع صحيح/, 'bad price message');
  assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('nova-rx-receipts-v1') || '[]')).some(r => r.invoice === 'PRICE-1')), false, 'nothing saved with a bad price');
  await row.locator('[data-f=price]').fill('31.505');
  // second line without a new price keeps today's shape
  await page.locator('[data-rcv-add]').click();
  const row2 = page.locator('.rcv-line').nth(1);
  await pickItem(row2);
  await row2.locator('[data-f=qty]').fill('2'); await row2.locator('[data-f=cost]').fill('5'); await row2.locator('[data-f=exp]').fill('12/35'); await row2.locator('[data-f=lot]').fill('OLDP');
  await page.locator('#rcvOk').click();
  await page.locator('#rcvForm').waitFor({ state: 'detached' });
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-receipts-v1')).find(r => r.invoice === 'PRICE-1'));
  assert.equal(rec.pending, false);
  const [l1, l2] = rec.lines;
  assert.equal(l1.price, 31.51, 'new price kept on the line, rounded to 2 decimals');
  assert.deepEqual(Object.keys(l2).sort(), ['autoLot', 'code', 'cost', 'expiry', 'key', 'lot', 'name', 'qty'], 'line without a new price unchanged');
  const lots = await page.evaluate(k => window.novaStock.lots(k).map(l => ({ lot: l.lot, price: l.price })), key);
  assert.deepEqual(lots.find(l => l.lot === 'NEWP'), { lot: 'NEWP', price: 31.51 }, 'lot carries the new sale price');
  assert.equal(lots.find(l => l.lot === 'OLDP').price, undefined, 'lot without a new price has no own price');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('receiving-price PASS');
} finally { await browser.close(); }
