// UX303: expiry column + badges + near-expiry KPI from seeded FEFO lots. Fake data, non-GET aborted.
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
const shotDir = path.join(ROOT, '.nova/qa/qa-loop-301'); fs.mkdirSync(shotDir, { recursive: true });
for (const [name, vp] of [['desktop', { width: 1366, height: 768 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
  await page.waitForSelector('#novaLowKpi');
  const keys = await page.evaluate(() => [...document.querySelectorAll('#novaRows tr')].slice(0, 4).map(r => r.querySelector('.pc-bar').textContent.trim()));
  check(keys.length === 4, `${name}: 4 product keys`);
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const lots = [
    { key: keys[0], lot: 'A1', expiry: day(-5), qty: 3 },
    { key: keys[1], lot: 'B1', expiry: day(20), qty: 3 },
    { key: keys[1], lot: 'B2', expiry: day(300), qty: 3 },
    { key: keys[2], lot: 'C1', expiry: day(60), qty: 3 },
    { key: keys[3], lot: 'D1', expiry: day(400), qty: 3 },
  ];
  await page.evaluate(l => { localStorage.setItem('nova-rx-lots-v1', JSON.stringify(l)); document.querySelector('.nova-tab[data-page=sale]')?.click(); document.querySelector('.nova-tab[data-page=products]').click(); }, lots);
  await page.waitForSelector('#novaNearExpiryKpi');
  const st = await page.evaluate(() => [...document.querySelectorAll('#novaRows tr')].slice(0, 4).map(r => { const b = r.querySelector('[data-exp-badge]'); return b ? [b.dataset.expBadge, b.textContent.trim(), r.querySelector('[data-lot-count]')?.textContent.trim()] : null; }));
  check(st[0]?.[0] === 'expired' && /منتهي/.test(st[0][1]), `${name}: expired badge with text`);
  check(st[1]?.[0] === 'd30' && /20/.test(st[1][1]) && /2 تشغيلة/.test(st[1][2]), `${name}: <=30 badge, nearest lot, 2 lots`);
  check(st[2]?.[0] === 'd90' && /قريب/.test(st[2][1]), `${name}: <=90 badge with text`);
  check(st[3]?.[0] === 'ok', `${name}: ok badge`);
  check((await page.locator('#novaNearExpiryKpi strong').textContent()).trim() === '3', `${name}: KPI = 3`);
  check(await page.locator('#novaRows tr:first-child .pc-exp').isVisible(), `${name}: expiry cell visible`);
  if (name === 'desktop') check(await page.locator('.nova-prod-cards thead th', { hasText: 'أقرب صلاحية' }).count() === 1, 'desktop: header column');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: no horizontal page overflow`);
  await page.screenshot({ path: path.join(shotDir, `expiry-${name}.png`) });
  await ctx.close();
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
