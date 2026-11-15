// UX315: wordmark stays whole and clear of nav arrows on every tab (390x844 + 1366x768). Local server, non-GET aborted, fake data.
// Usage: node tests/ux/mobile-header-brand-nav.mjs
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
const rects = page => page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const shown = getComputedStyle(e).display !== 'none' && b.width > 0; return { l: b.left, r: b.right, t: b.top, b: b.bottom, shown }; };
  return { brand: r('.nova-brand-name'), prev: r('#novaNavPrev'), next: r('#novaNavNext'), vw: innerWidth };
});
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const check = async (page, label, mobile) => {
  // scroll through both arrow states
  for (let i = 0; i < 4; i++) {
    const g = await rects(page);
    assert.ok(g.brand && g.brand.shown, label + ': brand visible');
    assert.ok(g.brand.l >= 12 - 0.5, `${label}: brand >=12px from left edge (${g.brand.l})`);
    assert.ok(g.brand.r <= g.vw, label + ': brand inside viewport');
    for (const k of ['prev', 'next']) if (g[k] && g[k].shown) assert.ok(!overlap(g.brand, g[k]), `${label}: ${k} arrow overlaps brand`);
    if (!mobile || !(g.next && g.next.shown)) break;
    await page.locator('#novaNavNext').click(); await page.waitForTimeout(500);
  }
};
try {
  for (const [w, h, mobile] of [[390, 844, true], [1366, 768, false]]) {
    const page = await open(w, h);
    const tabs = await page.locator('.nova-nav .nova-tab[data-page]').evaluateAll(a => a.map(e => e.dataset.page));
    assert.ok(tabs.length >= 6, 'tabs found');
    await check(page, `${w} initial`, mobile);
    for (const t of tabs) {
      await page.locator(`.nova-nav .nova-tab[data-page="${t}"]`).evaluate(e => e.scrollIntoView({ inline: 'nearest' }));
      await page.locator(`.nova-nav .nova-tab[data-page="${t}"]`).click();
      await page.waitForTimeout(450);
      await check(page, `${w} ${t}`, mobile);
    }
    await page.context().close();
  }
  console.log('mobile-header-brand-nav passed');
} finally { await browser.close(); server.close(); }
