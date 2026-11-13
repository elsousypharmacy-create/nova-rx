import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// UX19: one click from purchases opens the receiving panel on the products page.
const BASE = process.env.NOVA_UX_URL || 'http://127.0.0.1:8766/';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => localStorage.setItem('novaApiPin', 'test-pin'));
  const stamp = new Date().toISOString();
  const stock = [{ id: '1', code: '1301', name: 'صنف تجريبي', nameEn: 'Ux 500mg', stock: 1, minStock: 4, idealStock: 8, dailySales: null, observedDays: 0 }];
  await context.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/purchases/stock' ? { ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + 'purchases.html');
  const link = page.locator('#receiveInvoice');
  assert.equal((await link.innerText()).trim(), 'استلام فاتورة');
  assert.ok((await link.boundingBox()).height >= 44, 'receive button >=44px');
  let clicks = 0;
  await link.click(); clicks++;
  await page.waitForSelector('#novaAiPanel.open', { timeout: 10000 });
  assert.ok(page.url().includes('index.html'));
  assert.ok(clicks <= 2, 'clicks <= 2');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  // mobile select-all label >= 44px
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(BASE + 'purchases.html');
  await page.locator('#load').click();
  await page.locator('#selectAll').waitFor({ state: 'visible' });
  const box = await page.locator('.select-all-label').boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, 'select-all label 44px');
  assert.deepEqual(errors, []);
  console.log('purchases-receive-link passed: clicks=' + clicks);
} finally { await browser.close(); }
