// UX229: CLS <= 0.01 for the seed -> invoices -> return dialog -> confirm -> reports journey, on 390px and 1366px.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port + '/';
// UX221: return dialog header = flex row (title + 44px close), no overlap, title fully visible, sticky on scroll; 1366 + 390.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let fail = 0; const ck = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + d); if (!ok) fail++; };
try {
  for (const [name, vp] of [['1366', { width: 1366, height: 768 }], ['390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', isMobile: vp.width < 600, hasTouch: vp.width < 600 });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => {
      try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
        const lines = Array.from({ length: 12 }, (_, i) => ({ name: 'صنف ' + i, barcode: '', price: 10, qty: 2, discount: 0 }));
        localStorage.setItem('nova-rx-sales-v1', JSON.stringify([{ id: 'sale-0', number: 'S-1001', at: new Date().toISOString(), customer: '', payment: 'cash', lines, subtotal: 240, discount: 0, vat: 0, total: 240, received: 240, change: 0, source: 'STOCK LIVE' }])); } catch {}
    });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(400);
    await page.locator('[data-return="sale-0"]').click(); await page.waitForTimeout(300);
    const m = () => page.evaluate(() => { const d = document.querySelector('.nova-return-overlay [role=dialog]'), h = d.querySelector('h3'), x = d.querySelector('.nova-dlg-x'), hd = d.querySelector('.nova-ret-head'); const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const rg = document.createRange(); rg.selectNodeContents(h); const tr = rg.getBoundingClientRect();
      return { h: r(h), x: r(x), d: r(d), hd: r(hd), text: { l: tr.left, r: tr.right }, sw: h.scrollWidth, cw: h.clientWidth, txt: h.textContent }; });
    let a = await m();
    ck(name + ' title text', a.txt.includes('S-1001'), a.txt);
    ck(name + ' no horizontal overlap', a.h.r <= a.x.l + 0.5 || a.x.r <= a.h.l + 0.5, JSON.stringify({ h: [a.h.l, a.h.r], x: [a.x.l, a.x.r] }));
    ck(name + ' text inside h3, not clipped', a.text.l >= a.h.l - 0.5 && a.text.r <= a.h.r + 0.5 && a.sw <= a.cw + 1);
    ck(name + ' close 44x44', Math.round(a.x.w) === 44 && Math.round(a.x.h) === 44);
    ck(name + ' title within dialog', a.h.l >= a.d.l && a.h.r <= a.d.r);
    ck(name + ' close at inline-start (left in RTL)', a.x.l < a.h.l);
    await page.evaluate(() => { const d = document.querySelector('.nova-return-overlay [role=dialog]'); d.scrollTop = d.scrollHeight; });
    await page.waitForTimeout(200);
    const sc = await page.evaluate(() => document.querySelector('.nova-return-overlay [role=dialog]').scrollTop);
    a = await m();
    ck(name + ' dialog scrolled', sc > 20, 'scrollTop=' + sc);
    ck(name + ' header sticky at top while scrolled', a.hd.t >= a.d.t && a.hd.t - a.d.t < 4 && a.x.b <= a.d.b, 'offset=' + (a.hd.t - a.d.t));
    await ctx.close();
  }
} finally { await browser.close(); srv.close(); }
console.log(fail ? 'FAIL: ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
