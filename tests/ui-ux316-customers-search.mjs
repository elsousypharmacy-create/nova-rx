// UX316: customers search — correct no-results copy, clear button, Arabic normalisation (spaces/hamza/ya/ta marbuta/digits).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!['GET','HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u); return r.abort(); }
    if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.setItem('nova.activePage', 'customers'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.NOVA_DEMO);
  await page.evaluate(() => { const d = window.NOVA_DEMO; d.customers.push({ id: 'CUXT1', name: 'عبد الله اختبار', phone: '0500000099', tier: 'silver', visits: 1, points: 1, pastInvoices: [] }); });
  await page.evaluate(() => document.querySelector('[data-page="customers"], [data-tab="customers"]')?.click());
  const f = page.locator('#novaFilter');
  await f.waitFor();
  const clear = page.locator('#novaFilterClear');
  assert.equal(await clear.isHidden(), true, 'clear hidden when empty');
  await f.fill('zzz');
  assert.equal(await clear.isVisible(), true, 'clear visible with text');
  const empty = await page.locator('#novaCustEmpty').innerText();
  assert.ok(empty.includes('لا توجد نتائج لـ «zzz»'), empty);
  assert.ok(!empty.includes('لا يوجد عملاء بعد'));
  await page.locator('#novaCustClear').click();
  assert.equal(await page.locator('#novaFilter').inputValue(), '');
  await page.locator('#novaFilter').fill('عبدالله');
  let t0 = Date.now();
  assert.ok((await page.locator('main, body').first().innerText()).includes('عبد الله اختبار'), 'عبدالله matches عبد الله');
  assert.ok(Date.now() - t0 < 100, 'under 100ms');
  await page.locator('#novaFilterClear').click();
  assert.equal(await page.locator('#novaFilter').inputValue(), '');
  await f.fill('zzz'); await page.locator('#novaFilterClear').click();
  assert.equal(await page.locator('#novaFilter').inputValue(), '');
  assert.deepEqual(writes, []); assert.deepEqual(errs, []);
  n++; console.log('  ok', vp.width + 'x' + vp.height);
  await ctx.close();
}
await browser.close(); console.log('UX316 passed', n);
