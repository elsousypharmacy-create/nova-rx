// SALE-02: VAT defaults to 14% on a fake sale + invoice (screen totals, saved invoice, receipt); production-like host hides
// demo customers and dev text. Fake/local data only: localStorage cleared, stock snapshot fulfilled locally, every non-GET
// and every non-local request aborted. Needs a static server on the repo root, e.g. `python3 -m http.server 8765`.
// Run: node tests/ui-sale02-vat.mjs   (NOVA_URL to override, CHROME_PATH for a system Chrome)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const port = new URL(BASE).port || '80';
const PROD_HOST = 'nova-sale02-preview.test'; // not localhost -> demo mode off (production-like)
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let passed = 0, blocked = 0;
const t = async (name, fn) => {
  try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 4).join('\n')); process.exit(1); }
  passed++; console.log('  ok', name);
};
const vat14 = (total) => Math.round((total * 14 / 114 + Number.EPSILON) * 100) / 100;
const money = (s) => { const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', `--host-resolver-rules=MAP ${PROD_HOST} 127.0.0.1`],
});

async function open(origin) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', (r) => {
    const req = r.request(), u = req.url();
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { blocked++; return r.abort(); }
    if (u.startsWith(origin) || u.startsWith('data:')) return r.continue();
    blocked++; return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { window.NOVA_STOCK_PROBE = true; });
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay && window.novaSales, null, { timeout: 10000 });
  return { ctx, page, errors };
}

try {
  const local = new URL(BASE).origin;
  const { ctx, page, errors } = await open(local);

  await t('novaVat default is 14 with no stored setting', async () => {
    assert.deepEqual(await page.evaluate(() => [window.novaVat.DEFAULT, window.novaVat.get(), localStorage.getItem('nova-rx-vat-rate')]), [14, 14, null]);
  });

  await t('fake sale: screen VAT = 14/114 of the net total, label says 14%', async () => {
    await page.locator('#mainSearchInput').fill('جافيسكون');
    await page.locator('#mainSearchInput').press('Enter');
    const codes = await page.evaluate(() => window.NOVA_DEMO.products.filter((p) => p && p.barcode && p.price > 0 && !/جافيسكون|gaviscon/i.test(p.name)).slice(0, 1).map((p) => p.barcode));
    await page.locator('#mainSearchInput').fill(codes[0]);
    await page.locator('#mainSearchInput').press('Enter');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 2);
    const total = money(await page.locator('#displayGrandTotal').textContent());
    assert.ok(total > 0);
    assert.equal(money(await page.locator('#displayVat').textContent()), vat14(total));
    assert.match(await page.locator('#displayVatLabel').textContent(), /14%/);
    assert.doesNotMatch(await page.locator('#displayVatLabel').textContent(), /15%/);
  });

  await t('checkout: saved invoice has vatRate 14 and vat = 14/114 of total; receipt shows 14%', async () => {
    await page.keyboard.press('F9');
    await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 3000 });
    await page.locator('.quick-cash-btn[data-val="exact"]').click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 3000 });
    const s = await page.evaluate(() => window.novaSales.list()[0]);
    assert.equal(s.status, 'final');
    assert.equal(s.vatRate, 14);
    assert.equal(s.vat, vat14(s.total));
    const slip = await page.locator('#receiptSlipContent').innerText();
    assert.match(slip, /ضريبة القيمة المضافة \(14%\)/);
    assert.doesNotMatch(slip, /\(15%\)/);
  });

  await t('owner-changed rate still applies (14 is only the default)', async () => {
    await page.evaluate(() => { window.novaVat.set(5); });
    assert.equal(await page.evaluate(() => window.novaVat.calc(105)), 5);
    await page.evaluate(() => { localStorage.removeItem('nova-rx-vat-rate'); });
  });

  await t('localhost keeps demo customers (dev)', async () => {
    assert.equal(await page.evaluate(() => window.NOVA_DEMO_MODE), true);
    assert.ok(await page.evaluate(() => window.NOVA_DEMO.customers.length) > 0);
  });
  await t('no page errors (dev)', () => assert.deepEqual(errors, [], JSON.stringify(errors)));
  await ctx.close();

  const prod = await open(`http://${PROD_HOST}:${port}`);
  await t('production-like host: demo customers hidden, no dev badge, Arabic discount hint', async () => {
    assert.equal(await prod.page.evaluate(() => window.NOVA_DEMO_MODE), false);
    assert.equal(await prod.page.evaluate(() => window.NOVA_DEMO.customers.length), 0);
    const body = await prod.page.locator('body').innerText();
    assert.ok(!body.includes('TASK-001'));
    assert.ok(!body.includes('No negative total floor'));
    assert.equal(await prod.page.evaluate(() => document.documentElement.dir), 'rtl');
  });
  await t('production-like host: reports page has no demo-data block', async () => {
    await prod.page.evaluate(() => { location.hash = 'reports'; });
    await prod.page.waitForFunction(() => document.querySelector('#novaPageView') && /التقارير|مبيعات/.test(document.querySelector('#novaPageView').innerText), null, { timeout: 5000 }).catch(() => {});
    const tab = prod.page.locator('.nova-tab[data-page="reports"]');
    if (await tab.count()) await tab.first().click();
    await prod.page.waitForTimeout(300);
    assert.equal(await prod.page.locator('#novaDemoData').count(), 0);
    assert.doesNotMatch(await prod.page.locator('#novaPageView').innerText(), /بيانات تجريبية|مبيعات تجريبية/);
  });
  await t('no page errors (production-like)', () => assert.deepEqual(prod.errors, []));
  await prod.ctx.close();

  console.log(`SALE-02 VAT OK (${passed} checks, ${blocked} non-local/non-GET requests blocked)`);
} finally {
  await browser.close();
}
