// UX45: radius/gap scale + purchases active tab inside viewport at 390x844.
// Usage: node tests/ux/spacing-scale.mjs   (needs playwright + chromium; CHROME_PATH optional)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/purchases') p = '/purchases.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const GAP_SCALE = new Set([0, 4, 8, 12, 16, 24]);
const GAP_EXCEPTIONS = new Set([1, 2]); // documented 2px hairline exceptions
const MAX_RADII = 4;

const measure = () => {
  const radii = new Set(), gaps = new Set();
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.display === 'none') continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // 0 = square corners and 50% = true circles are shapes, not scale steps
    for (const k of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      const v = s[k]; if (v !== '0px' && v !== '50%') radii.add(v);
    }
    if (/flex|grid/.test(s.display)) for (const k of ['rowGap', 'columnGap']) { const v = s[k]; if (v !== 'normal') gaps.add(parseFloat(v)); }
  }
  return { radii: [...radii], gaps: [...gaps] };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let failed = 0;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', isMobile: true, hasTouch: true });
await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('#mainSearchInput');
await page.waitForTimeout(800);
for (const p of ['sale', 'products', 'settings']) {
  await page.evaluate(id => document.querySelector(`.nova-tab[data-page=${id}]`)?.click(), p);
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  const badGaps = m.gaps.filter(g => !GAP_SCALE.has(g) && !GAP_EXCEPTIONS.has(g));
  const ok = m.radii.length <= MAX_RADII && badGaps.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${p}: radii=[${m.radii.join(' | ')}] offScaleGaps=[${badGaps.join(',')}]`);
  if (!ok) failed++;
}
await page.goto(BASE + '/purchases', { waitUntil: 'load' });
await page.waitForTimeout(800);
const t = await page.evaluate(() => {
  const a = document.querySelector('.nova-topbar nav a[aria-current]'); const r = a.getBoundingClientRect();
  return { l: r.left, r: r.right, vw: document.documentElement.clientWidth, dot: !!document.querySelector('.nova-topbar .brand .pharmacy-banner-live') };
});
const inside = t.l >= 0 && t.r <= t.vw;
console.log(`${inside && t.dot ? 'PASS' : 'FAIL'} purchases active tab left=${Math.round(t.l)} right=${Math.round(t.r)} vw=${t.vw} brandDot=${t.dot}`);
if (!inside || !t.dot) failed++;
await browser.close(); server.close();
if (failed) { console.log(`spacing-scale: ${failed} failure(s)`); process.exit(1); }
console.log('spacing-scale passed');
