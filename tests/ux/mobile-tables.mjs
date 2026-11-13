// UX24: mobile invoices/customers tables as cards; actions reachable. Local static server, all non-GET aborted.
// Usage: node tests/ux/mobile-tables.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAttachLoyalty');

  // Setup (not counted): credit sale to the first demo customer.
  await page.locator('#btnAttachLoyalty').click();
  await page.locator('#mainSearchInput').fill('طارق');
  await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.waitForTimeout(200);
  await page.locator('#mainSearchInput').fill('');
  await page.locator('#mainSearchInput').focus();
  await page.keyboard.press('Enter'); // customer step done -> product mode
  await page.locator('#mainSearchInput').fill('بانادول');
  await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.waitForSelector('#btnCheckout:not([disabled])');
  await page.locator('#btnCheckout').click();
  await page.locator('.pay-method-btn[data-method="credit"]').click();
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => { try { return window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').customers().length > 0; } catch { return false; } });
  await page.locator('#btnReceiptNewSale').click(); // setup: close receipt
  const debt = await page.evaluate(() => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').customers()[0].balance);
  assert.ok(debt > 0, 'credit sale recorded a debt');

  // Desktop 1366: real table layout unchanged.
  const tabClick = async p => { await page.locator(`.nova-tab[data-page="${p}"]`).first().click(); };
  await tabClick('customers');
  await page.waitForSelector('td[data-debt]');
  assert.equal(await page.locator('.nova-data-table thead').first().evaluate(e => getComputedStyle(e).display), 'table-header-group', 'desktop thead shown');
  assert.equal(await page.locator('.nova-data-table').first().evaluate(e => getComputedStyle(e).display), 'table', 'desktop is a table');
  await tabClick('invoices');
  await page.waitForSelector('[data-return]');
  assert.equal(await page.locator('.nova-data-table thead').first().evaluate(e => getComputedStyle(e).display), 'table-header-group');

  // Mobile 390x844.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const noHScroll = async what => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll: ${what}`);
  const box44 = async (loc, what) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    assert.ok(b && b.width >= 44 && b.height >= 44, `${what} >=44x44 (${b && b.width}x${b && b.height})`);
    const inView = await loc.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(inView, `${what} in viewport after scroll`);
  };
  await noHScroll('invoices');
  await box44(page.locator('[data-return]').first(), 'مرتجع');
  await box44(page.locator('[data-reprint]').first(), 'إعادة طباعة');
  await noHScroll('invoices after scroll');
  const labels = await page.locator('.nova-cards td[data-label]').first().evaluate(e => getComputedStyle(e, '::before').content);
  assert.match(labels, /\S/, 'label pseudo content');

  let clicks = 0;
  const click = async sel => { clicks++; await page.locator(sel).first().click(); };
  await click('.nova-tab[data-page="customers"]');  // 1
  await page.waitForSelector('[data-pay-debt]');
  await noHScroll('customers');
  await box44(page.locator('[data-pay-debt]').first(), 'سداد');
  await click('[data-pay-debt]');                    // 2
  await click('#novaPayOk');                         // 3
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });
  assert.ok(clicks <= 3, `clicks ${clicks} <= 3`);
  await noHScroll('customers after pay');
  assert.deepEqual(errors, []);
  console.log(`mobile-tables passed (clicks=${clicks})`);
} finally { await browser.close(); server.close(); }
