// UX83: unknown barcode + Enter.
// (derived harness from POS-01)
// (search/scan, quantity, discount, payment on one screen; keyboard & touch keep focus; 3-item invoice <= 20s).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let passed = 0;
const t = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 3).join('\n'));
    process.exit(1);
  }
  passed++;
  console.log('  ok', name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox']
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.clear();
        sessionStorage.setItem('seeded', '1');
      }
      localStorage.setItem('nova-rx-language', 'ar');
      localStorage.removeItem('nova.activePage');
    } catch {}
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  const inp = page.locator('#mainSearchInput');
  const sel = () => page.evaluate(() => { const i = document.getElementById('mainSearchInput'); return [i.selectionStart, i.selectionEnd, i.value.length]; });

  await t('unknown Latin-digit barcode + Enter: error toast, shortage btn, text selected', async () => {
    await inp.fill('9999999999999');
    await page.waitForTimeout(200);
    await inp.press('Enter');
    await page.waitForTimeout(100);
    assert.ok((await page.locator('body').innerText()).includes('لا يوجد صنف بهذا الباركود: 9999999999999'));
    assert.equal(await page.locator('#novaShortageBtn').count(), 1);
    assert.deepEqual(await sel(), [0, 13, 13]);
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 0);
  });

  await t('next scan replaces stale value (no concatenation)', async () => {
    await page.keyboard.type('8888888888888');
    assert.equal(await inp.inputValue(), '8888888888888');
  });

  await t('Arabic-digit unknown barcode also toasts', async () => {
    await inp.fill('٩٩٩٩٩٩٩٩');
    await page.waitForTimeout(200);
    await inp.press('Enter');
    await page.waitForTimeout(100);
    assert.ok((await page.locator('body').innerText()).includes('لا يوجد صنف بهذا الباركود'));
    assert.deepEqual(await sel(), [0, 8, 8]);
  });

  await t('name search unchanged: no barcode toast, Enter adds first suggestion', async () => {
    await inp.fill('جافيسكون');
    await page.waitForTimeout(200);
    await inp.press('Enter');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 1);
    assert.equal(await inp.inputValue(), '');
  });

  await t('no page errors', async () => { assert.deepEqual(errors, []); });
  console.log(`UX83 OK (${passed} checks)`);
} finally {
  await browser.close();
}
