// UX16: tap targets >= 44px. Local static server, fake data, all non-GET requests aborted.
// Usage: node tests/ux/tap-targets.mjs   (needs playwright + chromium)
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
const PAGES = ['sale', 'products', 'customers', 'reports', 'invoices', 'settings'];

const measure = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const hidden = e => { for (let x = e; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden' || x.hidden || x.getAttribute('aria-hidden') === 'true') return true; if (parseFloat(s.opacity) === 0) return true; } return false; };
  const inlineLink = e => e.tagName === 'A' && getComputedStyle(e).display === 'inline' && !e.closest('nav,.nova-nav,.nav');
  const offscreenClipped = e => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (/(hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY) && s.position === 'fixed') return false; } return false; };
  const ctrls = [...document.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')]
    .filter(e => vis(e) && !hidden(e) && !e.disabled && !inlineLink(e) && !offscreenClipped(e) && !e.closest('.nova-return-overlay[hidden]'));
  const small = ctrls.filter(e => e.getBoundingClientRect().height < 43.5)
    .map(e => (e.id || e.className && String(e.className).split(/\s+/)[0] || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
  const navEl = document.querySelector('.nova-nav') || document.querySelector('.nova-topbar nav');
  let wraps = false;
  if (navEl) { const tops = new Set([...navEl.children].filter(c => vis(c) && c.matches('.nova-tab,a')).map(c => Math.round(c.getBoundingClientRect().top))); wraps = tops.size > 1; }
  return { small, total: ctrls.length, wraps };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let failed = 0;
for (const [name, size, mobile] of [['mobile', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 768 }, false]]) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.waitForTimeout(800);
  const results = [];
  for (const p of PAGES) {
    await page.evaluate(id => document.querySelector(`.nova-tab[data-page=${id}]`)?.click(), p);
    await page.waitForTimeout(400);
    results.push([p, await page.evaluate(measure)]);
  }
  await page.goto(BASE + '/purchases', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  results.push(['purchases', await page.evaluate(measure)]);
  for (const [p, r] of results) {
    // mobile: every control >= 44px; desktop: nav tabs must have a 44px hit area (dense sale toolbar keeps 34-40px by design)
    const bad = name === 'mobile' ? r.small.length : r.small.filter(x => /^(nova-tab|novaPurchasesNav|A|brand):/.test(x)).length;
    const ok = bad === 0 && !r.wraps;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${p}: ${r.small.length}/${r.total} under 44px${r.wraps ? ', NAV WRAPS' : ''}${r.small.length ? ' [' + r.small.slice(0, 8).join(', ') + ']' : ''}`);
    if (!ok) failed++;
  }
  await ctx.close();
}
await browser.close(); server.close();
if (failed) { console.error(`tap-targets: ${failed} failures`); process.exit(1); }
console.log('tap-targets check passed');
