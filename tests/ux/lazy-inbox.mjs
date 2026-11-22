// tests/ux/lazy-inbox.mjs
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
  const urlPath = (req.url || '/').split('?')[0];
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });

  // 1) POS boot: 230-inbox-wa must NOT be requested as a script or executed before load; zero page errors
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    const scriptReqsBeforeLoad = [];
    let loaded = false;

    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (req) => {
      if (!loaded && req.url().includes('230-inbox-wa') && req.resourceType() === 'script') {
        scriptReqsBeforeLoad.push(req.url());
      }
    });

    await page.goto(baseUrl + '/', { waitUntil: 'load' });
    loaded = true;
    await page.waitForSelector('.pos-root', { state: 'visible', timeout: 10000 });

    const preState = await page.evaluate(() => ({
      stubbed: !!(window.NovaOpenInbox && window.NovaOpenInbox._stub),
      scriptTagExists: !!document.querySelector('script[src*="230-inbox-wa"]'),
      prefetchExists: !!document.querySelector('link[rel="prefetch"][as="script"][data-nova-lazy][href*="230-inbox-wa"]'),
      inboxTabExists: !!document.getElementById('novaInboxTab'),
      posVisible: !!document.querySelector('.pos-root') && !document.querySelector('.pos-root').hidden
    }));

    assert.deepEqual(errors, [], `Unexpected page errors at POS boot: ${errors.join('; ')}`);
    assert.deepEqual(scriptReqsBeforeLoad, [], '230-inbox-wa must not be requested as a script before load');
    assert.equal(preState.prefetchExists, true, '230-inbox-wa must be declared as data-nova-lazy prefetch link');
    assert.equal(preState.scriptTagExists, false, '230-inbox-wa <script> must not be injected before load');
    assert.equal(preState.stubbed, true, 'NovaOpenInbox must be stubbed at POS boot');
    assert.equal(preState.inboxTabExists, false, '#novaInboxTab must not exist at POS boot');
    assert.equal(preState.posVisible, true, 'POS .pos-root must be visible at boot');

    // 2) Calling NovaOpenInbox() (even twice rapidly) loads 230 once and opens the inbox
    await page.evaluate(() => {
      window.NovaOpenInbox();
      window.NovaOpenInbox();
    });
    await page.waitForSelector('#novaInboxView:not([hidden])', { timeout: 10000 });

    const postState = await page.evaluate(() => ({
      stubbed: !!(window.NovaOpenInbox && window.NovaOpenInbox._stub),
      inboxTabExists: !!document.getElementById('novaInboxTab'),
      inboxVisible: !!document.getElementById('novaInboxView') && !document.getElementById('novaInboxView').hidden
    }));

    assert.deepEqual(errors, [], `Unexpected page errors after NovaOpenInbox(): ${errors.join('; ')}`);
    assert.equal(postState.stubbed, false, '230-inbox-wa must replace the stub after loading');
    assert.equal(postState.inboxTabExists, true, '#novaInboxTab must exist after opening inbox');
    assert.equal(postState.inboxVisible, true, '#novaInboxView must be visible after opening inbox');
    await ctx.close();
  }

  // 3) Direct /#wa navigation (notification click, UX406) loads 230 right away — not after the 2.5 s idle timer — and
  //    opens the inbox by itself (app/130), inside the full app (wa-app-mode.mjs).
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { window.requestIdleCallback = () => 0; });   // the idle fallback never fires here

    await page.goto(baseUrl + '/#wa', { waitUntil: 'load' });
    await page.waitForFunction(() => window.NovaOpenInbox && !window.NovaOpenInbox._stub, null, { timeout: 2000 });
    await page.waitForSelector('#novaInboxView:not([hidden])', { timeout: 5000 });   // no click: /#wa opens it
    assert.deepEqual(errors, [], `Unexpected page errors on /#wa: ${errors.join('; ')}`);
    await ctx.close();
  }

  // 4) Standalone /?app=whatsapp loads 230 immediately and enters WA-APP mode
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(baseUrl + '/?app=whatsapp', { waitUntil: 'load' });
    await page.waitForSelector('#novaInboxView:not([hidden])', { timeout: 2000 });
    const waApp = await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp'));
    assert.equal(waApp, true, '/?app=whatsapp must activate app-whatsapp mode');
    assert.deepEqual(errors, [], `Unexpected page errors on /?app=whatsapp: ${errors.join('; ')}`);
    await ctx.close();
  }

  console.log('PASS: lazy-inbox.mjs');
} finally {
  if (browser) await browser.close();
  server.close();
}

