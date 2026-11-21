// tests/ux/excel-export.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end('nf');
    return;
  }
  res.writeHead(200, {
    'content-type': ({
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    })[path.extname(f)] || 'application/octet-stream'
  });
  fs.createReadStream(f).pipe(res);
});

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayYmd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const seededSales = [
  {
    id: 'sale-1',
    number: 'INV-1001',
    at: new Date().toISOString(),
    customer: '=SUM(A1:A2)',
    phone: '01000000001',
    payment: 'cash',
    tenders: [{ method: 'cash', amount: 140 }],
    subtotal: 150,
    discount: 10,
    vat: 0,
    total: 140,
    lines: [
      { name: 'Panadol "Extra"', barcode: '6220001', unit: 'box', unitFactor: 1, price: 50, qty: 2, discount: 10, lot: 'L1' },
      { name: 'Augmentin 1g', barcode: '6220002', unit: 'strip', unitFactor: 2, price: 25, qty: 2, discount: 0, lot: 'L2' }
    ]
  },
  {
    id: 'sale-2',
    number: 'INV-1002',
    at: '2024-06-15T10:30:00.000Z',
    customer: 'أحمد علي',
    phone: '01000000002',
    payment: 'split',
    tenders: [
      { method: 'cash', amount: 60 },
      { method: 'wallet', amount: 40 }
    ],
    subtotal: 100,
    discount: 0,
    vat: 0,
    total: 100,
    lines: [
      { name: 'Concor 5mg', barcode: '6220003', unit: 'box', unitFactor: 1, price: 100, qty: 1, discount: 0, lot: 'L3' }
    ]
  }
];

let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/`;

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined
  });
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();

  await page.addInitScript((salesJson) => {
    localStorage.setItem('nova-rx-sales-v1', salesJson);
  }, JSON.stringify(seededSales));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.novaLazy));
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => Boolean(window.novaExcelExport));

  const res = await page.evaluate((ymd) => {
    const api = window.novaExcelExport;
    const allSales = api.salesRows('2024-01-01', '2099-12-31');
    const todayOnly = api.salesRows(ymd, ymd);
    const invRows = api.invoiceRows('2024-01-01', '2099-12-31');
    const csv = api.toCsv(allSales);
    return { allSales, todayOnly, invRows, csv };
  }, todayYmd);

  assert.equal(res.allSales.length, 4, 'header + 3 sold lines');
  assert.equal(res.todayOnly.length, 3, 'date filter excludes 2024-06-15 sale');
  assert.equal(res.invRows.length, 4, 'header + 2 sales + totals row');

  const totals = res.invRows[res.invRows.length - 1];
  assert.equal(totals[0], 'الإجمالي');
  assert.equal(totals[4], 250, 'subtotal sum');
  assert.equal(totals[5], 10, 'discount sum');
  assert.equal(totals[7], 240, 'total sum');
  assert.equal(totals[8], 200, 'cash sum');
  assert.equal(totals[11], 40, 'wallet/digital sum');

  assert.ok(res.csv.startsWith('\uFEFF'), 'UTF-8 BOM present');
  assert.ok(res.csv.includes('\r\n'), 'CRLF line endings');
  assert.ok(res.csv.includes('"\'=SUM(A1:A2)"'), 'formula-injection guard prefixes = with single quote');
  assert.ok(res.csv.includes('"Panadol ""Extra"""'), 'inner double quotes doubled');
  assert.ok(res.csv.includes('"\t6220001"'), 'digits-only barcode kept as text with a leading tab');
  assert.equal(await page.evaluate(() => window.novaExcelExport.salesRows('2099-12-31', '2024-01-01').length), 4, 'inverted range is swapped');

  await page.click('.nova-tab[data-page="reports"]');
  await page.waitForSelector('#novaExcelExport', { state: 'visible' });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#novaExcelExport button[data-export="sales"]')
  ]);
  assert.match(download.suggestedFilename(), /^nova-rx-sales-\d{4}-\d{2}-\d{2}\.csv$/);
  console.log('PASS excel-export:', download.suggestedFilename());
} finally {
  if (browser) await browser.close();
  server.close();
}
