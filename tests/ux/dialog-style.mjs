// UX27: dynamic dialogs (debt payment, return) use Black Edition btn tokens, have ✕, Esc and backdrop close.
// Usage: node tests/ux/dialog-style.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ux = createRequire(import.meta.url)('../../ux-tokens.js');
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
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const lum = c => { const v = c.match(/\d+/g).slice(0, 3).map(n => { n /= 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const GREY = 'rgb(107, 107, 107)';
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  const bg = sel => page.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
  const col = sel => page.locator(sel).first().evaluate(e => getComputedStyle(e).color);

  // Reference primary colour from a real .btn-primary.
  const primary = await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-primary'; document.body.appendChild(b); const c = getComputedStyle(b).backgroundColor; b.remove(); return c; });

  // Seed data: a debt for the first demo customer and a sale to return.
  await page.evaluate(() => {
    const id = String(window.NOVA_DEMO.customers[0].id);
    window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: 'c1', customerId: id, amount: 50, ref: 'x' });
    window.novaSales.add({ id: 'f1', number: 'S-f1', at: new Date().toISOString(), customer: '', payment: 'cash',
      lines: [{ name: 'A', barcode: 'A1', price: 100, qty: 2, discount: 0, unitFactor: 1, lots: [{ lot: 'L1', expiry: '2027-01-01', qty: 2, cost: 10 }] }],
      subtotal: 200, discount: 0, vat: 0, total: 200, received: 200, change: 0 });
  });

  // Debt dialog
  await page.locator('.nova-tab[data-page="customers"]').click();
  await page.locator('[data-pay-debt]').first().click();
  await page.waitForSelector('#novaPayAmt');
  const payBg = await bg('#novaPayOk');
  assert.notEqual(payBg, GREY, 'pay confirm not grey');
  assert.equal(payBg, primary, 'pay confirm = primary colour');
  assert.ok(ratio(payBg, await col('#novaPayOk')) >= 4.5, 'pay contrast');
  assert.equal(await page.locator('#novaPayDebt [data-dlg-close]').count(), 1, 'pay ✕');
  await page.locator('#novaPayOk').focus();
  assert.notEqual(await page.locator('#novaPayOk').evaluate(e => getComputedStyle(e).outlineStyle), 'none', 'pay focus ring');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });
  await page.locator('[data-pay-debt]').first().click();
  await page.locator('#novaPayDebt [data-dlg-close]').click();
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });
  await page.locator('[data-pay-debt]').first().click();
  await page.mouse.click(5, 5);
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });

  // Return dialog + secondary buttons
  await page.locator('.nova-tab[data-page="invoices"]').click();
  const hasBtn = async id => (await page.locator('#' + id).getAttribute('class')).split(/\s+/).includes('btn');
  await page.locator('[data-return="f1"]').click();
  await page.waitForSelector('#novaRetOk');
  const retBg = await bg('#novaRetOk');
  assert.notEqual(retBg, GREY, 'return confirm not grey');
  assert.equal(retBg, primary, 'return confirm = primary colour');
  assert.ok(ratio(retBg, await col('#novaRetOk')) >= 4.5, 'return contrast');
  assert.ok(await hasBtn('novaRetAll'), 'retAll btn');
  assert.equal(await page.locator('.nova-return-overlay [data-dlg-close]').count(), 1, 'return ✕');
  const chip = page.locator('[data-ret-chip]').first();
  assert.equal(await chip.evaluate(e => getComputedStyle(e).borderTopWidth), '1px', 'chip outlined');
  assert.equal(await chip.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'chip transparent');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#novaRetOk', { state: 'detached' });
  await page.locator('[data-return="f1"]').click();
  await page.locator('.nova-return-overlay [data-dlg-close]').click();
  await page.waitForSelector('#novaRetOk', { state: 'detached' });
  await page.locator('[data-return="f1"]').click();
  await page.mouse.click(5, 5);
  await page.waitForSelector('#novaRetOk', { state: 'detached' });

  // Reports + backup buttons share btn classes
  await page.locator('.nova-tab[data-page="reports"]').click();
  assert.ok(await hasBtn('novaPrintDay'), 'print btn');
  for (const id of ['novaSalesExport', 'novaSalesImport']) {
    for (const pg of ['settings', 'invoices', 'reports', 'products', 'customers']) {
      await page.locator(`.nova-tab[data-page="${pg}"]`).click();
      if (await page.locator('#' + id).count()) break;
    }
    assert.ok(await hasBtn(id), id + ' btn');
  }

  assert.ok(ux.audit('dark').length === 0 && ux.audit('light').length === 0, 'tokens AA');
  assert.deepEqual(errors, []);
  console.log('dialog-style passed');
} finally { await browser.close(); server.close(); }
