// UX52: hidden transfers screen behind localStorage['nova.flags.transfers']==='1'. Local static server, non-GET aborted.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-EG' });
const bad = [];
await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if (m !== 'GET' && m !== 'HEAD') bad.push(m + ' ' + u); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const open = async () => { await page.goto(BASE + '/index.html', { waitUntil: 'load' }); await page.waitForSelector('#mainSearchInput', { state: 'attached' }); await page.waitForFunction(() => window.novaTransfers && window.novaStock); await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click()); await page.waitForSelector('#novaRows'); };

await open();
check(await page.locator('#novaTransfers').count() === 0, 'flag off -> section absent');

await page.evaluate(() => localStorage.setItem('nova.flags.transfers', '1'));
await open();
check(await page.locator('#novaTransfers').count() === 1, 'flag on -> section present');
check(/هذا الجهاز فقط/.test(await page.locator('#novaTransfers').innerText()), 'this-device-only notice in Arabic');
const K = await page.evaluate(() => { const k = window.NOVA_DEMO.products[0].barcode; window.novaStock.addLot({ barcode: k, lot: 'B2', expiry: '2099-06-01', qty: 5 }); window.novaStock.addLot({ barcode: k, lot: 'B1', expiry: '2099-01-01', qty: 5 }); return k; });
await page.evaluate(() => document.querySelector('.nova-tab[data-page=reports]').click());
await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
await page.waitForSelector('#novaTrfNew');
const h = await page.locator('#novaTrfNew').evaluate(e => e.getBoundingClientRect().height);
check(h >= 44, 'request button >= 44px');

await page.click('#novaTrfNew');
await page.selectOption('#trfDir', 'out');
await page.fill('#trfBranch', 'فرع 2');
await page.selectOption('#trfItem', K);
await page.fill('#trfQty', '7');
await page.click('.trf-ok');
await page.waitForSelector('[data-trf-send]');
check(await page.evaluate(k => window.novaStock.available(k), K) === 10, 'request does not change stock');
await page.click('[data-trf-send]');
await page.click('.trf-ok');
await page.waitForSelector('[data-trf-recv]');
check(await page.evaluate(k => window.novaStock.available(k), K) === 3, 'send reduced local stock 10 -> 3');
check(await page.evaluate(() => window.novaTransfers.list()[0].lots.map(l => l.lot + ':' + l.qty).join(',')) === 'B1:5,B2:2', 'FEFO: B1 (earlier expiry) taken first, then B2');
await page.click('[data-trf-recv]');
await page.fill('#trfRQty', '5');
await page.click('.trf-ok');
await page.waitForSelector('[data-status="received-diff"]');
check(await page.evaluate(() => window.novaTransfers.differences()[0].diff) === 2, 'receive with shortage records diff = 2');
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.novaTransfers);
check(await page.evaluate(() => { const t = window.novaTransfers.list()[0]; return t.status === 'received-diff' && t.diff === 2; }), 'state survives reload');
check(bad.length === 0, 'no non-GET requests ' + JSON.stringify(bad));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
