// UX13: reports period selector + end-of-day print. Run: node tests/ux/reports-period.mjs (needs @playwright/test + Chromium; CHROME_PATH optional)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8771, BASE = `http://127.0.0.1:${PORT}/index.html`;
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
  // an older sale (3 days ago) that must only appear in the 7-day view
  const older = await page.evaluate(() => { const s = JSON.parse(JSON.stringify(window.novaSales.list()[0])); s.id = 'old-' + s.id; s.number = s.number + '-OLD'; s.at = new Date(Date.now() - 3 * 864e5).toISOString(); return window.novaSales.add(s); });
  assert.ok(older, 'older sale added');
  const todayTotal = sale.total;

  // 1 click to reports
  await page.locator('.nova-tab[data-page="reports"]').click(); await sleep(300);
  const d1 = await page.evaluate(() => window.__novaRepData);
  assert.equal(d1.per, 'day'); assert.equal(d1.count, 1); assert.ok(Math.abs(d1.sales - todayTotal) < 0.011, 'today sales ' + d1.sales);
  assert.equal(await page.locator('[data-rep-period="day"]').getAttribute('aria-pressed'), 'true');
  assert.ok(Math.abs(d1.split.cash - todayTotal) < 0.011, 'cash split');
  // 1 click to 7 days -> totals update
  await page.locator('[data-rep-period="week"]').click(); await sleep(200);
  const d2 = await page.evaluate(() => window.__novaRepData);
  assert.equal(d2.per, 'week'); assert.equal(d2.count, 2); assert.ok(Math.abs(d2.sales - 2 * todayTotal) < 0.011, '7d sales ' + d2.sales);
  // print button + @media print rule
  assert.equal(await page.locator('#novaPrintDay').count(), 1, 'print button');
  const hasPrint = await page.evaluate(() => [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.type === CSSRule.MEDIA_RULE && /print/.test(r.conditionText || r.media.mediaText) && /novaDayReport/.test(r.cssText)); } catch { return false; } }));
  assert.ok(hasPrint, '@media print rule for end-of-day report');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  // print click builds the report (window.print stubbed)
  const html = await page.evaluate(() => { let h = ''; window.print = () => { const e = document.getElementById('novaDayReport'); h = e ? e.innerText : 'MISSING'; }; document.getElementById('novaPrintDay').click(); return h; });
  assert.ok(html.length > 20 && html !== 'MISSING', 'report content: ' + html);
  assert.deepEqual(errs, [], 'page errors');
  console.log('reports-period passed');
} catch (e) { console.error('FAIL', e); code = 1; }
finally { await browser.close(); server.kill(); process.exit(code); }
