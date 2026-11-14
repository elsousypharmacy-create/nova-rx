// UX229: CLS <= 0.01 for the seed -> invoices -> return dialog -> confirm -> reports journey, on 390px and 1366px.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port + '/';
const LIMIT = 0.01;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let fail = false;
try {
  for (const [name, vp] of [['desktop 1366', { width: 1366, height: 768 }], ['mobile 390', { width: 390, height: 844 }]]) {
    for (const run of [1, 2]) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', isMobile: vp.width < 600, hasTouch: vp.width < 600 });
      await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
      const page = await ctx.newPage();
      await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
      await page.addInitScript(() => {
        try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {}
        try { if (!localStorage.getItem('nova-rx-sales-v1')) { const now = new Date().toISOString(), pays = ['cash', 'card', 'credit', 'mixed']; localStorage.setItem('nova-rx-sales-v1', JSON.stringify(pays.map((p, i) => ({ id: 'sale-' + i, number: 'S-' + i, at: now, customer: '', payment: p, lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0, source: 'STOCK LIVE' })))); } } catch {}
        window.__cls = 0; window.__src = [];
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push({ v: +e.value.toFixed(4), s: (e.sources || []).map(x => (x.node && (x.node.id || String(x.node.className) || x.node.nodeName)) + ' ' + JSON.stringify(x.previousRect) + '->' + JSON.stringify(x.currentRect)) }); } }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
      await page.waitForTimeout(1800);
      await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(400);
      await page.locator('[data-return="sale-0"]').click(); await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector('#novaRetOk').click()); await page.waitForTimeout(200); // (programmatic click: not exempt as user input) empty confirm -> error message appears
      await page.locator('[data-ret-idx="0"]').fill('1'); await page.waitForTimeout(200); // refund amount appears
      await page.locator('#novaRetReason').fill('طلب العميل');
      await page.locator('#novaRetOk').click(); await page.waitForTimeout(400);
      await page.locator('.nova-tab[data-page=reports]').click(); await page.waitForTimeout(800);
      for (const t of await page.$$eval('.nova-nav .nova-tab[data-page]', e => e.map(x => x.dataset.page))) { await page.locator('.nova-tab[data-page="' + t + '"]').click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(450); }
      const r = await page.evaluate(() => ({ cls: window.__cls, src: window.__src }));
      console.log(`${name} run ${run}: CLS=${r.cls.toFixed(4)}`, r.cls > 0 ? JSON.stringify(r.src) : '');
      if (r.cls > LIMIT) fail = true;
      await ctx.close();
    }
  }
} finally { await browser.close(); srv.close(); }
if (fail) { console.log('FAIL: CLS > ' + LIMIT); process.exit(1); }
console.log('PASS: returns journey CLS <= ' + LIMIT);
