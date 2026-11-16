// UX439: reports top sellers follow the period with qty+revenue headers; zero returns row hidden; pay share %. Fake data, non-GET blocked.
const { chromium } = await import(process.env.PW_PATH || '@playwright/test');
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const mk = (i, pay, total, name, qty, daysAgo = 0) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - daysAgo * 864e5 - i * 6e4, total, vat: 0, payment: pay, customer: '', lines: [{ name, price: total / qty, qty, discount: 0 }] });
const sales = [mk(1, 'cash', 50, 'بنادول', 2), mk(2, 'card', 50, 'أوغمنتين', 1), mk(3, 'cash', 300, 'قديم-أسبوع', 6, 3), mk(4, 'cash', 99, 'قديم-شهر', 9, 40)];
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : {});
let n = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return q.url().startsWith(BASE.slice(0, -1)) ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => { if (!localStorage.getItem('nova-rx-sales-v1')) localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); }, sales);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="reports"]').first().click();
  const top = () => p.locator('#novaTopSellers').innerText();
  await p.locator('#novaTopSellers').waitFor();
  let t = await top();
  assert.match(t, /الكمية/); assert.match(t, /الإيراد/);
  assert.ok(t.includes('بنادول') && t.includes('أوغمنتين') && !t.includes('قديم-أسبوع'), 'day: ' + t);
  assert.equal(await p.locator('[data-top-row="بنادول"]').getAttribute('data-qty'), '2');
  assert.equal(await p.locator('[data-top-row="بنادول"]').getAttribute('data-revenue'), '50.00');
  assert.equal(await p.locator('[data-pay-row="returns"]').count(), 0, 'zero returns hidden');
  assert.match(await p.locator('[data-pay-row="cash"]').innerText(), /50%/);
  await p.locator('[data-rep-period="week"]').click();
  t = await top(); assert.ok(t.includes('قديم-أسبوع') && !t.includes('قديم-شهر'), 'week: ' + t);
  await p.locator('[data-rep-period="month"]').click();
  t = await top(); assert.ok(t.includes('بنادول'));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no h-scroll');
  assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
  n++; await ctx.close();
}
await b.close(); console.log('ux439 passed viewports:', n);
