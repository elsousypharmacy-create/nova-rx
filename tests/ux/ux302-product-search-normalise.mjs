// UX302: Arabic-normalised product search (hamza / Hindi digits), highlight, clear button. 1366x768 + 390x844, local static server, non-GET aborted, fake data.
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
  await page.waitForSelector('#novaFilter');
  const rows = () => page.locator('#novaRows tr').count();
  const total = await rows();
  const t = async (q) => { await page.fill('#novaFilter', q); return page.locator('#novaRows tr').allInnerTexts(); };
  let r = await t('اوجمنتين');
  check(r.length === 1 && /6281001234569/.test(r[0]), `${tag}'اوجمنتين' finds Augmentin row (barcode 6281001234569) (${r.length})`);
  check(await page.locator('#novaRows mark.nova-hl').count() >= 1, `${tag}match highlighted`);
  r = await t('أوجمنتين');
  check(r.length === 1, `${tag}hamza form still matches`);
  r = await t('٦٢٨١٠٠١٢٣٤٥٦٩');
  check(r.length === 1 && /6281001234569/.test(r[0]), `${tag}Hindi-digit barcode finds row (${r.length})`);
  r = await t('٦٢٨١٠٠١٢٣٤');
  check(r.length >= 1, `${tag}partial Hindi barcode matches`);
  r = await t('اَوْجْمنتِين');
  check(r.length === 1, `${tag}tashkeel ignored`);
  r = await t('zzzxx');
  check(r.length === 0, `${tag}no match -> 0 rows`);
  check(await page.locator('#novaFilterClear').isVisible(), `${tag}clear button visible when text`);
  const ms = await page.evaluate(() => { const i = document.getElementById('novaFilter'); const s = performance.now(); i.value = 'اوجمنتين'; i.dispatchEvent(new Event('input', { bubbles: true })); return performance.now() - s; });
  check(ms < 100, `${tag}search+render ${ms.toFixed(1)}ms < 100`);
  await page.click('#novaFilterClear');
  check(await page.inputValue('#novaFilter') === '' && await rows() === total, `${tag}clear restores all rows (${total})`);
  check(await page.locator('#novaFilterClear').isHidden(), `${tag}clear hidden when empty`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}no horizontal overflow`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
process.exit(fail ? 1 : 0);
