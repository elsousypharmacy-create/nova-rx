import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// UX70: a fresh load opens Sale with search focused unless the hash names a page.
const BASE = process.env.NOVA_UX_URL || 'http://127.0.0.1:8766/';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const active = () => page.evaluate(() => document.body.dataset.activePage);
  await page.goto(BASE + 'index.html');
  await page.locator('[data-page="products"]').first().click();
  assert.equal(await active(), 'products');
  await page.goto(BASE + 'index.html');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.activePage === 'sale');
  assert.equal(await active(), 'sale');
  const s = page.locator('#mainSearchInput');
  assert.ok(await s.isVisible(), 'search visible');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mainSearchInput');
  await page.goto(BASE + 'index.html#reports');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.activePage === 'reports');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.deepEqual(errors, []);
  console.log('start-on-sale passed');
} finally { await browser.close(); }
