import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = '/';
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
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let server;
let browser;

try {
  const started = await startServer();
  server = started.server;

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  // B fix: switch off the idle auto-loader so only the panel-open guard can load 190 (otherwise a broken guard still passes)
  await page.addInitScript(() => { window.requestIdleCallback = () => 0; });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));

  let loadFired = false;
  let requestedBeforeLoad = false;
  let scriptRequested = false;

  page.on('load', () => {
    loadFired = true;
  });

  page.on('request', (req) => {
    if (!/app-190-sticker-studio\.[0-9a-f]+\.js/.test(req.url())) return; // B fix: real URL is /assets/app-190-sticker-studio.<hash>.js
    const h = req.headers();
    const isPrefetch = h['purpose'] === 'prefetch' || h['sec-purpose'] === 'prefetch';
    if (req.resourceType() === 'script' && !isPrefetch) {
      scriptRequested = true;
      if (!loadFired) requestedBeforeLoad = true;
    }
  });

  await page.goto(started.baseUrl, { waitUntil: 'load' });
  assert.equal(requestedBeforeLoad, false, 'app/190-sticker-studio.js must not be loaded as a script before load');

  const readyAtLoad = await page.evaluate(() => Boolean(window.__nova190Ready));
  assert.equal(readyAtLoad, false, 'app/190-sticker-studio.js must not execute before load');

  // Verify early invoice-completed event is preserved before 190 loads,
  // then trigger lazy load solely by opening #novaLabelsPanel (no manual novaLazy.load call).
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nova:invoice-completed', {
      detail: { id: 'INV-EARLY-190', customer: 'عميل اختبار', items: [{ name: 'Panadol 500mg', qty: 1 }] },
    }));
    const panel = document.getElementById('novaLabelsPanel');
    if (panel) panel.classList.add('open');
  });

  await page.waitForFunction(() => window.__nova190Ready === true, { timeout: 10000 });
  assert.equal(scriptRequested, true, 'app/190-sticker-studio.js should be requested when #novaLabelsPanel opens');

  // Verify Sticker Studio UI is initialized, early invoice is queued/loaded, and actions work
  const presetCount = await page.locator('#nlPreset option').count();
  assert.ok(presetCount >= 5, `Expected preset options to be populated, got ${presetCount}`);

  const queueText = await page.locator('#nlInvoiceQueue').textContent();
  assert.ok(queueText && queueText.includes('INV-EARLY-190'), 'Early invoice should be preserved in #nlInvoiceQueue');

  const beforeCards = await page.locator('#nlMedicineList .med-card').count();
  assert.ok(beforeCards >= 1, 'Expected at least 1 medication card');

  await page.locator('#nlAddMedicine').click();
  const afterCards = await page.locator('#nlMedicineList .med-card').count();
  assert.equal(afterCards, beforeCards + 1, 'Clicking #nlAddMedicine should append a new medication card');

  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join(' | ')}`);
  console.log('PASS: lazy-190.mjs (no errors, deferred past load, early invoice & panel-open load work)');
} finally {
  if (browser) await browser.close();
  if (server) server.close();
}

