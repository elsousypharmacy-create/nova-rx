// UX320: "إضافة عميل" opens an inline dialog on the customers screen (no navigation to sale / F3).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u); return r.abort(); }
    if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.setItem('nova.activePage', 'customers'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.NOVA_DEMO);
  await page.evaluate(() => {
    const d = window.NOVA_DEMO; d.customers.length = 0;
    d.customers.push({ id: 'U1', name: 'عميل قائم', phone: '0500000001', tier: 'silver', visits: 5, points: 10, pastInvoices: [] });
    document.querySelector('[data-page="customers"]').click();
  });
  await page.waitForSelector('tr[data-cust-row]');
  const before = await page.locator('tr[data-cust-row]').count();
  await page.locator('#novaCustAdd').first().click();
  const dlg = page.locator('#novaCustAddDlg[role="dialog"]');
  await dlg.waitFor();
  assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'customers', 'still on customers');
  assert.ok(await dlg.evaluate(d => d.contains(document.activeElement)), 'focus inside');
  for (const sel of ['#novaCaName', '#novaCaPhone', '#novaCaOk', '#novaCaCancel']) {
    const b = await page.locator(sel).boundingBox(); assert.ok(b.height >= 43.5, sel + ' 44px');
  }
  // empty submit -> errors
  await page.locator('#novaCaOk').click();
  assert.ok((await page.locator('#novaCaNameErr').innerText()).trim());
  assert.equal(await page.locator('#novaCaPhone').getAttribute('aria-invalid'), 'true');
  // invalid phone
  await page.fill('#novaCaName', 'سارة');
  await page.fill('#novaCaPhone', '123');
  await page.locator('#novaCaOk').click();
  assert.ok((await page.locator('#novaCaPhoneErr').innerText()).includes('9'));
  // duplicate phone (Arabic-Indic digits of existing 0500000001)
  await page.fill('#novaCaPhone', '٠٥٠٠٠٠٠٠٠١');
  assert.ok((await page.locator('#novaCaPhoneErr').innerText()).includes('عميل قائم'), 'dup warning');
  await page.locator('#novaCaOk').click();
  assert.equal(await page.locator('tr[data-cust-row]').count(), before);
  // valid with Arabic-Indic digits
  await page.fill('#novaCaPhone', '٠٥٠١٢٣٤٥٦٧');
  await page.locator('#novaCaOk').click();
  await dlg.waitFor({ state: 'detached' });
  assert.equal(await page.locator('tr[data-cust-row]').count(), before + 1);
  const rows = await page.locator('tr[data-cust-row]').allInnerTexts();
  assert.ok(rows.some(t => t.includes('سارة') && t.includes('0501234567')), 'new row');
  assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'customers');
  // Escape closes
  await page.locator('#novaCustAdd').first().click(); await dlg.waitFor();
  await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
  assert.deepEqual(writes, []); assert.deepEqual(errs, []);
  await ctx.close();
  console.log('PASS', vp.width + 'x' + vp.height);
}
await browser.close();
