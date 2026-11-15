// UX322: chronic refill UI (customer detail section, due badge/filter, one-click reorder to cart). Local fake data, non-GET blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux322-chronic-refill.mjs
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ymd = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const writes = [];
  await ctx.route('**/*', r => { const q = r.request(), u = q.url(); if (!['GET', 'HEAD'].includes(q.method())) { writes.push(u); return r.abort(); } return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.NOVA_DEMO && window.novaChronic, null, { timeout: 8000 });
  await page.evaluate(([old, recent]) => {
    const d = window.NOVA_DEMO, chronic = d.products.filter(p => p.category === 'Chronic' && p.stock > 2)[0];
    d.customers.length = 0;
    d.customers.push(
      { id: 'F1', name: 'عميل مستحق', phone: '0500000001', tier: 'silver', visits: 3, points: 5, pastInvoices: [{ id: 'i1', date: old + ' 10:00', items: [{ productId: chronic.id, name: chronic.name, qty: 2 }] }] },
      { id: 'F2', name: 'عميل حديث', phone: '0500000002', tier: 'silver', visits: 1, points: 1, pastInvoices: [{ id: 'i2', date: recent + ' 10:00', items: [{ productId: chronic.id, name: chronic.name, qty: 1 }] }] });
    window.__chronicId = chronic.id;
    document.querySelector('[data-page="customers"]').click();
  }, [ymd(45), ymd(3)]);
  await page.waitForSelector('tr[data-cust-row]');
  assert.equal(await page.locator('[data-refill-badge]').count(), 1);
  assert.equal(await page.locator('[data-refill-badge="F1"]').count(), 1);
  assert.match(await page.locator('[data-cust-count="refill"]').innerText(), /^[1١]$/);
  await page.locator('[data-cust-filter="refill"]').click();
  assert.equal(await page.locator('tr[data-cust-row]').count(), 1);
  await page.locator('[data-cust-filter="all"]').click();
  assert.equal(await page.locator('tr[data-cust-row]').count(), 2);
  await page.locator('tr[data-cust-row="F1"] td:first-child').click();
  const sec = page.locator('#novaCustChronic');
  await sec.waitFor();
  assert.match(await sec.innerText(), new RegExp(ymd(45)));
  assert.match(await sec.innerText(), /مستحقة للصرف/);
  await page.locator('[data-cd-refill]').click();
  await page.waitForFunction(() => document.querySelector('[data-page="sale"]').classList.contains('active'));
  const inCart = await page.evaluate(() => document.body.innerText);
  const name = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p.id === window.__chronicId).name.replace(/\s*\(.*\)\s*$/, ''));
  assert.ok(inCart.includes(name), 'chronic item in cart');
  assert.deepEqual(errs, []); assert.deepEqual(writes, []);
  console.log('  ok', vp.width + 'x' + vp.height);
  await ctx.close();
}
await browser.close();
