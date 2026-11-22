// tests/ux/profit-slow.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url || '/').split('?')[0];
      const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const fullPath = path.join(ROOT, rel);
      if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(fullPath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const { server, url } = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  await page.addInitScript(() => {
    if (sessionStorage.getItem('nps_seeded')) return;
    sessionStorage.setItem('nps_seeded', '1');
    const nowIso = new Date().toISOString();
    const seededSales = [
      {
        id: 'sale-a',
        number: 'INV-A',
        at: nowIso,
        subtotal: 250,
        discount: 0,
        total: 250,
        lines: [
          {
            name: 'Sold Demo Item',
            barcode: '__DEMO_P0_BC__',
            unit: 'box',
            unitFactor: 1,
            price: 100,
            qty: 2,
            discount: 0,
            lots: [{ lot: 'L1', expiry: '2030-01-31', qty: 2, cost: 60 }]
          },
          {
            name: 'Second Known Cost Item',
            barcode: 'BC-KNOWN-2',
            unit: 'box',
            unitFactor: 1,
            price: 50,
            qty: 1,
            discount: 0,
            lots: [{ lot: 'L2', expiry: '2030-06-30', qty: 1, cost: 30 }]
          }
        ]
      },
      {
        id: 'sale-b',
        number: 'INV-B',
        at: nowIso,
        subtotal: 100,
        discount: 0,
        total: 100,
        lines: [
          {
            name: 'No Cost Item',
            barcode: 'BC-NOCOST',
            unit: 'box',
            unitFactor: 1,
            price: 100,
            qty: 1,
            discount: 0
          }
        ]
      }
    ];
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify(seededSales));
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
  });

  const result = await page.evaluate(() => {
    const p0 = window.NOVA_DEMO.products[0];
    const p1 = window.NOVA_DEMO.products[1];
    const raw = JSON.parse(localStorage.getItem('nova-rx-sales-v1') || '[]');
    raw[0].lines[0].barcode = p0.barcode;
    raw[0].lines[0].name = p0.name;
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify(raw));

    const k0 = window.novaStock.keyOf(p0);
    const k1 = window.novaStock.keyOf(p1);
    window.novaStock.addLot({ key: k0, lot: 'LOT-0', expiry: '2030-01-31', qty: 5, cost: 60 });
    window.novaStock.addLot({ key: k1, lot: 'LOT-1', expiry: '2030-01-31', qty: 4, cost: 25 });

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

    return {
      p0Name: p0.name,
      p1Name: p1.name,
      profit: window.novaProfitSlow.profit(start, end),
      slow: window.novaProfitSlow.slow(60)
    };
  });

  // Sale A: rev 250 (200 + 50), cost 150 (120 + 30) -> known margin = (250 - 150) / 250 = 40%
  // Sale B: rev 100, cost unknown (excluded from marginPct)
  assert.equal(result.profit.revenue, 350);
  assert.equal(result.profit.cost, 150);
  assert.equal(result.profit.profit, 100, 'profit counts only lines with a known cost (250 - 150); the uncosted 100 is not profit');
  assert.equal(result.profit.marginPct, 40);

  const noCostItem = result.profit.items.find((i) => i.name === 'No Cost Item');
  assert.ok(noCostItem && noCostItem.costMissing === true && noCostItem.marginPct === null);

  // Slow(60) should include p1 (4 * 25 = 100) and exclude p0 (sold today)
  assert.equal(result.slow.items.length, 1);
  assert.equal(result.slow.items[0].name, result.p1Name);
  assert.equal(result.slow.items[0].costValue, 100);
  assert.equal(result.slow.totalCostValue, 100);

  await page.click('.nova-tab[data-page="reports"]');
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaProfitSlow'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaProfitSlow');
  await page.waitForSelector('#novaProfitSlow [data-nps-tab="profit"]');
  await page.waitForSelector('#novaProfitSlow [data-nps-tab="slow"]');

  await page.click('#novaProfitSlow [data-nps-tab="slow"]');
  const slowText = await page.textContent('#novaProfitSlow');
  assert.ok(slowText.includes(result.p1Name));

  console.log('profit-slow.mjs: PASS');
} finally {
  await browser.close();
  server.close();
}
