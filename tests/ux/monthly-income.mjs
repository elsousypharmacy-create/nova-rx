import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = path.extname(full);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const { server, port } = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errors = [];

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('__income_test_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__income_test_cleared', '1');
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.novaLazy && window.novaLazy.load());

  const res = await page.evaluate(() => {
    localStorage.setItem('nova-rx-sales-v1', '{broken');
    const corruptSafe = window.novaIncome.compute('2026-11');

    const novTs = Date.UTC(2026, 10, 15, 10, 0, 0);
    const octTs = Date.UTC(2026, 9, 15, 10, 0, 0);
    // Real app shapes: novaSales rows (app/120), return rows with costReversed, cash-outs (app/548), payroll store (app/594).
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify([
      { id: 'inv-1', at: new Date(novTs).toISOString(), total: 1000, lines: [{ qty: 3, price: 333.34, lots: [{ qty: 2, cost: 250 }, { qty: 1, cost: 0 }] }] },
      { id: 'inv-old', at: new Date(octTs).toISOString(), total: 9999, lines: [{ cost: 100, qty: 1 }] }
    ]));
    localStorage.setItem('nova-rx-returns-v1', JSON.stringify([
      { id: 'ret-1', saleId: 'inv-1', kind: 'return', at: new Date(novTs + 3600000).toISOString(), amount: 100, lines: [{ idx: 0, qty: 1 }], costReversed: 250 }
    ]));
    localStorage.setItem('nova-rx-cash-out-v1', JSON.stringify([
      { id: 'co-1', at: novTs, amount: 50, note: 'مصروف: كهرباء (D1)' },
      { id: 'co-2', at: novTs, amount: 400, note: 'سداد مورد: شركة (R9)' }
    ]));
    localStorage.setItem('nova-rx-payroll-v1', JSON.stringify({ employees: [], adjustments: [], closedMonths: { '2026-11': { closedAt: novTs, snapshots: { 'سارة': { netPiasters: 15000 } } } } }));
    localStorage.setItem('nova-rx-vault-moves-v1', JSON.stringify([
      { id: 'vm-1', type: 'vault_expense', at: novTs, date: '2026-11-15', amount: 100, amountCents: 10000 }
    ]));

    const bad = window.novaIncome.compute('2026-13');
    const nov = window.novaIncome.compute('2026-11');
    const empty = window.novaIncome.compute('2026-01');
    const csv = window.novaIncome.toCsv('2026-11');
    const emptyCsv = window.novaIncome.toCsv('2026-01');
    return { corruptSafe, bad, nov, empty, csv, emptyCsv };
  });

  assert(res.corruptSafe.ok && res.corruptSafe.netSales === 0, 'corrupt JSON does not crash');
  assert(!res.bad.ok && res.bad.error === 'bad-month', 'reject invalid month');
  assert(res.nov.ok, 'nov compute ok');
  assert(res.nov.netSales === 900, 'net sales = 1000 - 100 return: ' + res.nov.netSales);
  assert(res.nov.cogs === 250, 'cogs = 2 * 250 lots - 250 costReversed by the return: ' + res.nov.cogs);
  assert(res.nov.unknownCostLines === 1, 'flags lot with unknown cost');
  assert(res.nov.grossProfit === 650, 'gross profit = 900 - 250: ' + res.nov.grossProfit);
  assert(res.nov.drawerExpenses === 50, 'drawer expenses = cash-outs without supplier payments: ' + res.nov.drawerExpenses);
  assert(res.nov.payrollExpenses === 150, 'payroll from the closed month snapshot: ' + res.nov.payrollExpenses);
  assert(res.nov.totalExpenses === 300, 'expenses = 50 + 100 + 150');
  assert(res.nov.netProfit === 350, 'net profit = 650 - 300: ' + res.nov.netProfit);
  assert(res.empty.grossMarginPct === null && res.empty.netMarginPct === null, 'null margin when zero sales');
  assert(res.csv.startsWith('\uFEFF'), 'UTF-8 BOM for Excel CSV');
  assert(!res.emptyCsv.includes('-0.00'), 'no negative zero in CSV');

  await page.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click()); // at 390px the top tabs are hidden behind the bottom bar (app/562)
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaIncomeCard'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaIncomeCard', { timeout: 5000 });
  // a role without reports.view (e.g. cashier) gets no income card
  const hidden = await page.evaluate(() => { const real = window.novaPerms; window.novaPerms = { can: () => false, require: () => false }; document.getElementById('novaIncomeCard').remove(); window.novaIncome.mount(); const gone = !document.getElementById('novaIncomeCard'); window.novaPerms = real; window.novaIncome.mount(); return gone && !!document.getElementById('novaIncomeCard'); });
  assert(hidden, 'income card hidden without reports.view, back with it');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 390);
  assert(!overflow, 'no horizontal overflow at 390px');
  assert(errors.length === 0, 'no page errors: ' + errors.join('; '));

  console.log('«monthly-income PASS»');
} finally {
  await browser.close();
  server.close();
}
