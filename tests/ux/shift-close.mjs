// UX61: shift close (opening float, counted cash, difference). Run: node tests/ux/shift-close.mjs (needs @playwright/test + Chromium; CHROME_PATH optional)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8781, BASE = `http://127.0.0.1:${PORT}/index.html`;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let code = 0;
try {
  await sleep(1200);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/emergency\/stock\.json/.test(m.location().url || '')) errs.push(m.text() + ' @ ' + (m.location().url || '')); });
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
  // 2nd cash sale (clone) + 1 return of it
  await page.evaluate(() => { const s = JSON.parse(JSON.stringify(window.novaSales.list()[0])); s.id = 'c2-' + s.id; s.number = s.number + '-2'; s.payment = 'cash'; s.tenders = [{ method: 'cash', amount: s.total }]; s.at = new Date().toISOString(); window.novaSales.add(s); });
  const r = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id.startsWith('c2-')); return window.novaSales.addReturn(s, { 0: 1 }, 'test'); });
  assert.ok(r.ok, 'return saved ' + JSON.stringify(r));
  let clicks = 0;
  await page.locator('.nova-tab[data-page="reports"]').click(); clicks++; await sleep(300);
  assert.ok(clicks <= 2, 'clicks ' + clicks);
  assert.ok(await page.locator('#novaShiftClose').isVisible(), 'panel visible');
  await page.locator('#novaShiftFloat').fill('100'); await page.locator('#novaShiftFloat').dispatchEvent('change'); await sleep(300);
  const d = await page.evaluate(() => window.__novaRepData);
  const exp = 100 + d.split.cash - d.cashReturns + d.cashDebt;
  assert.equal(d.split.cash > 0, true); assert.ok(d.cashReturns > 0, 'has cash return');
  assert.ok(Math.abs(Number(await page.locator('#novaShiftExpected').getAttribute('data-amount')) - exp) < 0.011, 'expected amount');
  await page.locator('#novaShiftCount').fill(exp.toFixed(2)); await sleep(100);
  assert.equal(await page.locator('#novaShiftDiff').getAttribute('data-diff'), '0.00');
  await page.locator('#novaShiftCount').fill((exp - 5).toFixed(2)); await sleep(100);
  assert.equal(await page.locator('#novaShiftDiff').getAttribute('data-diff'), '-5.00');
  const col = await page.locator('#novaShiftDiff').evaluate(e => getComputedStyle(e).color);
  assert.equal(col, 'rgb(255, 93, 93)', 'red'); assert.match(await page.locator('#novaShiftDiff').textContent(), /−5\.00/);
  const txt = await page.evaluate(() => { let h = ''; window.print = () => { const e = document.getElementById('novaDayReport'); h = e ? e.innerText : 'MISSING'; }; document.getElementById('novaShiftPrint').click(); return h; });
  assert.ok(txt.includes('الفرق') && txt.includes('النقدي المعدود'), 'print has shift rows: ' + txt);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.novaSales, null, { timeout: 8000 });
  await page.locator('.nova-tab[data-page="reports"]').click(); await sleep(300);
  assert.equal(await page.locator('#novaShiftFloat').inputValue(), '100', 'float kept after reload');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.deepEqual(errs, [], 'errors');
  console.log('shift-close passed');
} catch (e) { console.error('FAIL', e); code = 1; }
finally { await browser.close(); server.kill(); process.exit(code); }
