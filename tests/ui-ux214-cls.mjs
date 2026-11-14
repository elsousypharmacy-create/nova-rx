// UX214: desktop load CLS <= 0.005 (1366x768, ar-EG, local static server, external requests aborted).
const { chromium } = await import('' + (process.env.PW_MODULE || '@playwright/test'));
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; if (p === '/emergency/stock.json') p = '/data/emergency-stock.json'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let fail = false;
try {
  for (const run of [1, 2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__cls = 0; window.__src = [];
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push({ v: e.value, t: Math.round(e.startTime), s: (e.sources || []).map(x => (x.node && (x.node.id || x.node.className || x.node.nodeName)) + ' ' + JSON.stringify(x.previousRect) + '->' + JSON.stringify(x.currentRect)) }); } }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({ cls: window.__cls, src: window.__src }));
    console.log(`run ${run}: CLS=${r.cls.toFixed(4)}`, r.cls > 0 ? JSON.stringify(r.src) : '');
    if (r.cls > 0.005) fail = true;
    await ctx.close();
  }
} finally { await browser.close(); srv.close(); }
if (fail) { console.log('FAIL: CLS > 0.005'); process.exit(1); }
console.log('PASS: CLS <= 0.005');
