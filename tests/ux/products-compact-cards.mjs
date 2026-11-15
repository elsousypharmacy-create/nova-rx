// UX307: compact product cards (<=84px, >=6 in 390x844 fold, 44px tap, no overflow). Local static server, non-GET aborted.
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
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
for (const [w, hh, mobile] of [[1366, 768, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, locale: 'ar-EG', hasTouch: mobile });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
  await page.waitForSelector('#novaRows tr');
  const tag = w + 'x' + hh;
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ' no horizontal overflow');
  if (mobile) {
    const info = await page.locator('#novaRows tr').evaluateAll(trs => trs.map(t => { const r = t.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; }));
    check(info.every(r => r.h >= 43.5 && r.h <= 84.5), tag + ' card height 44..84 (max ' + Math.max(...info.map(r => r.h)) + ')');
    const vis = info.filter(r => r.top >= 0 && r.bottom <= 844).length;
    check(vis >= 6, tag + ' visible cards in first fold >= 6 (got ' + vis + ')');
    check(await page.locator('#novaRows tr').first().evaluate(t => t.querySelectorAll('.pc-name,.pc-price,.pc-bar').length === 3), tag + ' name/price/barcode present');
  } else {
    check(await page.locator('.nova-data-table thead').first().isVisible(), tag + ' desktop table header still visible');
  }
  await ctx.close();
}
await browser.close(); server.close();
if (fail) { console.log(fail + ' FAILED'); process.exit(1); }
console.log('ok products-compact-cards');
