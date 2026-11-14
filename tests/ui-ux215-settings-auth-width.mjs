// UX215: Settings "الحسابات والجلسات" forms are width-constrained (<=460px), carded, with helper/error states.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
mkdirSync('.nova/qa/ux215', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0;
for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: 'offline' }));
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaAuth && window.novaAuthUI);
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=settings]').click());
  await page.waitForSelector('#novaAuthCard');
  await page.locator('#novaAuthCard summary').first().click();
  const w = async s => (await page.locator(s).boundingBox()).width;
  for (const s of ['#novaNewName', '#novaNewPw', '#novaNewForm']) assert.ok(await w(s) <= 460, `${name} ${s} width ${await w(s)}`);
  await page.fill('#novaNewName', 'Ahmed'); await page.fill('#novaNewPw', 'secret1'); await page.click('#novaNewOk');
  await page.waitForSelector('#novaAuthIn');
  for (const s of ['#novaAuthName', '#novaAuthPw', '#novaAuthForm']) assert.ok(await w(s) <= 460, `${name} ${s} width ${await w(s)}`);
  // error state
  await page.click('#novaAuthIn');
  assert.equal(await page.getAttribute('#novaAuthName', 'aria-invalid'), 'true');
  assert.ok((await page.textContent('#novaAuthMsg')).length > 0);
  // tab order: name -> password -> submit
  await page.focus('#novaAuthName'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'novaAuthPw');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'novaAuthIn');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).direction), 'rtl');
  await page.locator('#novaAuthCard').screenshot({ path: `.nova/qa/ux215/settings-auth-${name}.png` });
  assert.deepEqual(errors, []); n++; console.log('  ok', name);
  await ctx.close();
}
await browser.close(); console.log('ux215: ' + n + ' passed');
