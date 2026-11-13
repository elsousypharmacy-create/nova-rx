// UX9: closed modals must not be Tab-reachable; open checkout traps Tab; Esc returns focus to search.
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
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('#mainSearchInput');
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const inClosed = () => page.evaluate(() => { const a = document.activeElement; const m = a && a.closest('.modal-backdrop'); return !!(m && !m.classList.contains('active')); });
await page.evaluate(() => document.activeElement && document.activeElement.blur());
let bad = 0;
for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await inClosed()) bad++; }
check(bad === 0, `Tab stops inside closed modals in 40 presses = ${bad}`);
// put an item on the invoice
await page.focus('#mainSearchInput');
await page.keyboard.type('a');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.focus('#mainSearchInput');
await page.keyboard.press('F9');
await page.waitForTimeout(500);
const open = await page.evaluate(() => document.getElementById('checkoutModal').classList.contains('active'));
check(open, 'F9 opens checkout');
if (open) {
  let out = 0;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 2 ? 'Tab' : 'Shift+Tab');
    if (!(await page.evaluate(() => !!document.activeElement.closest('#checkoutModal')))) out++;
  }
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement.closest('#checkoutModal')))) out++;
  }
  check(out === 0, `Tab stops outside open checkout = ${out}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.activeElement.id) === 'mainSearchInput', 'Esc returns focus to #mainSearchInput');
  check(!(await page.evaluate(() => document.getElementById('checkoutModal').classList.contains('active'))), 'checkout closed after Esc');
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
