// tests/ux/lazy-500.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel);
  if (
    (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true
});

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();

  const pageErrors = [];
  const early500Reqs = [];
  let loadFired = false;

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('load', () => { loadFired = true; });
  page.on('request', (req) => {
    if (!loadFired && /500-receiving/i.test(req.url())) {
      const h = req.headers();
      if (h['sec-purpose'] !== 'prefetch' && h['purpose'] !== 'prefetch') {
        early500Reqs.push(req.url());
      }
    }
  });

  // 1) Boot to load: 500 must not execute before load; stub and novaToast must be intact
  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  const atLoad = await page.evaluate(() => ({
    stubbed: !!(window.novaReceiving && window.novaReceiving._stub),
    hasToast: typeof window.novaToast === 'function'
  }));
  assert.equal(early500Reqs.length, 0, '500 script must not be requested before load: ' + early500Reqs.join(', '));
  assert.equal(atLoad.stubbed, true, 'window.novaReceiving must still be the stub at load');
  // B fix: nothing in the app defines window.novaToast (also on main); check only that 500 leaves it unchanged (below).

  // 2) Open Receiving page: 500 loads, replaces stub, and renders .rcv inside #novaPageView
  await page.evaluate(() => {
    const trigger = document.querySelector('[data-page="receiving"]');
    if (trigger) trigger.click();
    else location.hash = '#receiving';
  });
  await page.waitForSelector('#novaPageView .rcv', { timeout: 10000 });
  const postRender = await page.evaluate(() => ({
    stubbed: !!(window.novaReceiving && window.novaReceiving._stub),
    hasRcv: !!document.querySelector('#novaPageView .rcv'),
    hasToast: typeof window.novaToast === 'function'
  }));
  assert.equal(postRender.hasToast, atLoad.hasToast, '500-receiving must not change window.novaToast');
  assert.equal(postRender.stubbed, false, '500-receiving must replace the stub after loading');
  assert.equal(postRender.hasRcv, true, 'Receiving UI (.rcv) must render inside #novaPageView');

  // 3) Verify programmatic API used by purchases-history.js (novaReceiving.open)
  await page.evaluate(() => window.novaReceiving.open());
  await page.waitForSelector('#rcvForm', { timeout: 5000 });
  assert.deepEqual(pageErrors, [], 'No pageerror allowed during boot or receiving usage');

  console.log('PASS: lazy-500.mjs');
} finally {
  await browser.close();
  server.close();
}

