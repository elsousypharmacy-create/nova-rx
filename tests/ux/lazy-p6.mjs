import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGETS = ['supplier-provider.js', 'supplier-lookup.js'];

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
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/api/suppliers/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        suppliers: [{ id: 'aumet', name: 'Aumet', state: 'ok' }],
      }));
      return;
    }
    if (urlPath.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, suppliers: [], sellers: [], results: [] }));
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
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const { server, baseUrl } = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  const pageErrors = [];
  const scriptsBeforeLoad = [];
  const loadedTargets = new Set();
  let loaded = false;

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (req) => {
    const p = new URL(req.url()).pathname.replace(/^\/+/, '');
    if (!TARGETS.includes(p)) return;
    const headers = req.headers();
    const purpose = `${headers['sec-purpose'] || ''} ${headers['purpose'] || ''}`;
    const isPrefetch = /prefetch/i.test(purpose);
    if (!loaded && req.resourceType() === 'script' && !isPrefetch) {
      scriptsBeforeLoad.push(p);
    }
    if (loaded) {
      loadedTargets.add(p);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'load' });
  loaded = true;

  // 1. Neither asset requested/executed as a script before window load
  assert.deepEqual(scriptsBeforeLoad, [], `Lazy scripts requested before load: ${scriptsBeforeLoad.join(', ')}`);
  const beforeState = await page.evaluate(() => ({
    provider: typeof window.NOVA_SUPPLIER_PROVIDER,
    settingsCard: !!document.querySelector('[data-su-settings="1"]'),
  }));
  assert.equal(beforeState.provider, 'undefined', 'NOVA_SUPPLIER_PROVIDER should not exist before lazy load');
  assert.equal(beforeState.settingsCard, false, 'supplier-lookup should not decorate settings before lazy load');

  // 2. Trigger lazy load (via novaLazy.load() if present, else wait for 2.5s timer)
  await page.evaluate(() => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      return window.novaLazy.load();
    }
    return new Promise((r) => setTimeout(r, 3000));
  });
  await page.waitForFunction(() => !!window.NOVA_SUPPLIER_PROVIDER, null, { timeout: 5000 });

  // 3. Verify provider API and end-to-end supplier lookup modal work after loading
  const apiReady = await page.evaluate(() => {
    const p = window.NOVA_SUPPLIER_PROVIDER;
    return !!(p && typeof p.search === 'function' && typeof p.listSuppliers === 'function' && typeof p.listSellers === 'function');
  });
  assert.equal(apiReady, true, 'NOVA_SUPPLIER_PROVIDER API missing after lazy load');

  await page.evaluate(() => {
    if (!document.querySelector('.nova-settings-grid')) {
      const grid = document.createElement('div');
      grid.className = 'nova-settings-grid';
      document.body.appendChild(grid);
    }
  });

  const cardBtn = page.locator('[data-su-settings="1"] button');
  await cardBtn.waitFor({ state: 'attached', timeout: 5000 });
  await cardBtn.dispatchEvent('click');

  const modal = page.locator('#novaSupplierBackdrop');
  await modal.waitFor({ state: 'visible', timeout: 5000 });

  const supplierRow = modal.locator('.ss-row[data-id="aumet"]');
  await supplierRow.waitFor({ state: 'visible', timeout: 5000 });
  await supplierRow.locator('.ss-ok').waitFor({ state: 'visible', timeout: 5000 });

  for (const t of TARGETS) {
    assert.equal(loadedTargets.has(t), true, `Expected ${t} to be requested after load`);
  }

  // 4. No page errors throughout
  assert.deepEqual(pageErrors, [], `Page errors detected: ${pageErrors.join(' | ')}`);
  console.log('PASS: lazy-p6 (supplier-provider.js + supplier-lookup.js)');
} finally {
  await browser.close();
  server.close();
}

