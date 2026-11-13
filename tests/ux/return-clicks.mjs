// UX23: return dialog names the real refund method; credit returns lower the customer debt; return-all <= 5 clicks, 0 typed chars.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaSales && window.NovaCredit, null, { timeout: 8000 });
  const custId = await page.evaluate(() => {
    const c = (window.NOVA_DEMO.customers || [])[0];
    const mk = (id, payment, extra) => ({ id, number: 'S-' + id, at: new Date().toISOString(), customer: c.name, customerId: c.id, payment,
      lines: [{ name: 'A', barcode: 'A' + id, price: 100, qty: 2, discount: 0, unitFactor: 1, lots: [{ lot: 'L', expiry: '2027-01-01', qty: 2, cost: 10 }] }],
      subtotal: 200, discount: 0, vat: 0, total: 200, received: 200, change: 0, ...extra });
    window.novaSales.add(mk('c1', 'cash')); window.novaSales.add(mk('k1', 'card'));
    window.novaSales.add(mk('r1', 'credit', { credit: 200, collected: 0 }));
    window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: 'r1', customerId: String(c.id), amount: 200 });
    return String(c.id);
  });
  const debt = () => page.evaluate(id => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').balance(id), custId);
  assert.equal(await debt(), 200);
  const open = async id => { await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator(`[data-return="${id}"]`).click(); return page.locator('.nova-return-overlay p').first().innerText(); };
  const closeDlg = () => page.locator('#novaRetCancel').click();
  assert.match(await open('c1'), /نقدي/); await closeDlg();
  const card = await open('k1'); assert.match(card, /بطاقة/); assert.doesNotMatch(card, /نقدي/); await closeDlg();
  const cr = await open('r1'); assert.match(cr, /آجل/); assert.match(cr, /يُخصم من مديونية العميل/); assert.doesNotMatch(cr, /بطاقة/); await closeDlg();

  let clicks = 0, typed = 0;
  const click = async loc => { clicks++; await loc.click(); };
  await click(page.locator('.nova-tab[data-page=invoices]'));
  await click(page.locator('[data-return="r1"]'));
  await click(page.locator('#novaRetAll'));
  await click(page.locator('[data-ret-chip]').first());
  await click(page.locator('#novaRetOk'));
  await page.locator('#novaRetOk').waitFor({ state: 'detached' });
  assert.ok(clicks <= 5 && typed === 0, `clicks=${clicks} typed=${typed}`);
  assert.equal(await debt(), 0, 'credit return lowers the debt');
  await page.locator('.nova-tab[data-page=customers]').click();
  assert.equal(await page.locator('td[data-debt] [data-pay-debt]').count(), 0, 'debt column shows no open debt');
  assert.deepEqual(errors, []);
  console.log(`UX23 return-clicks OK clicks=${clicks} typed=${typed}`);
} finally { await browser.close(); }
