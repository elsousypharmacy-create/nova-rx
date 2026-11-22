// UX308: mobile nav shows chevron affordance; all 7 destinations reachable; active tab visible. Local server, non-GET aborted.
// Usage: node tests/ux/mobile-nav-chevrons.mjs
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
async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.method() === 'GET' && (q.url().startsWith(BASE) || q.url().startsWith('data:')) ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.nova-tab');
  await page.waitForTimeout(600);
  return page;
}
const vis = (page, sel) => page.locator(sel).evaluate(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
try {
  // Mobile
  const m = await open(390, 844);
  const o = await m.evaluate(() => { const n = document.querySelector('.nova-nav'); return { sw: n.scrollWidth, cw: n.clientWidth, dir: getComputedStyle(n).direction }; });
  assert.ok(o.sw > o.cw, 'nav overflows on mobile');
  assert.equal(o.dir, 'rtl');
  assert.equal(await m.locator('.nova-nav .nova-tab:not([hidden])').count(), 8, '8 destinations (Q21-2b owner nav: البيع … الأدوات + ⚙)');
  assert.ok(await vis(m, '#novaNavNext'), 'next chevron visible at start');
  assert.ok(!(await vis(m, '#novaNavPrev')), 'prev chevron hidden at start');
  let guard = 0;
  while (await vis(m, '#novaNavNext') && guard++ < 6) { await m.locator('#novaNavNext').click(); await m.waitForTimeout(500); }
  assert.ok(await vis(m, '#novaNavPrev'), 'prev chevron visible at end');
  assert.ok(!(await vis(m, '#novaNavNext')), 'next chevron hidden at end');
  assert.ok(guard <= 3, 'all tabs reachable in few chevron taps: ' + guard);
  const inView = async sel => m.locator(sel).evaluate(e => { const a = e.getBoundingClientRect(), n = document.querySelector('.nova-nav').getBoundingClientRect(); return a.left >= n.left - 1 && a.right <= n.right + 1; });
  assert.ok(await inView('[data-page="settings"]'), 'last tab fully visible after scrolling');
  // active tab visible after switching
  await m.locator('[data-page="settings"]').click();
  await m.waitForTimeout(600);
  assert.ok(await inView('.nova-tab.active'), 'active tab visible');
  await m.locator('#novaNavPrev').click(); await m.waitForTimeout(500);
  await m.locator('[data-page="products"]').click();
  await m.waitForTimeout(600);
  assert.ok(await inView('.nova-tab.active'), 'active tab (products) visible');
  await m.context().close();
  // Desktop
  const d = await open(1366, 768);
  assert.ok(!(await vis(d, '#novaNavNext')) && !(await vis(d, '#novaNavPrev')), 'no chevrons on desktop');
  await d.context().close();
  console.log('mobile-nav-chevrons passed');
} finally { await browser.close(); server.close(); }
