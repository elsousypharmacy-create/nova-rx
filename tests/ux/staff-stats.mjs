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
    if (!sessionStorage.getItem('__staff_test_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__staff_test_cleared', '1');
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.novaLazy && window.novaLazy.load());

  const res = await page.evaluate(() => {
    localStorage.setItem('nova-rx-staff-attendance-v1', 'bad-json');
    window.novaPerms = { require: () => false };
    const deniedRep = window.novaStaffStats.report('2026-11-22', '2026-11-22');

    window.novaPerms = { require: () => { throw new Error('boom'); } };
    const thrownRep = window.novaStaffStats.report('2026-11-22', '2026-11-22');

    window.novaPerms = { require: (p) => p === 'accounts.manage' };
    window.novaAuth = { current: () => ({ id: 'emp-1', name: 'سارة', role: 'pharmacist' }) };

    const setT = window.novaStaffStats.setStartTime('٠٩:٠٠');
    // 2026-11-22 09:25 Cairo (UTC+2 in Nov) = 07:25 UTC -> 25 min late (>10m grace)
    const inMs = Date.UTC(2026, 10, 22, 7, 25, 0);
    const outMs = Date.UTC(2026, 10, 22, 11, 25, 0); // 4 hours worked
    const ci = window.novaStaffStats.checkIn({ at: inMs });
    const ciDup = window.novaStaffStats.checkIn({ at: inMs + 60000 });
    const co = window.novaStaffStats.checkOut({ at: outMs });

    localStorage.setItem('nova-rx-sales-v1', JSON.stringify([
      { id: 's1', at: new Date(inMs + 600000).toISOString(), cashierId: 'emp-1', cashier: 'سارة', total: 1000, refunded: 50, discount: 50, lines: [] },
      { id: 's2', at: inMs + 900000, total: 200 }, // unattributed
      { id: 's3', at: inMs + 1200000, employeeId: 'emp-2', cashierName: 'علي', total: 0 } // zero sales & zero hours
    ]));
    localStorage.setItem('nova-rx-returns-v1', JSON.stringify([
      { id: 'ret-1', saleId: 's1', kind: 'return', at: new Date(inMs + 700000).toISOString(), amount: 50, lines: [] } // app/120 return row shape: no seller, attributed through saleId
    ]));

    const rep = window.novaStaffStats.report('2026-11-22', '2026-11-22');
    return { deniedRep, thrownRep, setT, ci, ciDup, co, rep };
  });

  assert(!res.deniedRep.ok && res.deniedRep.error === 'forbidden', 'owner-only fail-closed on false');
  assert(!res.thrownRep.ok && res.thrownRep.error === 'forbidden', 'owner-only fail-closed on throw');
  assert(res.setT.ok && res.setT.startTime === '09:00', 'Arabic-Indic start time');
  assert(res.ci.ok && res.ci.event.lateMinutes === 25, 'Cairo late minutes calculation');
  assert(!res.ciDup.ok && res.ciDup.error === 'already-clocked-in', 'prevent double check-in');
  assert(res.co.ok && res.co.event.workedMinutes === 240, '4 hours worked');
  assert(res.rep.ok && res.rep.unattributedSales === 1, 'unattributed sales never guessed: ' + JSON.stringify(res.rep));
  const row1 = res.rep.rows.find((r) => r.empId === 'emp-1');
  const row2 = res.rep.rows.find((r) => r.empId === 'emp-2');
  assert(row1.returns === 100 && row1.netSales === 900 && row1.salesPerHour === 225, 'fair sales/hour KPI including standalone returns');
  assert(row1.returnRatePct === 10 && row1.discountRatePct === 5, 'return and discount rates');
  assert(row2.salesPerHour === null && row2.returnRatePct === null && row2.discountRatePct === null, 'zero denominators return null');

  await page.evaluate(() => { try { sessionStorage.setItem('nova.reportsTab', 'staff'); } catch {} }); // UI-BATCH1: reports tabs
  await page.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click()); // at 390px the top tabs are hidden behind the bottom bar (app/562)
  await page.waitForSelector('#novaStaffStatsCard', { timeout: 5000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 390);
  assert(!overflow, 'no horizontal overflow at 390px');
  assert(errors.length === 0, 'no page errors: ' + errors.join('; '));

  console.log('«staff-stats PASS»');
} finally {
  await browser.close();
  server.close();
}
