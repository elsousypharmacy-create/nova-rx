// UX217: index.html and purchases.html declare an icon link, so the browser never requests /favicon.ico (no 404).
// Usage: node tests/ux/favicon-link.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let failed = 0;
for (const pg of ['/index.html', '/purchases.html']) {
  try {
    const ctx = await browser.newContext({ locale: 'ar-EG' });
    await ctx.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    const favReqs = [], notFound = [], consoleErr = [];
    page.on('request', r => { if (/\/favicon\.ico/.test(r.url())) favReqs.push(r.url()); });
    page.on('response', r => { if (r.status() === 404) notFound.push(r.url()); });
    page.on('console', m => { if (m.type() === 'error' && /favicon|404/.test(m.text())) consoleErr.push(m.text()); });
    await page.goto(BASE + pg, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const href = await page.$eval('link[rel~="icon"]', e => e.getAttribute('href'));
    assert.match(href, /icon\.svg/);
    assert.deepEqual(favReqs, [], 'no /favicon.ico request');
    assert.ok(!notFound.some(u => /favicon/.test(u)), 'no favicon 404');
    assert.deepEqual(consoleErr.filter(t => /favicon/.test(t)), []);
    console.log('  ok', pg);
    await ctx.close();
  } catch (e) { failed++; console.error('  FAIL', pg, e.message); }
}
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
