// UX321: pay-debt + statement dialogs a11y (labels, aria-invalid inline error, focus trap/restore, scroll lock, no title overlap, preview).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux321-debt-dialogs.mjs
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.url()); return r.abort(); } const u = q.url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.NOVA_DEMO && window.NovaCredit, null, { timeout: 8000 });
  const id = await page.evaluate(() => { localStorage.removeItem('nova.credit'); const c = String(window.NOVA_DEMO.customers[0].id); window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: 's1', customerId: c, amount: 100, override: true }); return c; });
  await page.locator('[data-page="customers"]').first().click(); await page.waitForTimeout(500);
  const num = t => Number(t.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').match(/\d+(?:\.\d+)?/g).slice(-1)[0]);
  // --- pay dialog
  const payBtn = page.locator(`[data-pay-debt="${id}"]`); await payBtn.focus(); await payBtn.click();
  const dlg = page.locator('#novaPayDebt'); await dlg.waitFor();
  const lab = await dlg.getAttribute('aria-labelledby'); assert.ok(lab && (await page.locator('#' + lab).innerText()).includes('سداد'));
  assert.equal(await page.locator('label[for="novaPayAmt"]').count(), 1); assert.equal(await page.locator('label[for="novaPayMethod"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'novaPayAmt');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.fill('#novaPayAmt', '30');
  const pt = await page.locator('#novaPayPreview').innerText(); assert.equal(num(pt), 70, 'preview: ' + pt);
  await page.fill('#novaPayAmt', '500');
  assert.equal(await page.locator('#novaPayAmt').getAttribute('aria-invalid'), 'true');
  assert.match(await page.locator('#novaPayErr').innerText(), /أكبر من المديونية/);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#novaPayDebt').count(), 1, 'dialog stays open on over-payment');
  // trap: tab many times stays inside
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('#novaPayDebt')), 'focus trapped'); }
  await page.keyboard.press('Shift+Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('#novaPayDebt')));
  const ov = await page.evaluate(() => { const x = document.querySelector('#novaPayDebt .nova-dlg-x').getBoundingClientRect(), h = document.querySelector('#novaPayTitle'); const r = document.createRange(); r.selectNodeContents(h); const t = r.getBoundingClientRect(); return !(x.right <= t.left || x.left >= t.right || x.bottom <= t.top || x.top >= t.bottom); });
  assert.equal(ov, false, 'pay: close button overlaps title');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#novaPayDebt').count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-pay-debt')), id, 'focus restored');
  // --- statement dialog
  const st = page.locator(`[data-stmt="${id}"]`); await st.focus(); await st.click();
  const sd = page.locator('#novaStatement'); await sd.waitFor();
  const sl = await sd.getAttribute('aria-labelledby'); assert.ok(sl && (await page.locator('#' + sl).innerText()).includes('كشف'));
  const ov2 = await page.evaluate(() => { const x = document.querySelector('#novaStatement .nova-dlg-x').getBoundingClientRect(), h = document.querySelector('#novaStmtTitle'); const r = document.createRange(); r.selectNodeContents(h); const t = r.getBoundingClientRect(); return !(x.right <= t.left || x.left >= t.right || x.bottom <= t.top || x.top >= t.bottom); });
  assert.equal(ov2, false, 'statement: close button overlaps title');
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('#novaStatement')), 'stmt focus trapped'); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-stmt')), id, 'stmt focus restored');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(blocked, []);
  console.log('  ok', vp.width + 'x' + vp.height);
  await ctx.close();
}
await browser.close();
