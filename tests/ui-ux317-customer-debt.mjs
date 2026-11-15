// UX317: customers debt KPIs + filter chips + debt-desc sort. Local only, fake ledger via localStorage 'nova.credit', non-GET blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux317-customer-debt.mjs
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.url()); return r.abort(); } const u = q.url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.NOVA_DEMO && window.NovaCredit, null, { timeout: 8000 });
  const ids = await page.evaluate(() => {
    localStorage.removeItem('nova.credit');
    const c = window.NOVA_DEMO.customers.map(x => String(x.id)), l = window.NovaCredit.createCreditLedger(localStorage, 'nova.credit'), D = 86400000;
    l.charge({ id: 's1', customerId: c[0], amount: 100, override: true, at: Date.now() - 90 * D, due: Date.now() - 60 * D }); // overdue
    l.charge({ id: 's2', customerId: c[1], amount: 250.5, override: true }); // current
    l.charge({ id: 's3', customerId: c[2], amount: 40, override: true });
    l.collect({ id: 'p3', customerId: c[2], amount: 40, method: 'cash' }); // settled
    return c;
  });
  await page.locator('[data-page="customers"]').first().click(); await page.waitForTimeout(500);
  const txt = s => page.locator(s).first().innerText();
  assert.match(await txt('#novaDebtorCount'), /^[2٢]$/);
  assert.match((await txt('#novaDebtTotal')).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.'), /350\.5|350[.,]50/);
  const first = () => page.locator('#page-customers tbody tr, [data-debt]').first();
  const debtOrder = await page.$$eval('[data-debt]', els => els.map(e => e.getAttribute('data-debt') + ':' + /سداد/.test(e.textContent)));
  assert.equal(debtOrder[0], ids[1] + ':true'); assert.equal(debtOrder[1], ids[0] + ':true');
  const count = k => page.locator(`[data-cust-count="${k}"]`).innerText();
  assert.match(await count('debtors'), /^[2٢]$/); assert.match(await count('late'), /^[1١]$/);
  await page.locator('[data-cust-filter="debtors"]').click();
  assert.equal(await page.locator('[data-debt]').count(), 2);
  await page.locator('[data-cust-filter="late"]').click();
  assert.deepEqual(await page.$$eval('[data-debt]', els => els.map(e => e.getAttribute('data-debt'))), [ids[0]]);
  await page.locator('[data-cust-filter="all"]').click();
  assert.ok(await page.locator('[data-debt]').count() >= 3);
  // AA contrast of red debt value on its background (>= 4.5)
  const rgb = await page.$eval('[data-debt]', e => { const cs = getComputedStyle(e); return [cs.color, getComputedStyle(e.closest('.nova-panel') || document.body).backgroundColor]; });
  const parse = s => s.match(/\d+/g).slice(0, 3).map(Number);
  const [fg, bg] = rgb.map(parse), a = lum(fg), b = lum(bg[0] + bg[1] + bg[2] === 0 && /rgba\(0, 0, 0, 0\)/.test(rgb[1]) ? [14, 20, 25] : bg);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, 'debt red contrast ' + rgb);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
  assert.deepEqual(blocked, []);
  console.log('  ok', vp.width + 'x' + vp.height);
  await ctx.close();
}
await browser.close();
