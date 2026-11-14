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
// UX34: listed sale-bar controls + purchases selectAll >= 44x44 at 1024x768 and 390x844; no toolbar wrap at 1024
const UX34_IDS = ['btnNewSale', 'holdCurrentInvoice', 'btnHeldInvoices', 'btnAddLoyalty', 'btnSaleMore', 'searchModeTag', 'inputPercentDiscount', 'inputFixedDiscount', 'btnRefreshApp'];
for (const [name, size, mobile] of [['tablet1024', { width: 1024, height: 768 }, false], ['mobile390', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=sale]')?.click());
  await page.waitForTimeout(400);
  // UX44: on phones the discount inputs sit in a collapsible row; expand it before measuring
  await page.evaluate(() => { const t = document.getElementById('btnDiscountToggle'); if (t && t.offsetParent && t.getAttribute('aria-expanded') === 'false') t.click(); });
  const res = await page.evaluate(ids => {
    const boxes = ids.map(id => { const e = document.getElementById(id); if (!e) return [id, null]; const r = e.getBoundingClientRect(); return [id, { w: r.width, h: r.height }]; });
    const bar = document.querySelector('.nova-sale-actions');
    const mids = bar ? [...bar.children].filter(c => c.getBoundingClientRect().width > 0).map(c => { const q = c.getBoundingClientRect(); return q.top + q.height / 2; }) : [];
    return { boxes, rows: mids.length && Math.max(...mids) - Math.min(...mids) > 22 ? 2 : 1 };
  }, UX34_IDS);
  for (const [id, b] of res.boxes) {
    // discount inputs may sit in a collapsed panel on some layouts; zero-size = not rendered, reported as FAIL to stay honest
    const ok = b && b.w >= 43.5 && b.h >= 43.5;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} #${id}: ${b ? Math.round(b.w) + 'x' + Math.round(b.h) : 'missing'}`);
    if (!ok) failed++;
  }
  if (name === 'tablet1024') { const ok = res.rows <= 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} sale toolbar rows=${res.rows}`); if (!ok) failed++; }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'ar-EG' });
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', isMobile: true, hasTouch: true });
  for (const [name, c] of [['tablet1024', ctx], ['mobile390', ctx2]]) {
    await c.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
    const p = await c.newPage();
    await p.goto(BASE + '/purchases', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    const b = await p.evaluate(() => { const l = document.querySelector('#selectAll')?.closest('label'); if (!l) return null; const r = l.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const ok = b && b.w >= 43.5 && b.h >= 43.5;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} purchases selectAll label: ${b ? Math.round(b.w) + 'x' + Math.round(b.h) : 'missing'}`);
    if (!ok) failed++;
  }
  await ctx.close(); await ctx2.close();
}
await browser.close(); server.close();
if (failed) { console.error(`tap-targets: ${failed} failures`); process.exit(1); }
console.log('tap-targets check passed');
