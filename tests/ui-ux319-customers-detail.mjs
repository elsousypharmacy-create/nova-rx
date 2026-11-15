// UX319: customers rows focusable + Enter opens detail (focus trap/restore); sortable headers with aria-sort.
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
    d.customers.push({ id: 'U1', name: 'ب عميل', phone: '0500000001', tier: 'silver', visits: 5, points: 10, pastInvoices: [] },
      { id: 'U2', name: 'أ عميل', phone: '0500000002', tier: 'gold', visits: 2, points: 30, pastInvoices: [] },
      { id: 'U3', name: 'ج عميل', phone: '0500000003', tier: 'silver', visits: 9, points: 20, pastInvoices: [] });
    const l = window.NovaCredit.createCreditLedger(localStorage, 'nova.credit');
    l.charge && l.charge({ id: 'c1', customerId: 'U1', amount: 50 });
    document.querySelector('[data-page="customers"]').click();
  });
  await page.waitForSelector('tr[data-cust-row]');
  assert.equal(await page.locator('tr[data-cust-row]').first().getAttribute('tabindex'), '0');
  // sorting (headers are hidden in the mobile card layout, like products)
  if (vp.width > 780) {
  const names = () => page.locator('tr[data-cust-row] td:first-child').allInnerTexts();
  const th = k => page.locator('th:has([data-sort="' + k + '"])');
  assert.equal(await th('visits').getAttribute('aria-sort'), 'none');
  await page.locator('[data-sort="visits"]').click();
  assert.equal(await th('visits').getAttribute('aria-sort'), 'ascending');
  assert.deepEqual((await names()).map(x => x.trim()), ['أ عميل', 'ب عميل', 'ج عميل']);
  await page.locator('[data-sort="visits"]').click();
  assert.equal(await th('visits').getAttribute('aria-sort'), 'descending');
  assert.deepEqual((await names()).map(x => x.trim()), ['ج عميل', 'ب عميل', 'أ عميل']);
  assert.equal(await th('points').getAttribute('aria-sort'), 'none');
  await page.locator('[data-sort="name"]').click();
  assert.equal(await th('name').getAttribute('aria-sort'), 'ascending');
  assert.equal((await names())[0].trim(), 'أ عميل');
  assert.ok(await page.locator('[data-sort="debt"]').count() === 1 && await page.locator('[data-sort="points"]').count() === 1);
  }
  // keyboard flow
  await page.locator('#novaFilter').focus();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-cust-row')); }
  assert.ok(reached, 'Tab reaches row');
  const rowId = await page.evaluate(() => document.activeElement.getAttribute('data-cust-row'));
  await page.keyboard.press('Enter');
  const dlg = page.locator('#novaCustDetail[role="dialog"]');
  await dlg.waitFor();
  const txt = await dlg.innerText();
  for (const w of ['الهاتف', 'المستوى', 'الزيارات', 'النقاط', 'المديونية', 'واتساب']) assert.ok(txt.includes(w), w);
  assert.ok(await dlg.evaluate(d => d.contains(document.activeElement)), 'focus inside');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.ok(await dlg.evaluate(d => d.contains(document.activeElement)), 'trap'); }
  await page.keyboard.press('Shift+Tab');
  assert.ok(await dlg.evaluate(d => d.contains(document.activeElement)), 'trap shift');
  await page.keyboard.press('Escape');
  assert.equal(await dlg.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-cust-row')), rowId, 'focus restored');
  // Space opens too, click opens
  await page.keyboard.press(' ');
  await dlg.waitFor(); await page.keyboard.press('Escape');
  await page.locator('tr[data-cust-row]').nth(1).locator('td').first().click();
  await dlg.waitFor(); await page.locator('[data-dlg-close]').click();
  assert.equal(await dlg.count(), 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#novaDlgRoot, body')).direction === 'rtl' || document.documentElement.dir === 'rtl'), true);
  assert.deepEqual(writes, []); assert.deepEqual(errs, []);
  n++; console.log('  ok', vp.width + 'x' + vp.height);
  await ctx.close();
}
await browser.close(); console.log('UX319 passed', n);
