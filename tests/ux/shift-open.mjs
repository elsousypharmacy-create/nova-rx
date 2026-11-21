// #75: open the shift with a drawer float, count the cash by notes, close; the next shift must be opened again.
// Usage: node tests/ux/shift-open.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; } res.writeHead(200, { 'content-type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const sale = { id: 'S-SHIFT-1', number: '1', at: new Date().toISOString(), customer: '', payment: 'cash', status: 'final', tenders: [{ method: 'cash', amount: 50 }], subtotal: 50, discount: 0, vat: 0, total: 50, collected: 50, received: 50, change: 0, lines: [{ name: 'Test item', barcode: '1', unit: 'box', unitFactor: 1, price: 50, qty: 1, discount: 0 }] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('nova-rx-sales-v1', JSON.stringify([s])); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); }, sale);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaLazy && window.novaLazy.load);
  await page.evaluate(() => window.novaLazy.load());
  const openReports = async () => { await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page="reports"]'); t.click(); }); await page.waitForSelector('#novaShiftOpenBox'); };
  await openReports();
  assert.match(await page.locator('#novaShiftOpenBox').innerText(), /الوردية مش مفتوحة/);
  await page.click('#novaShiftOpenBtn');
  await page.locator('[role=dialog][aria-modal=true]').last().locator('input[type=number]').fill('300');
  await page.locator('[role=dialog][aria-modal=true]').last().locator('button[type=submit]').click();
  const st = await page.evaluate(() => window.novaShiftOpen.state());
  assert.ok(st.openedAt > 0 && st.float === 300, 'shift opened with 300: ' + JSON.stringify(st));
  assert.equal(await page.locator('#novaShiftFloat').inputValue(), '300', 'float field filled');
  assert.match(await page.locator('#novaShiftOpenBox').innerText(), /الوردية مفتوحة من/);
  assert.equal(await page.locator('#novaShiftExpected').getAttribute('data-amount'), '350.00', 'expected = 300 float + 50 cash sale');
  // count by notes: 200x1 + 50x3 + 0.25x3 = 350.75
  await page.click('#novaShiftDenomBtn');
  await page.locator('[data-denom="200"]').fill('1'); await page.locator('[data-denom="50"]').fill('3'); await page.locator('[data-denom="0.25"]').fill('3');
  assert.match(await page.locator('#novaShiftDenomTotal').innerText(), /350\.75/);
  await page.locator('[role=dialog][aria-modal=true]').last().locator('.btn-primary').click();
  assert.equal(await page.locator('#novaShiftCount').inputValue(), '350.75', 'count field filled from notes');
  assert.equal(await page.evaluate(() => window.novaShiftOpen.denomTotal({ '0.5': 3, '0.25': 1 })), 1.75);
  await page.click('#novaShiftDo');
  await page.waitForSelector('#novaShiftSummary');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('nova-rx-shift-opens-v1') || '[]')).length === 1);
  const after = await page.evaluate(() => ({ opens: JSON.parse(localStorage.getItem('nova-rx-shift-opens-v1')), st: JSON.parse(localStorage.getItem('nova-rx-shift-v1')), closing: JSON.parse(localStorage.getItem('nova-rx-shift-closings-v1')).slice(-1)[0] }));
  assert.equal(after.closing.counted, 350.75); assert.equal(after.closing.float, 300);
  assert.ok(after.opens[0].openedAt > 0 && after.opens[0].denoms['200'] === 1 && after.opens[0].closingId === after.closing.id, 'open info kept apart from the closing');
  assert.ok(!after.st.openedAt && !after.st.denoms && after.st.counted === 350.75, 'opening info reset (next shift must be opened), counted kept: ' + JSON.stringify(after.st));
  assert.match(await page.locator('#novaShiftOpenBox').innerText(), /الوردية مش مفتوحة/);
  assert.deepEqual(errors, [], 'no page errors');
  console.log('shift-open PASS');
} finally { await browser.close(); server.close(); }
