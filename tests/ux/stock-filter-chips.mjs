// UX304: stock filter chips + clickable KPI. 1366x768 + 390x844, local static server, non-GET aborted, fake data.
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
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const tag = `[${vp.width}x${vp.height}] `;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
  await page.waitForSelector('#novaStockChips');
  const rows = () => page.locator('#novaRows tr').count();
  const cnt = k => page.locator(`[data-chip-count="${k}"]`).innerText().then(Number);
  const total = await rows();
  check(await cnt('all') === total, `${tag}all chip = rows (${total})`);
  const low = await cnt('low');
  check(low > 0 && low < total, `${tag}low chip count ${low}`);
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('[data-stock-filter=low]').click());
  const ms = await page.evaluate(() => 0); void ms;
  check(await rows() === low, `${tag}low click rows = chip count`);
  check(Date.now() - t0 < 100 + 50, `${tag}filter applied fast (${Date.now() - t0}ms incl. roundtrip)`);
  const inPage = await page.evaluate(() => { const b = document.querySelector('[data-stock-filter=all]'); const t = performance.now(); b.click(); return performance.now() - t; });
  check(inPage < 100, `${tag}in-page click→render ${inPage.toFixed(1)}ms < 100`);
  check(await rows() === total, `${tag}all restores rows`);
  await page.evaluate(() => document.querySelector('[data-stock-filter=out]').click());
  check(await page.locator('#novaRows tr').count() === 0 && /لا توجد أصناف نفدت/.test(await page.locator('.nova-prod-panel .nova-empty').innerText()), `${tag}out empty state`);
  await page.evaluate(() => document.querySelector('[data-stock-filter=near]').click());
  check(/قريبة الانتهاء/.test(await page.locator('.nova-prod-panel .nova-empty').innerText()), `${tag}near empty state`);
  // KPI shortcut syncs with chip
  await page.evaluate(() => document.querySelector('#novaLowKpi').click());
  check(await page.locator('[data-stock-filter=low]').getAttribute('aria-pressed') === 'true' && await rows() === low, `${tag}KPI click activates low chip`);
  // chips persist through search
  await page.fill('#novaFilter', 'a');
  check(await page.locator('[data-stock-filter=low]').getAttribute('aria-pressed') === 'true', `${tag}chip kept in search state`);
  const lowS = await cnt('low');
  check(await rows() === lowS, `${tag}search+low rows = chip count (${lowS})`);
  check((await page.locator('.nova-stock-legend').getAttribute('title')).includes('30'), `${tag}threshold in legend tooltip`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}no horizontal overflow`);
  await ctx.close();
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
