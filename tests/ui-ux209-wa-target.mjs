// UX209: #novaWaBtn >=36px desktop / >=44px mobile, aria-label, visible keyboard focus, no horizontal overflow.
const { chromium } = await import('' + (process.env.PW_MODULE || '@playwright/test'));
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let fail = false; const chk = (ok, m) => { console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) fail = true; };
try {
  for (const [name, vp, min, touch] of [['desktop', { width: 1440, height: 900 }, 36, false], ['mobile', { width: 390, height: 844 }, 44, true]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', hasTouch: touch, isMobile: touch });
    await ctx.route('**/*', r => { const u = r.request().url(); return (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const rc = id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, w: b.width, h: b.height, r: b.right }; };
      const live = document.querySelector('.nova-nav-brand .pharmacy-banner-live').getBoundingClientRect();
      return { wa: rc('novaWaBtn'), rf: rc('btnRefreshApp'), live: { x: live.x, r: live.right, w: live.width }, aria: document.getElementById('novaWaBtn').getAttribute('aria-label'), over: document.documentElement.scrollWidth - innerWidth };
    });
    console.log(name, JSON.stringify(r));
    chk(r.wa.w >= min && r.wa.h >= min, `${name}: #novaWaBtn ${r.wa.w}x${r.wa.h} >= ${min}`);
    chk(r.rf.w >= min && r.rf.h >= min, `${name}: #btnRefreshApp ${r.rf.w}x${r.rf.h} >= ${min}`);
    chk(!!r.aria, `${name}: aria-label "${r.aria}"`);
    chk(r.over <= 0, `${name}: no horizontal overflow (${r.over})`);
    const items = [r.wa, r.live, r.rf].sort((a, b) => a.x - b.x);
    const g1 = items[1].x - (items[0].x + items[0].w), g2 = items[2].x - (items[1].x + items[1].w);
    chk(g1 >= 0 && g2 >= 0 && Math.abs(g1 - g2) <= 1, `${name}: even gaps ${g1.toFixed(1)}/${g2.toFixed(1)}`);
    await page.evaluate(() => document.getElementById('novaWaBtn').focus());
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const f = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { id: e.id, ow: parseFloat(c.outlineWidth), os: c.outlineStyle }; });
    chk(f.id === 'novaWaBtn' && f.ow >= 2 && f.os !== 'none', `${name}: keyboard focus ring ${JSON.stringify(f)}`);
    await ctx.close();
  }
} finally { await browser.close(); srv.close(); }
console.log(fail ? 'FAIL' : 'PASS'); process.exit(fail ? 1 : 0);
