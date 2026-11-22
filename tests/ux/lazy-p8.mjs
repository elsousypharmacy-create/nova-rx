import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const ASSET = '260-sale06-onboarding.js';
// B fix: the real URL is /assets/app-260-sale06-onboarding.<hash>.js
const ASSET_RE = /app-260-sale06-onboarding\.[0-9a-f]+\.js/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, rel);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function isPrefetchRequest(req) {
  const h = req.headers();
  return h['sec-purpose'] === 'prefetch' || h['purpose'] === 'prefetch';
}

const server = await startServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined
});

try {
  // --- Scenario 1: Default-OFF boot (production default) ---
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    const eagerBeforeLoad = [];
    let loaded = false;

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      if (!loaded && ASSET_RE.test(req.url()) && !isPrefetchRequest(req)) {
        eagerBeforeLoad.push(`${req.resourceType()}:${req.url()}`);
      }
    });

    await page.goto(baseUrl, { waitUntil: 'load' });
    loaded = true;

    assert.equal(eagerBeforeLoad.length, 0, `${ASSET} eagerly requested before load: ${eagerBeforeLoad.join(', ')}`);
    assert.equal(await page.evaluate(() => typeof window.novaOnboarding), 'undefined', 'novaOnboarding should be undefined at load');

    const hiddenBeforeLoad = await page.evaluate(() => {
      const el = document.getElementById('novaOnboardingCard');
      return !el || el.hidden === true;
    });
    assert.equal(hiddenBeforeLoad, true, '#novaOnboardingCard must stay hidden before lazy load when default-OFF');

    await page.evaluate(() => { location.hash = '#settings'; });
    await page.waitForFunction(() => typeof window.novaOnboarding === 'object', { timeout: 10000 });

    const hiddenAfterLoad = await page.evaluate(() => {
      const el = document.getElementById('novaOnboardingCard');
      return !el || (el.hidden === true && el.innerHTML === '');
    });
    assert.equal(hiddenAfterLoad, true, '#novaOnboardingCard must remain hidden & empty after load when default-OFF');
    assert.equal(pageErrors.length, 0, `Unexpected page errors (default-OFF): ${pageErrors.join(' | ')}`);
    await context.close();
  }

  // --- Scenario 2: Enabled (local mode) mounts & creates sandbox after lazy load ---
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    const eagerBeforeLoad = [];
    let loaded = false;
    let loadedAsScriptAfter = false;

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      if (!ASSET_RE.test(req.url())) return;
      if (!isPrefetchRequest(req)) {
        if (!loaded) eagerBeforeLoad.push(`${req.resourceType()}:${req.url()}`);
        else loadedAsScriptAfter = true;
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('novaOnboarding.enabled', 'true');
    });

    await page.goto(baseUrl, { waitUntil: 'load' });
    loaded = true;

    assert.equal(eagerBeforeLoad.length, 0, `${ASSET} eagerly requested before load: ${eagerBeforeLoad.join(', ')}`);
    assert.equal(await page.evaluate(() => typeof window.novaOnboarding), 'undefined', 'novaOnboarding should be undefined at load');

    await page.evaluate(() => { location.hash = '#settings'; });
    await page.waitForFunction(
      () => typeof window.novaOnboarding === 'object' && typeof window.novaOnboarding.mount === 'function',
      { timeout: 10000 }
    );
    assert.equal(loadedAsScriptAfter, true, `${ASSET} should be fetched as a script after navigating to #settings`);

    // Verify card auto-mounted and unhid itself
    await page.waitForSelector('#novaOnboardingCard #novaOnbSandbox', { state: 'attached', timeout: 10000 });
    const cardUnhidden = await page.evaluate(() => {
      const el = document.getElementById('novaOnboardingCard');
      return !!el && el.hidden === false;
    });
    assert.equal(cardUnhidden, true, '#novaOnboardingCard should be unhidden after lazy mount when enabled');

    // If 470-ux-p38-settings-sections collapsed/hid the 'setup' section, reveal it before clicking
    if (!(await page.isVisible('#novaOnbSandbox'))) {
      await page.evaluate(() => {
        const card = document.getElementById('novaOnboardingCard');
        let p = card && card.parentElement;
        while (p) {
          if (p.tagName === 'DETAILS') p.open = true;
          p = p.parentElement;
        }
        const tab = document.querySelector('[data-section="setup"], [data-settings-section="setup"], button[aria-controls*="setup"]');
        if (tab) tab.click();
      });
    }

    await page.waitForSelector('#novaOnbSandbox', { state: 'visible', timeout: 5000 });
    await page.click('#novaOnbSandbox');
    await page.waitForSelector('#novaOnbResult[data-kind="ok"]', { timeout: 5000 });
    await page.waitForSelector('#novaOnbTenantState[data-status="active"]', { timeout: 5000 });

    assert.equal(pageErrors.length, 0, `Unexpected page errors (enabled): ${pageErrors.join(' | ')}`);
    await context.close();
  }

  console.log('PASS: lazy-p8 (260-sale06-onboarding.js deferred until after load, stays hidden when OFF, mounts & creates sandbox when ON)');
} finally {
  await browser.close();
  server.closeAllConnections?.();
  server.close();
}

