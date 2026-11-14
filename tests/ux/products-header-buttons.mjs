// UX311: products header buttons not truncated + panel title.
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
for (const [w, h] of [[1366, 768], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const m = r.request().method(), u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
  await page.waitForSelector('#novaInventoryPurchase');
  const r = await page.evaluate(() => [...document.querySelectorAll('.nova-products-toolbar .nova-inventory-action')].map(b => ({ t: b.textContent.trim(), sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight, ov: getComputedStyle(b).textOverflow })));
  check(r.length === 3, `${w}px: 3 header buttons`);
  for (const b of r) check(b.sw === b.cw && b.sh <= b.ch + 1 && b.ov !== 'ellipsis', `${w}px: "${b.t}" not truncated (sw=${b.sw} cw=${b.cw})`);
  const title = await page.evaluate(() => document.querySelector('.nova-panel-title')?.textContent.trim());
  check(/^الأصناف/.test(title) && /عرض تجريبي/.test(title) && !/البيانات التجريبية/.test(title), `${w}px: panel title "${title}"`);
  const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(docOverflow, `${w}px: no horizontal page overflow`);
  check(errors.length === 0, `${w}px: no page errors ${errors.join('|')}`);
  await ctx.close();
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
