// Startup diet CSS (queue 9b, Gemini draft reviewed by a second account, applied by Claude B): the 6 lazy-only stylesheets
// are not render-blocking, load before the lazy JS in cascade order, and the POS looks identical.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const LAZY_CSS_PATTERNS = [
  /\/supplier-lookup\.css$/,
  /\/assets\/app-180-sticker-studio\.[0-9a-f]+\.css$/,
  /\/assets\/app-200-nova-sticker-oneclick\.[0-9a-f]+\.css$/,
  /\/assets\/app-320-ux430-wa-kpi-css\.[0-9a-f]+\.css$/,
  /\/assets\/app-450-nova-setup-wizard-css\.[0-9a-f]+\.css$/,
  /\/assets\/app-480-ux-p30-receiving\.[0-9a-f]+\.css$/,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rawPath = (req.url || '/').split('?')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }
      let filePath = path.resolve(rootDir, decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''));
      const rel = path.relative(rootDir, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
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
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function isLazyCssUrl(url) {
  try {
    const p = new URL(url).pathname;
    return LAZY_CSS_PATTERNS.some((re) => re.test(p));
  } catch {
    return false;
  }
}

const POS_STYLE_PROPS = [
  'display',
  'backgroundColor',
  'color',
  'fontSize',
  'fontFamily',
  'padding',
  'margin',
  'borderRadius',
  'minHeight',
  'overflowX',
  'borderColor',
];

const { server, url } = await startServer(ROOT);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  // Keep test deterministic and offline-safe (no waiting on Google Fonts or external hosts)
  await page.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith(url) || reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });

  // Record stylesheet readiness at the exact instant the first lazy <script> is appended to body
  await page.addInitScript(() => {
    window.__lazyOrderCheck = { firstLazyScriptSawLoadedCss: null, firstLazyScriptSrc: null };
    const mo = new MutationObserver((mutations) => {
      if (window.__lazyOrderCheck.firstLazyScriptSrc) return;
      const lazyScriptHrefs = new Set(
        Array.from(document.querySelectorAll('link[rel="prefetch"][as="script"][data-nova-lazy]'))
          .map((l) => l.getAttribute('href'))
          .filter(Boolean)
      );
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.tagName === 'SCRIPT' && lazyScriptHrefs.has(node.getAttribute('src'))) {
            const loaded = Array.from(document.querySelectorAll('link[rel="stylesheet"][data-nova-lazy-css-loaded]'));
            window.__lazyOrderCheck.firstLazyScriptSrc = node.getAttribute('src');
            window.__lazyOrderCheck.firstLazyScriptSawLoadedCss = loaded.filter((l) => {
              try { return !!(l.sheet && l.sheet.cssRules.length > 0); } catch { return false; }
            }).length;
            mo.disconnect();
            return;
          }
        }
      }
    });
    const startObserve = () => {
      if (document.body) mo.observe(document.body, { childList: true });
      else document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true }), { once: true });
    };
    startObserve();
  });

  const pageErrors = [];
  const blockingStylesheetRequestsBeforeLazy = [];
  let lazyTriggered = false;

  page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));
  page.on('request', (req) => {
    if (lazyTriggered) return;
    const headers = req.headers();
    const isPrefetch = headers['purpose'] === 'prefetch' || headers['sec-purpose'] === 'prefetch';
    if (!isPrefetch && req.resourceType() === 'stylesheet' && isLazyCssUrl(req.url())) {
      blockingStylesheetRequestsBeforeLazy.push(req.url());
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // 1. Assert lazy CSS was NOT requested as a stylesheet or attached before novaLazy.load()
  assert.deepEqual(
    blockingStylesheetRequestsBeforeLazy,
    [],
    `Lazy CSS requested as stylesheet before novaLazy.load(): ${blockingStylesheetRequestsBeforeLazy.join(', ')}`
  );

  const preCheck = await page.evaluate((patterns) => {
    const res = patterns.map((src) => new RegExp(src));
    const prefetches = document.querySelectorAll('link[rel="prefetch"][as="style"][data-nova-lazy-css]').length;
    const loadedLazy = document.querySelectorAll('link[rel="stylesheet"][data-nova-lazy-css-loaded]').length;
    const activeLazySheets = Array.from(document.styleSheets)
      .map((s) => s.href || '')
      .filter((href) => {
        try { return res.some((re) => re.test(new URL(href).pathname)); } catch { return false; }
      });
    return {
      prefetches,
      loadedLazy,
      activeLazySheets,
      hasApi: !!(window.novaLazy && typeof window.novaLazy.load === 'function'),
    };
  }, LAZY_CSS_PATTERNS.map((r) => r.source));

  assert.equal(preCheck.prefetches, 6, `Expected 6 lazy CSS prefetch links, found ${preCheck.prefetches}`);
  assert.equal(preCheck.loadedLazy, 0, 'Lazy CSS stylesheets should not be attached before load');
  assert.deepEqual(preCheck.activeLazySheets, [], `Lazy CSS already in document.styleSheets: ${preCheck.activeLazySheets.join(', ')}`);
  assert.equal(preCheck.hasApi, true, 'window.novaLazy.load() must exist');

  // 2. Pin & snapshot 3 key POS elements BEFORE lazy CSS loads
  const posBefore = await page.evaluate((props) => {
    const refs = {
      body: document.body,
      nav: document.querySelector('.nova-nav-row, .nova-nav, nav'),
      posPrimary: document.querySelector('.btn-checkout, .totals-breakdown, .invoice-table, #btnConfirmPayment, main'),
    };
    window.__posTestRefs = refs;
    const out = {};
    for (const [key, el] of Object.entries(refs)) {
      if (!el) throw new Error(`Missing key POS element for snapshot: ${key}`);
      const cs = getComputedStyle(el);
      out[key] = {};
      for (const p of props) out[key][p] = cs[p];
    }
    return out;
  }, POS_STYLE_PROPS);

  // 3. Trigger novaLazy.load()
  lazyTriggered = true;
  await page.evaluate(() => window.novaLazy.load());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Verify all 6 lazy stylesheets are attached, parsed, and loaded BEFORE lazy scripts ran
  const { loadedSheets, orderCheck } = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][data-nova-lazy-css-loaded]'));
    return {
      loadedSheets: links.map((l) => ({
        href: l.getAttribute('href'),
        rules: l.sheet ? l.sheet.cssRules.length : 0,
      })),
      orderCheck: window.__lazyOrderCheck,
    };
  });

  assert.equal(loadedSheets.length, 6, `Expected 6 loaded lazy stylesheets, got ${loadedSheets.length}`);
  for (const s of loadedSheets) {
    assert.ok(s.rules > 0, `Lazy stylesheet ${s.href} loaded with 0 CSS rules`);
  }
  if (orderCheck.firstLazyScriptSrc) {
    assert.equal(
      orderCheck.firstLazyScriptSawLoadedCss,
      6,
      `Expected all 6 lazy CSS files loaded before first lazy script (${orderCheck.firstLazyScriptSrc}), saw ${orderCheck.firstLazyScriptSawLoadedCss}`
    );
  }

  // 4. Snapshot the exact same 3 pinned POS elements AFTER lazy CSS loads — must be identical
  const posAfter = await page.evaluate((props) => {
    const out = {};
    for (const [key, el] of Object.entries(window.__posTestRefs)) {
      const cs = getComputedStyle(el);
      out[key] = {};
      for (const p of props) out[key][p] = cs[p];
    }
    return out;
  }, POS_STYLE_PROPS);

  assert.deepEqual(posAfter, posBefore, 'POS computed styles changed after loading lazy CSS');

  // 5. Verify sticker studio (+ cascade order vs eager 210), receiving, WA KPI, supplier-lookup, and setup wizard are styled
  const screenStyles = await page.evaluate(() => {
    function probe(html, selector, props) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden';
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      try {
        const el = wrap.querySelector(selector);
        const cs = getComputedStyle(el);
        const res = {};
        for (const p of props) res[p] = cs[p];
        return res;
      } finally {
        wrap.remove();
      }
    }
    return {
      sticker: probe(
        '<div id="novaLabelsPanel"><div class="labels-sheet"></div></div>',
        '.labels-sheet',
        ['backgroundColor', 'color']
      ),
      stickerCascade: probe(
        '<div id="novaLabelsPanel"><button id="nlPrintAll" class="is-blocked">Print</button></div>',
        '#nlPrintAll',
        ['backgroundColor']
      ),
      receiving: probe(
        '<div class="rcv"><button class="rcv-btn primary">OK</button></div>',
        '.rcv-btn.primary',
        ['backgroundColor', 'borderRadius']
      ),
      waKpi: probe(
        '<div id="novaWaKpiView"><div id="novaWaKpiCard"></div></div>',
        '#novaWaKpiView',
        ['position', 'backgroundColor']
      ),
      supplierLookup: probe(
        '<div class="sp-row"></div>',
        '.sp-row',
        ['display', 'borderRadius']
      ),
      setupWizard: probe(
        '<div id="novaSetupCard"><div class="nsw-dot">1</div></div>',
        '.nsw-dot',
        ['borderRadius']
      ),
    };
  });

  assert.equal(screenStyles.sticker.backgroundColor, 'rgb(11, 13, 17)', 'Sticker studio CSS (180) not applied');
  assert.equal(screenStyles.stickerCascade.backgroundColor, 'rgb(27, 32, 38)', 'Cascade order broken: eager 210 must override lazy 200');
  assert.equal(screenStyles.receiving.backgroundColor, 'rgb(56, 126, 158)', 'Receiving CSS (480) not applied');
  assert.equal(screenStyles.receiving.borderRadius, '10px', 'Receiving button radius not applied');
  assert.equal(screenStyles.waKpi.position, 'fixed', 'WA KPI view CSS (320) not applied');
  assert.equal(screenStyles.supplierLookup.display, 'grid', 'Supplier lookup CSS not applied');
  assert.equal(screenStyles.setupWizard.borderRadius, '50%', 'Setup wizard CSS (450) not applied');

  // 6. Assert zero page errors
  assert.deepEqual(pageErrors, [], `Page errors detected: ${pageErrors.join(' | ')}`);

  console.log('PASS: lazy-css.mjs — 6 lazy stylesheets deferred, loaded before lazy JS in cascade order, POS unchanged, all screens styled, 0 errors.');
} finally {
  await browser.close();
  server.close();
}
