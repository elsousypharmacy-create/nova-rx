#!/usr/bin/env node
// PERF-02 measurement (local only, no live network): serves DIR like the preview Worker does (HTML no-store,
// /assets/app-* immutable, everything else no-store), opens / at 390x844 with throttled 4G (150 ms RTT, 1.6 Mbps down,
// 750 kbps up) + 4x CPU, reports HTML bytes, LCP and the requests the server saw on the first and the second load
// (second load = same browser profile, after the service worker installed).
// Usage: node tools/qa/perf02-measure.mjs DIR [--shots OUTDIR] [--label NAME]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const shots = opt('--shots'), label = opt('--label') || path.basename(dir);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
let hits = [];
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p === '/' || p === '/whatsapp') p = '/index.html';
  const f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { hits.push(['404', p, 0]); s.writeHead(404); return s.end(); }
  const body = fs.readFileSync(f);
  hits.push([q.method, p, body.length]);
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': /^\/assets\/app-/.test(p) ? 'public, max-age=31536000, immutable' : p === '/sw.js' ? 'no-cache' : 'no-store' });
  s.end(q.method === 'HEAD' ? undefined : body);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-EG' });
await ctx.route('**/*', (r) => { const u = r.request().url(); if (!u.startsWith(origin)) return r.abort(); if (r.request().method() !== 'GET' && r.request().method() !== 'HEAD') return r.abort(); return r.continue(); });
await ctx.addInitScript(() => { window.__lcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
let wire = 0; cdp.on('Network.loadingFinished', (e) => { wire += e.encodedDataLength; });
async function load(n) {
  hits = []; wire = 0;
  const t0 = Date.now();
  await page.goto(origin + '/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  const lcp = await page.evaluate(() => window.__lcp);
  const nav = await page.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) }; });
  const html = hits.filter((h) => h[1] === '/index.html').reduce((a, h) => a + h[2], 0);
  return { n, lcp: Math.round(lcp), ...nav, wallMs: Date.now() - t0, htmlBytes: html, serverRequests: hits.length, serverBytes: hits.reduce((a, h) => a + h[2], 0), wireBytes: wire, paths: hits.map((h) => h[1]) };
}
const first = await load(1);
if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${label}-390x844.png`) }); }
await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready).catch(() => null);
await page.waitForTimeout(4000);
const second = await load(2);
if (shots) {
  const big = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await big.route('**/*', (r) => r.request().url().startsWith(origin) && ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort());
  const p2 = await big.newPage(); await p2.goto(origin + '/', { waitUntil: 'load' }); await p2.waitForTimeout(2500);
  await p2.screenshot({ path: path.join(shots, `${label}-1280x800.png`) }); await big.close();
}
const summary = (r) => ({ ...r, paths: r.paths.length > 12 ? r.paths.slice(0, 6).concat(['…' + (r.paths.length - 6) + ' more']) : r.paths });
console.log(JSON.stringify({ label, first: summary(first), second: summary(second) }, null, 1));
await browser.close(); srv.close();
