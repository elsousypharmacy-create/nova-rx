// UX309: stock status chips (ok/low/out) with icon+text+aria-label, contrast>=4.5. Fake data, non-GET aborted.
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
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = s => s.match(/\d+/g).slice(0, 3).map(Number);
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.evaluate(() => { const p = window.NOVA_DEMO.products; p[0].stock = 0; p[1].stock = 120; p[2].stock = 28; });
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
  await page.waitForSelector('#novaLowKpi');
  const tag = `[${vp.width}x${vp.height}] `;
  for (const st of ['ok', 'low', 'out']) {
    const loc = page.locator(`#novaRows .nova-stock-${st}`).first();
    check(await loc.count() === 1, tag + `${st} chip exists`);
    const aria = await loc.getAttribute('aria-label');
    check(!!aria && /:/.test(aria), tag + `${st} aria-label="${aria}"`);
    const txt = await loc.innerText();
    check(/(نفد|منخفض|متوفر)/.test(txt), tag + `${st} text visible "${txt.replace(/\s+/g, ' ')}"`);
    check(await loc.locator('.nova-stock-ic').count() === 1, tag + `${st} has icon`);
    const { c, b } = await loc.evaluate(e => { const s = getComputedStyle(e); return { c: s.color, b: s.backgroundColor }; });
    const r = ratio(rgb(c), rgb(b));
    check(r >= 4.5, tag + `${st} contrast ${r.toFixed(2)}`);
  }
  check((await page.locator('#novaRows .nova-stock-out').first().getAttribute('aria-label')).startsWith('نفد'), tag + 'out state says نفد');
  const k = await page.locator('#novaLowKpi small').evaluate(e => { const s = getComputedStyle(e); const bg = getComputedStyle(e.parentElement).backgroundColor; return { c: s.color, bg, fs: parseFloat(s.fontSize) }; });
  const kr = ratio(rgb(k.c), rgb(k.bg));
  check(kr >= 4.5, tag + `KPI sublabel contrast ${kr.toFixed(2)}`);
  check(k.fs >= 13, tag + `KPI sublabel font ${k.fs}px`);
  await ctx.close();
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
