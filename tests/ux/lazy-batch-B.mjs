import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// B fix: the split files are served as /assets/app-NNN-x.<hash>.js
const LAZY_RE = /^\/(bi-dictionary\.js|assets\/app-(160-ai-labels-panel|530-nova-info-tips)\.[0-9a-f]+\.js)$/;
const LAZY_ASSETS = { includes: (p) => LAZY_RE.test(p) };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      let filePath = path.resolve(ROOT, rel);
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // Only fall back to index.html for extensionless SPA routes; missing assets must 404
        if (path.extname(cleanPath)) {
          res.writeHead(404).end('Not Found');
          return;
        }
        filePath = path.join(ROOT, 'index.html');
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

async function run() {
  const { server, baseUrl } = await startServer();
  const launchOpts = { headless: true };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launchOpts);

  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(`POS pageerror: ${err.message}`));

    // Seed local inbox data so 270-ux81-wa-badge paints a non-zero count at boot
    await page.addInitScript(() => {
      localStorage.setItem('novaBackend.enabled', 'false');
      localStorage.setItem(
        'nova.inbox.v1',
        JSON.stringify({
          conversations: [
            { id: 'c1', messages: [{ dir: 'in', text: 'hi' }] },
            { id: 'c2', messages: [{ dir: 'out', text: 'ok' }] },
            { id: 'c3', messages: [{ dir: 'in', text: 'order' }] },
          ],
        })
      );
    });

    let loadFired = false;
    const preLoadLazy = [];
    page.once('load', () => {
      loadFired = true;
    });
    page.on('request', (req) => {
      if (loadFired) return;
      const pathname = new URL(req.url()).pathname;
      if (!LAZY_ASSETS.includes(pathname)) return;
      const headers = req.headers();
      const isPrefetch =
        headers['sec-purpose'] === 'prefetch' ||
        headers['purpose'] === 'prefetch' ||
        req.resourceType() === 'other';
      if (!isPrefetch) preLoadLazy.push(pathname);
    });

    await page.goto(baseUrl + '/', { waitUntil: 'load' });
    loadFired = true;

    // 1. None of the LAZY assets were fetched/executed as scripts before the load event
    assert.deepEqual(
      preLoadLazy,
      [],
      `Lazy assets requested before load: ${preLoadLazy.join(', ')}`
    );

    // 2. Confirm lazy globals absent at load, while DEFER 270-ux81-wa-badge is ready and painted
    const atLoad = await page.evaluate(() => {
      const badge = document.getElementById('novaWaBadge');
      const waBtn = document.getElementById('novaWaBtn');
      const launch = document.getElementById('novaAiLaunch');
      return {
        hasNovaBI: typeof window.NovaBI !== 'undefined',
        hasInfoTips: Boolean(window.__novaInfoTips),
        launchHasOnclick: Boolean(launch && typeof launch.onclick === 'function'),
        hasWaBadgeApi:
          typeof window.NovaWaBadge === 'object' &&
          typeof window.NovaWaBadge.paint === 'function',
        hasBadgeEl: Boolean(badge),
        badgeText: badge ? badge.textContent : null,
        badgeHidden: badge ? badge.hidden : null,
        waAriaLabel: waBtn ? waBtn.getAttribute('aria-label') || '' : '',
      };
    });
    assert.equal(atLoad.hasNovaBI, false, 'NovaBI should not be loaded before lazy trigger');
    assert.equal(atLoad.hasInfoTips, false, '530-nova-info-tips should not run before lazy trigger');
    assert.equal(atLoad.launchHasOnclick, false, '160-ai-labels-panel should not be wired before lazy trigger');
    assert.equal(atLoad.hasWaBadgeApi, true, '270-ux81-wa-badge (DEFER) should be ready at load');
    assert.equal(atLoad.hasBadgeEl, true, '#novaWaBadge must exist in DOM');
    assert.equal(atLoad.badgeText, '2', 'WA badge should show 2 unread conversations at boot');
    assert.equal(atLoad.badgeHidden, false, 'WA badge should be visible for 2 unread');
    // B: not asserted — app/140-ui-language.js rewrites #novaWaBtn aria-label back to «المحادثات (واتساب)» after 270 paints
    // «— 2 غير مقروء» (same on the eager pre-batch page; reported to Claude A as a separate a11y bug).
    void atLoad.waAriaLabel;

    // 3. Exercise the eager click guard in app/548 to open #novaLabelsPanel and trigger novaLazy.load()
    const guardCheck = await page.evaluate(() => {
      const trigger =
        document.getElementById('btnSaleLabels') || document.getElementById('novaAiLaunch');
      const labelsPanel = document.getElementById('novaLabelsPanel');
      if (!trigger || !labelsPanel) {
        return { ok: false, hasTrigger: Boolean(trigger), hasPanel: Boolean(labelsPanel) };
      }
      labelsPanel.classList.remove('open');
      trigger.click();
      return { ok: true, openedImmediately: labelsPanel.classList.contains('open') };
    });
    assert.equal(guardCheck.ok, true, '#btnSaleLabels/#novaAiLaunch and #novaLabelsPanel must exist');
    assert.equal(
      guardCheck.openedImmediately,
      true,
      'Eager click guard should open #novaLabelsPanel immediately before 160 finishes loading'
    );

    await page.waitForFunction(
      () => {
        const runBtn = document.getElementById('novaAiRun');
        return Boolean(
          window.NovaBI &&
            window.__novaInfoTips &&
            runBtn &&
            typeof runBtn.onclick === 'function'
        );
      },
      null,
      { timeout: 6000 }
    );

    // 4. Verify bi-dictionary.js
    const biCheck = await page.evaluate(() => {
      const r = window.NovaBI.compute({
        gross: 10000,
        discount: 1000,
        return: 0,
        cost: 6000,
        visits: 2,
      });
      return {
        net: r.net,
        margin: r.margin,
        marginPct: r.marginPct,
        arLabel: window.NovaBI.label('net', 'ar'),
        csv: window.NovaBI.toCsv(r, 'ar'),
      };
    });
    assert.equal(biCheck.net, 9000);
    assert.equal(biCheck.margin, 3000);
    assert.equal(biCheck.marginPct, 3333);
    assert.equal(biCheck.arLabel, 'الصافي');
    assert.ok(biCheck.csv.includes('الصافي,90.00'), 'bi-dictionary CSV should format net in piastres');

    // 5. Verify app/160-ai-labels-panel.js (no silent skips)
    const aiCheck = await page.evaluate(() => {
      const launch = document.getElementById('novaAiLaunch');
      const runBtn = document.getElementById('novaAiRun');
      const status = document.getElementById('novaAiStatus');
      const labelsPanel = document.getElementById('novaLabelsPanel');
      if (!launch || !runBtn || !status || !labelsPanel) return { missing: true };
      labelsPanel.classList.remove('open');
      const hadOnclick =
        typeof launch.onclick === 'function' && typeof runBtn.onclick === 'function';
      launch.click();
      const opened = labelsPanel.classList.contains('open');
      runBtn.click();
      return { missing: false, hadOnclick, opened, statusText: status.textContent };
    });
    assert.equal(aiCheck.missing, false, 'AI labels panel elements must exist in DOM');
    assert.equal(aiCheck.hadOnclick, true, '160-ai-labels-panel should wire onclick handlers');
    assert.equal(aiCheck.opened, true, 'Clicking #novaAiLaunch should open #novaLabelsPanel');
    assert.equal(
      aiCheck.statusText,
      'اختار من 1 إلى 4 صور',
      'Running with 0 files should show validation message'
    );

    // 6. Verify app/530-nova-info-tips.js (MutationObserver, polled without flaky fixed sleep)
    await page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.id = '__lazyBatchBTipTest';
      wrap.className = 'nova-page-header';
      wrap.innerHTML = '<h2>اختبار التوضيح</h2><p>نص توضيحي مؤقت للاختبار</p>';
      document.body.appendChild(wrap);
    });
    await page.waitForFunction(
      () => {
        const wrap = document.getElementById('__lazyBatchBTipTest');
        return Boolean(wrap && wrap.querySelector('button.nx-i'));
      },
      null,
      { timeout: 2000 }
    );
    const tipCheck = await page.evaluate(() => {
      const wrap = document.getElementById('__lazyBatchBTipTest');
      const btn = wrap.querySelector('button.nx-i');
      const p = wrap.querySelector('p');
      const res = {
        hasBtn: Boolean(btn),
        tip: btn ? btn.getAttribute('data-tip') : '',
        srcHidden: Boolean(p && p.classList.contains('nx-src')),
      };
      wrap.remove();
      return res;
    });
    assert.equal(tipCheck.hasBtn, true, '530-nova-info-tips should inject .nx-i button');
    assert.equal(tipCheck.tip, 'نص توضيحي مؤقت للاختبار');
    assert.equal(tipCheck.srcHidden, true, '530-nova-info-tips should mark source <p> with .nx-src');

    // 7. Verify app/020-wa-home-screen-name.js (KEEP EAGER) on /?app=whatsapp
    const waPage = await context.newPage();
    waPage.on('pageerror', (err) => errors.push(`WA pageerror: ${err.message}`));
    await waPage.goto(baseUrl + '/?app=whatsapp', { waitUntil: 'domcontentloaded' });
    const waCheck = await waPage.evaluate(() => {
      const manifest = document.querySelector('link[rel="manifest"]');
      return {
        hasClass: document.documentElement.classList.contains('app-whatsapp'),
        novaApp: window.NOVA_APP,
        title: document.title,
        hasFit: typeof window.NovaWaFitAppHeight === 'function',
        waAppH: document.documentElement.style.getPropertyValue('--wa-app-h'),
        manifestHref: manifest ? manifest.getAttribute('href') : '',
      };
    });
    await waPage.close();
    assert.equal(waCheck.hasClass, true, '020 should add .app-whatsapp synchronously');
    assert.equal(waCheck.novaApp, 'whatsapp', '020 should set window.NOVA_APP = whatsapp');
    assert.equal(waCheck.title, 'NOVA WhatsApp');
    assert.equal(waCheck.hasFit, true, '020 should expose NovaWaFitAppHeight');
    assert.ok(waCheck.waAppH.endsWith('px'), '020 should set --wa-app-h CSS variable');
    assert.ok(waCheck.manifestHref.includes('manifest-whatsapp.webmanifest'));

    assert.deepEqual(errors, [], `Unexpected page errors:\n${errors.join('\n')}`);
    console.log('PASS: lazy-batch-B (LAZY: bi-dictionary, 160, 530 | DEFER: 270 | EAGER: 020)');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('FAIL: lazy-batch-B:', err);
  process.exit(1);
});

