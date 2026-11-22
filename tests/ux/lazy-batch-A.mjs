import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// B fix: the real URLs are /assets/app-NNN-x.<hash>.js; 010-receipt-corrections stays EAGER (POS core app/120 reads
// lots through NovaReceiptOperations.readRaw and its stock lock calls .recover), so it is not in this list.
const LAZY_RE = /^assets\/app-(030-nova-push-card-js|440-home-dashboard|460-ux-p31-po-store|470-ux-p38-settings-sections)\.[0-9a-f]+\.js$/;
const LAZY_FILES = { includes: (p) => LAZY_RE.test(p) };

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
      const cleanUrl = (req.url || '/').split('?')[0];
      const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
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
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const { server, baseUrl } = await startServer();
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const requestedBeforeLoad = new Set();
  let loadFired = false;

  page.on('request', (req) => {
    if (loadFired) return;
    const urlPath = new URL(req.url()).pathname.replace(/^\/+/, '');
    if (LAZY_FILES.includes(urlPath) && req.resourceType() === 'script') {
      requestedBeforeLoad.add(urlPath);
    }
  });

  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  loadFired = true;

  // 1. None of the lazy assets executed as <script> before load
  assert.deepEqual(
    [...requestedBeforeLoad],
    [],
    `Lazy scripts executed before load: ${[...requestedBeforeLoad].join(', ')}`
  );

  // 2. Eager 400-po-sync.js IS present at boot; lazy globals are NOT yet defined
  const bootState = await page.evaluate(() => ({
    poSync: typeof window.NovaPoSync,
    poSyncCreate: typeof (window.NovaPoSync && window.NovaPoSync.create),
    receiptOps: typeof window.NovaReceiptOperations,
    poStore: typeof window.NovaPurchaseOrders,
    setup: typeof window.novaSetup,
  }));
  assert.equal(bootState.poSync, 'object', '400-po-sync.js must remain eager');
  assert.equal(bootState.poSyncCreate, 'function', '400-po-sync.js create() must be ready at boot');
  assert.equal(bootState.receiptOps, 'object', '010-receipt-corrections.js must stay eager (POS lots + stock lock recovery)');
  assert.equal(bootState.poStore, 'undefined', '460-ux-p31-po-store.js should be lazy');
  assert.equal(bootState.setup, 'undefined', '440-home-dashboard.js should be lazy');

  // 3. Trigger lazy load via Settings tab (and novaLazy.load() fallback)
  await page.evaluate(async () => {
    const settingsTab = document.querySelector('.nova-tab[data-page="settings"]');
    if (settingsTab) settingsTab.click();
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
  });

  // Wait for all lazy globals AND 470-ux-p38-settings-sections.js (last in document order)
  await page.waitForFunction(
    () =>
      typeof window.NovaReceiptOperations === 'object' &&
      typeof window.NovaPurchaseOrders === 'object' &&
      typeof window.novaSetup === 'object' &&
      Boolean(document.querySelector('#novaPageView .nova-settings-grid[data-secs="1"]')) &&
      Boolean(document.querySelector('#novaPageView .nova-set-nav')),
    { timeout: 10000 }
  );

  // 4. Verify each lazy module works after loading
  const results = await page.evaluate(async () => {
    // (a) 010-receipt-corrections.js
    const rev = window.NovaReceiptOperations.review(
      { lines: [{ code: 'A1', name: 'Item A', qty: 10, received: 0, cost: 5 }] },
      [{ code: 'A1', name: 'Item A', qty: 4, cost: 5 }]
    );

    // (b) 460-ux-p31-po-store.js
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
    const ledger = { append: () => {} };
    const store = window.NovaPurchaseOrders.createStore(storage, ledger);
    const po = store.create({ supplier: 'TestSup', lines: [{ code: 'A1', qty: 5, cost: 10 }] });

    // (c) 440-home-dashboard.js
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.novaSetup.mount(host);
    const setupMounted = host.querySelectorAll('.nsw-row').length > 0;
    host.remove();

    // (d) 030-nova-push-card-js.js
    let pushState = document.getElementById('novaPushState');
    let tempCard = null;
    if (!pushState) {
      tempCard = document.createElement('div');
      tempCard.id = 'novaPushCard';
      tempCard.innerHTML = '<div id="novaPushState"></div>';
      document.body.appendChild(tempCard);
      await new Promise((r) => setTimeout(r, 50));
      pushState = document.getElementById('novaPushState');
    }
    const pushPopulated = Boolean(pushState && pushState.getAttribute('data-state'));
    if (tempCard) tempCard.remove();

    // (e) 470-ux-p38-settings-sections.js
    const settingsGrid = document.querySelector('#novaPageView .nova-settings-grid');
    const settingsEnhanced = Boolean(
      settingsGrid &&
        settingsGrid.getAttribute('data-secs') === '1' &&
        document.querySelector('#novaPageView .nova-set-nav')
    );

    return {
      reviewCount: rev.length,
      reviewRemaining: rev[0]?.remaining,
      poId: po.id,
      poState: po.state,
      setupMounted,
      pushPopulated,
      settingsEnhanced,
    };
  });

  assert.equal(results.reviewCount, 1, '010 review() should return 1 line');
  assert.equal(results.reviewRemaining, 6, '010 review() remaining qty mismatch');
  assert.equal(results.poId, 'PO-1', '460 createStore().create() should return PO-1');
  assert.equal(results.poState, 'draft', '460 new PO should start in draft');
  assert.equal(results.setupMounted, true, '440 novaSetup.mount() should render rows');
  assert.equal(results.pushPopulated, true, '030 push card should set data-state on #novaPushState');
  assert.equal(results.settingsEnhanced, true, '470 should enhance .nova-settings-grid with .nova-set-nav');

  // 4b. (B) Settings opened BEFORE the lazy code ran: app/130 found no novaSetup, so 440 must fill #novaSetupCard itself
  {
    const p2 = await context.newPage();
    p2.on('pageerror', (err) => pageErrors.push(String(err)));
    await p2.addInitScript(() => { window.requestIdleCallback = () => 0; });
    await p2.goto(baseUrl + '/', { waitUntil: 'load' });
    const before = await p2.evaluate(() => typeof window.novaSetup);
    assert.equal(before, 'undefined', '440 not run before Settings opens');
    await p2.evaluate(() => document.querySelector('.nova-tab[data-page="settings"]').click());
    await p2.waitForFunction(() => document.querySelectorAll('#novaSetupCard .nsw-row').length > 0, null, { timeout: 10000 });
    await p2.close();
  }

  // 5. No uncaught page errors
  assert.deepEqual(pageErrors, [], `Page errors occurred: ${pageErrors.join(' | ')}`);

  console.log('PASS: lazy-batch-A (5 lazy, 1 eager, 0 errors)');
} finally {
  if (browser) await browser.close();
  server.close();
}

