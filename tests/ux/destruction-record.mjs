// tests/ux/destruction-record.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
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
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
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
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

(async () => {
  const { server, url } = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const pageErrors = [];

  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__nova_test_cleared__')) {
        localStorage.clear();
        sessionStorage.setItem('__nova_test_cleared__', '1');
      }
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.novaLazy.load());

    const result = await page.evaluate(async () => {
      // Corrupt JSON in localStorage must not crash
      localStorage.setItem('nova-rx-destruction-v1', '{bad-json');
      const corruptList = window.novaDestruction.list();
      localStorage.removeItem('nova-rx-destruction-v1');

      const product = window.NOVA_DEMO.products[0];
      const key = window.novaStock.keyOf(product);

      window.novaStock.addLot({ key: key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 });
      window.novaStock.addLot({ key: key, lot: 'VAL-LOT-1', expiry: '2035-12-31', qty: 5, cost: 12 });

      const expired = window.novaDestruction.expiredLots();
      const matchingExpired = expired.filter((l) => l.key === key);

      const origRequire = window.novaPerms && window.novaPerms.require;
      window.novaPerms = window.novaPerms || {};

      // 1. Permission false must be refused
      window.novaPerms.require = () => false;
      let permFalseRefused = false;
      try {
        await window.novaDestruction.create({
          lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 }],
          witnesses: ['أحمد محمود'],
          note: 'test'
        });
      } catch (e) {
        permFalseRefused = /^(ليس لديك صلاحية|Permission denied)/.test(String(e && e.message));
      }

      // 2. Permission throwing must be refused (fail closed)
      window.novaPerms.require = () => {
        throw new Error('perm-boom');
      };
      let permThrowRefused = false;
      try {
        await window.novaDestruction.create({
          lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 }],
          witnesses: ['أحمد محمود'],
          note: 'test'
        });
      } catch (e) {
        permThrowRefused = /^(ليس لديك صلاحية|Permission denied)/.test(String(e && e.message));
      }

      // Allow stock.adjust for subsequent validation & creation tests
      window.novaPerms.require = origRequire || (() => true);
      let allowed = false;
      try {
        allowed = !!window.novaPerms.require('stock.adjust');
      } catch (e) {
        allowed = false;
      }
      if (!allowed) {
        window.novaPerms.require = (p) => p === 'stock.adjust';
      }

      // 3. Create without witness must be refused (with permission granted)
      let noWitnessRefused = false;
      try {
        await window.novaDestruction.create({
          lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 }],
          witnesses: [],
          note: 'test'
        });
      } catch (e) {
        noWitnessRefused = true;
      }

      // 4. Duplicate lot lines exceeding onHand must be refused
      let overQtyRefused = false;
      try {
        await window.novaDestruction.create({
          lines: [
            { key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 2, cost: 10 },
            { key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 2, cost: 10 }
          ],
          witnesses: ['أحمد محمود'],
          note: 'test'
        });
      } catch (e) {
        overQtyRefused = true;
      }

      // 5. If novaItemCard.adjust rejects, record must NOT be saved
      const origAdjust = window.novaItemCard.adjust;
      window.novaItemCard.adjust = () => Promise.reject(new Error('adjust-failed'));
      let adjustRejectHandled = false;
      try {
        await window.novaDestruction.create({
          id: 'DST-FAIL-140',
          lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 }],
          witnesses: ['أحمد محمود'],
          note: 'test'
        });
      } catch (e) {
        adjustRejectHandled = true;
      }
      const savedAfterReject = window.novaDestruction.list().length;

      // 6. Spy on novaItemCard.adjust to verify creation (with Arabic-Indic qty) + idempotency
      let adjustCalls = 0;
      window.novaItemCard.adjust = function (payload) {
        adjustCalls += 1;
        return origAdjust.call(window.novaItemCard, payload);
      };

      const fixedId = 'DST-TEST-140';
      const rec1 = await window.novaDestruction.create({
        id: fixedId,
        lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: '٣', cost: 10 }],
        witnesses: ['أحمد محمود', 'سارة علي'],
        note: 'إعدام تجريبي'
      });

      // Second call with same id must not double-remove or re-call adjust
      const rec2 = await window.novaDestruction.create({
        id: fixedId,
        lines: [{ key, lot: 'EXP-LOT-1', expiry: '2020-01-31', qty: 3, cost: 10 }],
        witnesses: ['أحمد محمود', 'سارة علي'],
        note: 'إعدام تجريبي'
      });

      window.novaItemCard.adjust = origAdjust;

      const lotsAfter = window.novaStock.lots(key);
      const expLotAfter = lotsAfter.find((l) => l.lot === 'EXP-LOT-1');
      const valLotAfter = lotsAfter.find((l) => l.lot === 'VAL-LOT-1');
      const saved = window.novaDestruction.list();

      return {
        corruptListLen: Array.isArray(corruptList) ? corruptList.length : -1,
        matchingExpired,
        permFalseRefused,
        permThrowRefused,
        noWitnessRefused,
        overQtyRefused,
        adjustRejectHandled,
        savedAfterReject,
        adjustCalls,
        rec1,
        rec2,
        expOnHand: expLotAfter ? expLotAfter.onHand : 0,
        valOnHand: valLotAfter ? valLotAfter.onHand : 0,
        savedCount: saved.length,
        savedTotalCost: saved[0] ? saved[0].totalCost : null
      };
    });

    assert.strictEqual(result.corruptListLen, 0, 'Corrupt localStorage JSON must return empty array');
    assert.strictEqual(result.matchingExpired.length, 1, 'Only expired lot should be returned');
    assert.strictEqual(result.matchingExpired[0].lot, 'EXP-LOT-1', 'Returned lot should be the expired one');
    assert.strictEqual(result.permFalseRefused, true, 'Create with permission=false must be refused');
    assert.strictEqual(result.permThrowRefused, true, 'Create when permission throws must be refused');
    assert.strictEqual(result.noWitnessRefused, true, 'Create without witness must be refused');
    assert.strictEqual(result.overQtyRefused, true, 'Duplicate lines exceeding onHand must be refused');
    assert.strictEqual(result.adjustRejectHandled, true, 'Create must reject when adjust rejects');
    assert.strictEqual(result.savedAfterReject, 0, 'Record must not be saved when adjust rejects');
    assert.strictEqual(result.rec1.totalCost, 30, 'Record totalCost should be 30');
    assert.strictEqual(result.savedTotalCost, 30, 'Saved record totalCost should be 30');
    assert.strictEqual(result.expOnHand, 0, 'Expired lot onHand should be 0 after destruction');
    assert.strictEqual(result.valOnHand, 5, 'Valid lot onHand should remain untouched');
    assert.strictEqual(result.adjustCalls, 1, 'Duplicate create with same id must not call adjust twice');
    assert.strictEqual(result.savedCount, 1, 'Duplicate create with same id must not save twice');
    assert.strictEqual(result.rec2.id, result.rec1.id, 'Duplicate create should return original record');

    // Navigate to products page and verify card renders + no overflow at 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page="products"]'); if (t) t.click(); });
    await page.evaluate(id => window.novaPageViews.openTool(id), 'novaDestruction'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
    await page.waitForSelector('#novaDestruction', { state: 'visible', timeout: 5000 });
    const visible = await page.isVisible('#novaDestruction');
    assert.strictEqual(visible, true, '#novaDestruction card must be visible on products page');

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.innerWidth,
      `Page overflows at 390px: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`
    );

    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.map((e) => e.message).join('; ')}`);
    console.log('destruction-record PASS');
  } finally {
    await browser.close();
    server.close();
  }
})();