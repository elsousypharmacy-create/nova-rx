/* tests/ux/fridge-log.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
      const fullPath = path.resolve(ROOT, rel);
      if (fullPath !== ROOT && !fullPath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function run() {
  const { server, url } = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined
  });
  const errors = [];

  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__novaTestCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__novaTestCleared', '1');
      }
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.novaLazy.load());

    const apiResult = await page.evaluate(() => {
      const api = window.novaFridgeLog;
      const origAuth = window.novaAuth;

      // Fail-closed auth checks
      window.novaAuth = { current: () => null };
      const signedOutRes = api.add({ temp: 5.2 });

      window.novaAuth = { current: () => { throw new Error('auth fail'); } };
      const authThrowRes = api.add({ temp: 5.2 });

      window.novaAuth = null;
      const authMissingRes = api.add({ temp: 5.2 });

      // Restore or sign in a pharmacist user for normal writes
      window.novaAuth = origAuth;
      if (!window.novaAuth || typeof window.novaAuth.current !== 'function' || !window.novaAuth.current()) {
        window.novaAuth = { current: () => ({ name: 'د. أحمد', role: 'pharmacist' }) };
      }

      // Corrupt JSON resilience
      localStorage.setItem('nova-rx-fridge-log-v1', '{bad json');
      const corruptList = api.list();
      localStorage.removeItem('nova-rx-fridge-log-v1');

      const now = new Date();
      const morningMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30, 0).getTime();
      const eveningMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 15, 0).getTime();

      const okRes = api.add({ temp: 5.2, time: morningMs });
      const arabicDigitsRes = api.add({ temp: '٥.٤', time: morningMs + 60000 });
      const refusedRes = api.add({ temp: 9.1 });
      const lowRefusedRes = api.add({ temp: 1.5 });
      const tooLowRes = api.add({ temp: -11, note: 'عطل' });
      const tooHighRes = api.add({ temp: 31, note: 'عطل' });
      const flaggedRes = api.add({ temp: '٩٫١', note: 'تم ضبط الترموستات', time: eveningMs });

      const oor = api.outOfRange();
      const done = api.todayDone();
      const morningOnly = api.list(morningMs, morningMs + 120000);
      const apiKeys = Object.keys(api).sort();

      return {
        signedOutRes,
        authThrowRes,
        authMissingRes,
        corruptList,
        okRes,
        arabicDigitsRes,
        refusedRes,
        lowRefusedRes,
        tooLowRes,
        tooHighRes,
        flaggedRes,
        oor,
        done,
        morningOnly,
        apiKeys
      };
    });

    assert.equal(apiResult.signedOutRes.ok, false, 'signed-out add must be refused');
    assert.equal(apiResult.authThrowRes.ok, false, 'throwing novaAuth.current must fail closed');
    assert.equal(apiResult.authMissingRes.ok, false, 'missing novaAuth must fail closed');
    assert.deepEqual(apiResult.corruptList, [], 'corrupt JSON must not crash');

    assert.equal(apiResult.okRes.ok, true, '5.2 should be accepted');
    assert.equal(apiResult.okRes.record.flagged, false, '5.2 should not be flagged');
    assert.equal(apiResult.arabicDigitsRes.ok, true, 'Arabic-Indic ٥.٤ should be accepted');
    assert.equal(apiResult.arabicDigitsRes.record.temp, 5.4, 'Arabic-Indic ٥.٤ should parse to 5.4');

    assert.equal(apiResult.refusedRes.ok, false, '9.1 without note must be refused');
    assert.equal(apiResult.lowRefusedRes.ok, false, '1.5 without note must be refused');
    assert.equal(apiResult.tooLowRes.ok, false, '-11 must be refused');
    assert.equal(apiResult.tooHighRes.ok, false, '31 must be refused');

    assert.equal(apiResult.flaggedRes.ok, true, '9.1 with note should be accepted');
    assert.equal(apiResult.flaggedRes.record.temp, 9.1, 'Arabic-Indic ٩٫١ should parse to 9.1');
    assert.equal(apiResult.flaggedRes.record.flagged, true, '9.1 should be flagged');

    assert.equal(apiResult.oor.length, 1, 'outOfRange() should list the 9.1 reading');
    assert.equal(apiResult.oor[0].temp, 9.1, 'outOfRange() entry should be 9.1');
    assert.equal(apiResult.done.morning, true, 'todayDone().morning should be true for reading before 12:00');
    assert.equal(apiResult.done.evening, true, 'todayDone().evening should be true for reading after 18:00');
    assert.equal(apiResult.morningOnly.length, 2, 'list(fromMs, toMs) should filter by time window');
    assert.deepEqual(apiResult.apiKeys, ['add', 'list', 'outOfRange', 'todayDone'], 'API must be append-only');

    await page.evaluate(() => { try { sessionStorage.setItem('nova.reportsTab', 'shift'); } catch {} }); // UI-BATCH1: reports tabs
    await page.click('.nova-tab[data-page="reports"]');
    await page.waitForSelector('#novaFridgeLog', { state: 'visible', timeout: 5000 });

    await page.setViewportSize({ width: 390, height: 844 });
    const uiCheck = await page.evaluate(() => {
      const card = document.getElementById('novaFridgeLog');
      return {
        visible: !!card && card.offsetHeight > 0,
        hasFlaggedRow: !!card && card.querySelectorAll('tr.nfl-bad').length > 0,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth
      };
    });

    assert.equal(uiCheck.visible, true, '#novaFridgeLog should be visible at 390px');
    assert.equal(uiCheck.hasFlaggedRow, true, 'flagged reading should be highlighted red');
    assert.equal(uiCheck.noOverflow, true, 'page must not overflow horizontally at 390px');

    assert.equal(errors.length, 0, `Unexpected page errors: ${errors.join('; ')}`);
    console.log('fridge-log PASS');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});