// tests/ux/lazy-inbox-lib.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT_PREFIX = ROOT + path.sep;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let loadFired = false;
const early220Reqs = [];

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (!loadFired && urlPath.includes('app-220-fix43-inbox-lib')) {
    const secPurpose = String(req.headers['sec-purpose'] || '').toLowerCase();
    const purpose = String(req.headers['purpose'] || '').toLowerCase();
    if (secPurpose !== 'prefetch' && purpose !== 'prefetch') {
      early220Reqs.push(urlPath);
    }
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel);
  if (filePath !== ROOT && !filePath.startsWith(ROOT_PREFIX) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();

  const pageErrors = [];
  const badAssetStatuses = [];

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('load', () => { loadFired = true; });
  page.on('response', (res) => {
    const u = res.url();
    if ((u.includes('app-220-fix43-inbox-lib') || u.includes('app-230-inbox-wa')) && res.status() >= 400) {
      badAssetStatuses.push(`${res.status()} ${u}`);
    }
  });

  // 1) Boot to load: 220 must be a lazy prefetch link BEFORE 230, not eagerly requested/executed
  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  loadFired = true;

  const atLoad = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="prefetch"][as="script"][data-nova-lazy]'));
    const hrefs = links.map((el) => el.getAttribute('href') || '');
    return {
      hasLib: typeof window.NovaUnifiedInbox !== 'undefined',
      stubbed: !!(window.NovaOpenInbox && window.NovaOpenInbox._stub),
      eagerScript: !!document.querySelector('script[src*="app-220-fix43-inbox-lib"]'),
      idx220: hrefs.findIndex((h) => h.includes('app-220-fix43-inbox-lib')),
      idx230: hrefs.findIndex((h) => h.includes('app-230-inbox-wa'))
    };
  });

  assert.equal(early220Reqs.length, 0, '220 script must not be requested eagerly before load: ' + early220Reqs.join(', '));
  assert.equal(atLoad.eagerScript, false, '220 must not be an eager <script> tag at load');
  assert.ok(atLoad.idx220 >= 0, '220 must have a link[rel="prefetch"][as="script"][data-nova-lazy] tag');
  assert.ok(atLoad.idx230 > atLoad.idx220, `220 (index ${atLoad.idx220}) must appear before 230 (index ${atLoad.idx230}) in document order`);
  assert.equal(atLoad.hasLib, false, 'window.NovaUnifiedInbox must not be defined at load');
  assert.equal(atLoad.stubbed, true, 'NovaOpenInbox stub must still be in place at load');

  // POS sale screen stays instant and visible
  await page.waitForSelector('.pos-root', { state: 'visible', timeout: 10000 });

  // 2) Open Inbox via NovaOpenInbox(): 220 loads before 230 and Inbox renders cleanly
  await page.evaluate(() => window.NovaOpenInbox());
  await page.waitForSelector('#novaInboxView:not([hidden]) [data-wa-root]', { timeout: 10000 });

  const postState = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src') || '');
    const s220 = scripts.findIndex((s) => s.includes('app-220-fix43-inbox-lib'));
    const s230 = scripts.findIndex((s) => s.includes('app-230-inbox-wa'));
    return {
      hasLib: typeof window.NovaUnifiedInbox === 'object' && typeof window.NovaUnifiedInbox.renderWa === 'function',
      stubbed: !!(window.NovaOpenInbox && window.NovaOpenInbox._stub),
      inboxVisible: !!document.getElementById('novaInboxView') && !document.getElementById('novaInboxView').hidden,
      s220,
      s230
    };
  });

  assert.deepEqual(badAssetStatuses, [], 'Inbox lazy assets must load with HTTP 200: ' + badAssetStatuses.join(', '));
  assert.equal(postState.hasLib, true, 'window.NovaUnifiedInbox must be loaded after NovaOpenInbox()');
  assert.equal(postState.stubbed, false, '230-inbox-wa must replace the NovaOpenInbox stub');
  assert.equal(postState.inboxVisible, true, '#novaInboxView must be visible after NovaOpenInbox()');
  if (postState.s220 !== -1 && postState.s230 !== -1) {
    assert.ok(postState.s220 < postState.s230, `Injected 220 script (${postState.s220}) must precede 230 (${postState.s230})`);
  }
  assert.deepEqual(pageErrors, [], 'No pageerror allowed during boot or inbox load');

  console.log('PASS: lazy-inbox-lib.mjs');
} finally {
  await browser.close();
  server.close();
}

