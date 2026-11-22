import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = 'app/330-ux430-wa-kpi.js'; // B fix: the real URL is /assets/app-330-ux430-wa-kpi.<hash>.js
const TARGET_RE = /app-330-ux430-wa-kpi\.[0-9a-f]+\.js/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      const insideRoot = full === ROOT || full.startsWith(ROOT + path.sep);
      if (!insideRoot || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const { server, url } = await startServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  const pageErrors = [];
  const preLoadReqs = [];
  const postLoadScriptReqs = [];
  let loaded = false;

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    if (!TARGET_RE.test(req.url())) return;
    const headers = req.headers();
    const isPrefetch = String(headers['sec-purpose'] || headers.purpose || '')
      .toLowerCase()
      .includes('prefetch');
    if (!loaded && !isPrefetch) {
      preLoadReqs.push(`${req.resourceType()}:${req.url()}`);
    } else if (loaded && req.resourceType() === 'script' && !isPrefetch) {
      postLoadScriptReqs.push(req.url());
    }
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('nova.flags.waKpis', '1');
      localStorage.setItem('nova.waKpi.autoload', '1');
    } catch (_) {}
  });

  await page.route('**/api/v1/inbox/history/metrics', (route) => {
    const t = Date.now();
    return route.fulfill({
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        ok: true,
        data: {
          customers: [{ id: 'c1', name: 'Test Customer' }],
          events: [
            { c: 'c1', k: 'in', t },
            { c: 'c1', k: 'pharm', t, s: 'Dr. Test' },
          ],
        },
      }),
    });
  });

  await page.goto(url, { waitUntil: 'load' });
  loaded = true;

  // 1. Asset not requested/executed before load
  assert.deepEqual(preLoadReqs, [], `Expected ${TARGET} not requested before load: ${preLoadReqs.join(', ')}`);
  const definedAtLoad = await page.evaluate(() => typeof window.novaWaKpis !== 'undefined');
  assert.equal(definedAtLoad, false, 'Expected window.novaWaKpis to be undefined at load');

  // 2. Wait for lazy load (2.5s timer in app/548) and verify script loaded + feature works
  await page.waitForFunction(() => Boolean(window.novaWaKpis && window.novaWaKpis.enabled === true), {
    timeout: 15000,
  });
  assert.ok(postLoadScriptReqs.length >= 1, `Expected ${TARGET} to be requested as script after load`);

  const card = page.locator('#novaWaKpiCard');
  await card.waitFor({ state: 'visible', timeout: 5000 });
  await card.click();

  const view = page.locator('#novaWaKpiView');
  await page.waitForFunction(() => {
    const el = document.getElementById('novaWaKpiView');
    return Boolean(el && !el.hidden && el.querySelector('[data-kpi="chats"] b'));
  }, { timeout: 5000 });

  const chatsVal = await view.locator('[data-kpi="chats"] b').textContent();
  const msgsVal = await view.locator('[data-kpi="msgs"] b').textContent();
  assert.equal(chatsVal?.trim(), '1', 'Expected mocked chat count of 1 in KPI view');
  assert.equal(msgsVal?.trim(), '2', 'Expected mocked message count of 2 in KPI view');

  // 3. No page errors
  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join('; ')}`);
  console.log('PASS: lazy-p5 (330-ux430-wa-kpi.js)');
} finally {
  await browser.close();
  server.close();
}

