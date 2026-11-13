// UX35: Settings copy — Arabic role/permission labels, matrix collapsed, one register, language switch <= 3 clicks.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaAuthUI && window.novaPerms && window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  let clicks = 0;
  await page.locator('.nova-tab[data-page=settings]').click(); clicks++;
  await page.waitForSelector('#novaPermMatrix', { state: 'attached' });
  // matrix collapsed by default
  assert.equal(await page.locator('#novaPermDetails').evaluate(d => d.open), false);
  assert.equal(await page.locator('#novaPermMatrix').isVisible(), false);
  assert.match(await page.locator('#novaPermDetails > summary').innerText(), /مصفوفة الصلاحيات \(للمدير\)/);
  // no permission keys in the visible text, even once the matrix is expanded
  const visible = async () => (await page.locator('.nova-settings-grid').innerText());
  assert.equal(/[a-z]+\.[a-z]+/.test(await visible()), false, 'visible text has a permission key');
  await page.locator('#novaPermDetails > summary').click();
  const txt = await visible();
  assert.equal(/[a-z]+\.[a-z]+/.test(txt), false, 'expanded matrix shows a permission key: ' + (txt.match(/[a-z]+\.[a-z]+/) || [])[0]);
  for (const w of ['المالك', 'المدير', 'الصيدلي', 'الكاشير', 'المخزن', 'المحاسب', 'المندوب', 'إنشاء بيع']) assert.ok(txt.includes(w), 'missing ' + w);
  // copy cleanup
  assert.ok(txt.includes('المظهر: Black Edition، خط Cairo، مناسب للتابلت'));
  assert.ok(!txt.includes('اختار') && txt.includes('اختر لغة العرض'));
  // language switch journey: tab + switch = well within 3 clicks
  await page.locator('.nova-lang-btn[data-lang=en]').first().click(); clicks++;
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.ok(clicks <= 3);
  console.log('PASS settings-copy (clicks=' + clicks + ')');
} finally { await browser.close(); }
