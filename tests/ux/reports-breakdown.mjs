// UX30: payment-method breakdown + collapsed demo data. Run: node tests/ux/reports-breakdown.mjs (needs @playwright/test + Chromium; CHROME_PATH optional)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8772, BASE = `http://127.0.0.1:${PORT}/index.html`;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let code = 0;
try {
  await sleep(1200);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaSales, null, { timeout: 8000 });

  // complete a local cash sale
  const i = page.locator('#mainSearchInput'); await i.fill('جافيسكون'); await sleep(300);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.locator('#btnCheckout').click(); await sleep(200);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip'); if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
  await sleep(200);
  await page.locator('.pay-method-btn[data-method=cash]').click();
  const total = Number(await page.evaluate(() => (document.getElementById('modalAmountDue').textContent.match(/[0-9]+(\.[0-9]+)?/) || [0])[0]));
  await page.locator('#inputCashReceived').fill(String(total + 10));
  await page.locator('#btnConfirmPayment').click(); await sleep(400);
  await page.locator('#btnCloseReceipt').click();
  const sale = (await page.evaluate(() => window.novaSales.list()))[0];
  assert.ok(sale && sale.total > 0, 'sale saved');
  // card + credit sales (clones of the cash sale with their own tender)
  await page.evaluate(() => { for (const m of ['card', 'credit']) { const s = JSON.parse(JSON.stringify(window.novaSales.list()[0])); s.id = m + '-' + s.id; s.number = s.number + '-' + m; s.payment = m; s.tenders = [{ method: m, amount: s.total }]; s.at = new Date().toISOString(); window.novaSales.add(s); } });
  let clicks = 0;
  await page.locator('.nova-tab[data-page="reports"]').click(); clicks++; await sleep(300);
  await page.locator('[data-rep-period="week"]').click(); clicks++; await sleep(200);
  assert.ok(clicks <= 2, 'tab+period clicks ' + clicks);
  for (const per of ['day', 'week', 'month']) {
    if (per !== 'week') { await page.locator(`[data-rep-period="${per}"]`).click(); await sleep(200); }
    const v = await page.evaluate(() => { const g = k => Number(document.querySelector(`#novaPayBreakdown [data-pay-row="${k}"]`).dataset.amount); const d = window.__novaRepData; return { cash: g('cash'), card: g('card'), credit: g('credit'), ret: g('returns'), drawer: g('drawer'), net: d.net, count: d.count }; });
    assert.equal(v.count, 3, per + ' count');
    assert.ok(v.cash > 0 && v.card > 0 && v.credit > 0, per + ' each method has value');
    assert.ok(Math.abs(v.cash + v.card + v.credit + v.ret - v.net) < 0.011, per + ' breakdown sums to net');
    assert.ok(Math.abs(v.drawer - v.cash) < 0.011, 'drawer = cash without cash returns');
  }
  // demo block collapsed by default: no visible demo numbers
  const demo = await page.evaluate(() => { const d = document.getElementById('novaDemoData'); const vis = [...d.querySelectorAll('.nova-kpi, .nova-kpis *')].filter(e => e.checkVisibility() && /[0-9]/.test(e.textContent) && e.children.length === 0); return { open: d.open, label: d.querySelector('summary').textContent, visible: vis.length }; });
  assert.equal(demo.open, false); assert.equal(demo.visible, 0, 'visible demo numbers'); assert.match(demo.label, /بيانات تجريبية \(للعرض فقط\)/);
  // print view
  const txt = await page.evaluate(() => { let h = ''; window.print = () => { const e = document.getElementById('novaDayReport'); h = e ? e.innerText : 'MISSING'; }; document.getElementById('novaPrintDay').click(); return h; });
  for (const w of ['نقدي', 'بطاقة', 'آجل', 'مرتجعات', 'النقدي المتوقع في الدرج']) assert.ok(txt.includes(w), 'print has ' + w + ': ' + txt);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.deepEqual(errs, [], 'page errors');
  console.log('reports-breakdown passed');
} catch (e) { console.error('FAIL', e); code = 1; }
finally { await browser.close(); server.kill(); process.exit(code); }
