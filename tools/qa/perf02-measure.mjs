#!/usr/bin/env node
// PERF-02 measurement (local only, no live network). Serves DIR like the preview Worker does (HTML no-store,
// /assets/app-* immutable one-year cache, sw.js no-cache, everything else no-store) and opens / at 390x844 with
// 4x CPU throttling and a throttled "4G" link implemented IN THE SERVER: 150 ms per request + one shared 1.6 Mbps
// downlink, streamed in 16 KB chunks (so the HTML still renders progressively). Throttling in the server, not with CDP,
// because CDP emulation does not apply to fetches made by the service worker. No Playwright request interception
// either: route() disables the browser HTTP cache, which is exactly what we want to measure. External hosts are made
// unresolvable (--host-resolver-rules) and the server refuses anything but GET/HEAD (405), so nothing can be written.
// Reports HTML bytes, LCP, DCL/load and what the server saw on the first load and on a second load in the same
// profile (after the service worker installed).
// --h2: HTTP/2 + TLS (throwaway self-signed cert), like the Cloudflare edge; default plain HTTP/1.1.
// Usage: node tools/qa/perf02-measure.mjs DIR [--shots OUTDIR] [--label NAME] [--h2]
import http from 'node:http';
import http2 from 'node:http2';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const shots = opt('--shots'), label = opt('--label') || path.basename(dir), h2 = args.includes('--h2');
const RTT_MS = 150, DOWN_BPS = 1.6e6, CHUNK = 16 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
let linkFree = 0; // shared downlink: when the next byte may start
const linkDelay = (bytes) => { const now = Date.now(), start = Math.max(now, linkFree); linkFree = start + bytes * 8 / DOWN_BPS * 1000; return linkFree - now; };
let hits = [];
const handler = async (q, s) => {
  if (q.method !== 'GET' && q.method !== 'HEAD') { hits.push([q.method, q.url, 0]); s.writeHead(405); return s.end(); }
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p === '/' || p === '/whatsapp') p = '/index.html';
  const f = path.join(dir, p);
  await wait(RTT_MS);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { hits.push(['404', p, 0]); s.writeHead(404); return s.end(); }
  const body = fs.readFileSync(f);
  hits.push([q.method, p, body.length]);
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': /^\/assets\/app-/.test(p) ? 'public, max-age=31536000, immutable' : p === '/sw.js' ? 'no-cache' : 'no-store' });
  if (q.method === 'HEAD') return s.end();
  for (let i = 0; i < body.length; i += CHUNK) { const c = body.subarray(i, i + CHUNK); await wait(linkDelay(c.length)); s.write(c); }
  s.end();
};
let srv;
if (h2) {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'perf02-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', path.join(td, 'k.pem'), '-out', path.join(td, 'c.pem')], { stdio: 'ignore' });
  srv = http2.createSecureServer({ key: fs.readFileSync(path.join(td, 'k.pem')), cert: fs.readFileSync(path.join(td, 'c.pem')), allowHTTP1: true }, handler);
  fs.rmSync(td, { recursive: true });
} else srv = http.createServer(handler);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `${h2 ? 'https' : 'http'}://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', ...(h2 ? ['--ignore-certificate-errors'] : [])] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-EG', ignoreHTTPSErrors: h2 });
await ctx.addInitScript(() => { window.__lcp = 0; window.__lcpEl = ''; new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpEl = e.element ? e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ')[0] : '') : ''; } }).observe({ type: 'largest-contentful-paint', buffered: true }); });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
async function load(n) {
  hits = [];
  const t0 = Date.now();
  await page.goto(origin + '/', { waitUntil: 'load', timeout: 180000 });
  const wallMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return { lcp: Math.round(window.__lcp), lcpEl: window.__lcpEl, fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0), dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) }; });
  const html = hits.filter((h) => h[1] === '/index.html').reduce((a, h) => a + h[2], 0);
  return { n, ...r, wallMs, htmlBytes: html, serverRequests: hits.length, serverBytes: hits.reduce((a, h) => a + h[2], 0), paths: hits.map((h) => h[0] + ' ' + h[1]) };
}
const first = await load(1);
if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${label}-390x844.png`) }); }
await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready).catch(() => null);
await wait(15000); // let the SW install finish its precache over the throttled link
const afterInstall = hits.length;
const second = await load(2);
const swControlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
if (shots) {
  const big = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: h2 });
  const p2 = await big.newPage(); await p2.goto(origin + '/', { waitUntil: 'load', timeout: 180000 }); await p2.waitForTimeout(2500);
  await p2.screenshot({ path: path.join(shots, `${label}-1280x800.png`) }); await big.close();
}
const summary = (r) => ({ ...r, paths: r.paths.length > 12 ? r.paths.slice(0, 6).concat(['…' + (r.paths.length - 6) + ' more']) : r.paths });
console.log(JSON.stringify({ label, protocol: h2 ? 'h2' : 'http/1.1', swControlled, firstVisitRequestsInclSwInstall: afterInstall, first: summary(first), second: summary(second) }, null, 1));
await browser.close(); srv.close();
