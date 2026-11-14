// UX312: cold load with emergency/stock.json missing must log zero console errors and stay quiet (demo data kept).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  if (q.method !== 'GET' && q.method !== 'HEAD') { s.writeHead(405).end(); return; }
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (p === '/emergency/stock.json' || p === '/favicon.ico' || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; }
  s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0;
for (const [w, h] of [[1366, 768], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const req = r.request(), u = req.url();
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return r.abort();
    if (u.startsWith(BASE) || u.startsWith('data:')) return r.continue();
    return r.fulfill({ status: 200, contentType: u.endsWith('.css') || u.includes('css') ? 'text/css' : 'text/plain', body: '' }); // offline-safe stub for external assets
  });
  const page = await ctx.newPage();
  const errs = [], stockReqs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('request', r => { if (r.url().includes('emergency/stock.json')) stockReqs.push(r.url()); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  assert.deepEqual(errs, [], `${w}x${h}: console errors ${JSON.stringify(errs)}`);
  assert.equal(stockReqs.length, 0, `${w}x${h}: no 404 probe on loopback static host`);
  assert.equal(await page.evaluate(() => window.novaCatalog.source), 'demo', 'demo catalog kept');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl', 'RTL preserved');
  // reload with a remembered miss: still quiet
  await page.evaluate(() => localStorage.setItem('nova-stock-missing-v1', String(Date.now())));
  await page.goto(BASE + '?stock=1', { waitUntil: 'load' }); await page.waitForTimeout(500);
  assert.equal(stockReqs.length, 0, 'remembered miss suppresses the request');
  assert.deepEqual(errs, []);
  n++; console.log(`  ok ${w}x${h}`);
  await ctx.close();
}
await browser.close(); srv.close();
console.log(`stock-missing-quiet: ${n} passed`);
