// UX11: customer debt column + one-dialog «سداد». Local static server, all non-GET aborted.
// Usage: node tests/ux/customer-debt-payment.mjs
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAttachLoyalty');

  // Setup (not counted): one credit sale of 38.50 for the first demo customer.
  await page.evaluate(() => { const id = String(window.NOVA_DEMO.customers[0].id); window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: 'ux68-sale', customerId: id, amount: 38.5 }); });

  let clicks = 0;
  const click = async sel => { clicks++; await page.locator(sel).first().click(); };
  await click('.nova-tab[data-page="customers"]');            // 1
  await click('[data-stmt]');                                  // 2
  await page.waitForSelector('#novaStatement');
  assert.ok(clicks <= 2, 'statement within 2 clicks');
  assert.equal(await page.locator('#novaStatement').getAttribute('dir'), 'rtl');
  await page.locator('#novaStatement [data-dlg-close]').click();
  await page.locator('[data-pay-debt]').first().click();
  const full = await page.locator('#novaPayAmt').inputValue();
  assert.equal(Number(full), 38.5, 'full balance 38.50');
  await page.locator('[data-pay-chip="half"]').click();
  assert.equal(Number(await page.locator('#novaPayAmt').inputValue()), 19.25, 'half chip');
  await page.locator('[data-pay-chip="all"]').click();
  assert.equal(Number(await page.locator('#novaPayAmt').inputValue()), 38.5, 'all chip');
  await page.locator('#novaPayAmt').fill('10');
  await page.locator('#novaPayOk').click();
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });
  await page.locator('[data-stmt]').first().click();
  await page.waitForSelector('#novaStatement');
  assert.equal(await page.locator('#novaStatement tbody tr').count(), 2, '2 rows');
  assert.match(await page.locator('#novaStatement [data-stmt-balance]').innerText(), /28\.50/, 'balance 28.50');
  await page.locator('#novaStatement [data-dlg-close]').click();
  await page.locator('[data-pay-debt]').first().click();
  await page.locator('[data-pay-chip="half"]').click();
  assert.equal(Number(await page.locator('#novaPayAmt').inputValue()), 14.25, 'half of 28.50');
  assert.deepEqual(errors, []);
  console.log('customer-statement passed');
} finally { await browser.close(); server.close(); }
