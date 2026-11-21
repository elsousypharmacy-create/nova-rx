// tests/ux/supplier-cheques.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

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

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nsc_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nsc_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const apiRes = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    const C = window.novaCheques;
    window.novaPerms = { require: () => true };
    const now = Date.now();
    const day = 86400000;
    const dateOffset = (d) => new Date(now + d * day).toISOString().slice(0, 10);

    const zeroAmt = C.add({ supplier: 'مورد أ', number: '100', bank: 'الأهلي', amount: 0, dueAt: dateOffset(3) });
    const badDecimals = C.add({ supplier: 'مورد أ', number: '101', bank: 'الأهلي', amount: '10.123', dueAt: dateOffset(3) });

    const origPerms = window.novaPerms;
    window.novaPerms = undefined;
    const permMissing = C.add({ supplier: 'مورد أ', number: '101b', bank: 'الأهلي', amount: 500, dueAt: dateOffset(3) });
    window.novaPerms = { require: () => false };
    const permFalse = C.add({ supplier: 'مورد أ', number: '102', bank: 'الأهلي', amount: 500, dueAt: dateOffset(3) });
    window.novaPerms = { require: () => { throw new Error('denied'); } };
    const permThrow = C.add({ supplier: 'مورد أ', number: '103', bank: 'الأهلي', amount: 500, dueAt: dateOffset(3) });
    window.novaPerms = origPerms;

    const c3 = C.add({ supplier: 'المتحدة للأدوية', number: '5001', bank: 'البنك الأهلي', amount: '١٢٥٠٫٥٠', dueAt: dateOffset(3), note: 'دفعة أولى' });
    const dup = C.add({ supplier: 'المتحدة للأدوية', number: '5001', bank: 'بنك مصر', amount: 200, dueAt: dateOffset(5) });
    const c20 = C.add({ supplier: 'ابن سينا', number: '5002', bank: 'بنك مصر', amount: 3000, dueAt: dateOffset(20) });
    const cOver = C.add({ supplier: 'فارما أوفرسيز', number: '5003', bank: 'التجاري الدولي', amount: 1000, dueAt: dateOffset(-2) });

    const due7 = C.dueWithin(7, now);
    const totalsBefore = C.totals(now);

    const bounceNoReason = C.markBounced(c3.id, '');
    const cancelNoReason = C.cancel(c3.id, '   ');
    const paid = C.markPaid(c3.id, 'تم الصرف نقداً');
    const pendingAfterPaid = C.list('pending');
    const totalsAfterPaid = C.totals(now);

    return {
      zeroAmt,
      badDecimals,
      permMissing,
      permFalse,
      permThrow,
      c3,
      dup,
      c20,
      cOver,
      due7Ids: due7.map((x) => x.id),
      totalsBefore,
      bounceNoReason,
      cancelNoReason,
      paid,
      pendingAfterPaidIds: pendingAfterPaid.map((x) => x.id),
      totalsAfterPaid
    };
  });

  assert.equal(apiRes.zeroAmt, false, 'amount 0 refused');
  assert.equal(apiRes.badDecimals, false, '>2 decimals refused');
  assert.equal(apiRes.permMissing, false, 'missing novaPerms refused (fail-closed)');
  assert.equal(apiRes.permFalse, false, 'permission false refused');
  assert.equal(apiRes.permThrow, false, 'permission throw refused');
  assert.equal(apiRes.c3.amount, 125050, 'Arabic-Indic 1250.50 parsed as 125050 piasters');
  assert.equal(apiRes.dup, false, 'duplicate supplier+number refused');
  assert.ok(apiRes.due7Ids.includes(apiRes.c3.id), 'dueWithin(7) includes cheque due in 3 days');
  assert.ok(!apiRes.due7Ids.includes(apiRes.c20.id), 'dueWithin(7) excludes cheque due in 20 days');
  assert.deepEqual(apiRes.totalsBefore, {
    pendingCount: 3,
    pendingAmount: 525050,
    overdueAmount: 100000,
    next7Amount: 125050
  });
  assert.equal(apiRes.bounceNoReason, false, 'markBounced without reason refused');
  assert.equal(apiRes.cancelNoReason, false, 'cancel without reason refused');
  assert.equal(apiRes.paid.status, 'paid');
  assert.equal(apiRes.paid.history.length, 1);
  assert.equal(apiRes.paid.history[0].from, 'pending');
  assert.equal(apiRes.paid.history[0].to, 'paid');
  assert.ok(!apiRes.pendingAfterPaidIds.includes(apiRes.c3.id), 'markPaid moves cheque out of pending');
  assert.equal(apiRes.totalsAfterPaid.pendingCount, 2);

  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.waitForSelector('#novaSupplierCheques', { timeout: 5000 });
  assert.equal(await page.locator('#novaSupplierCheques').count(), 1, 'mounted once');

  const summaryText = await page.locator('#nscSummary').textContent();
  assert.ok(summaryText.includes('المستحق خلال ٧ أيام'), 'summary shows next 7 days label');
  assert.ok(summaryText.includes('المتأخر'), 'summary shows overdue label');
  assert.ok(summaryText.includes('إجمالي المعلق'), 'summary shows total pending label');
  assert.ok(summaryText.includes('1000.00 ج.م'), 'summary shows overdue money with 2 decimals and ج.م');

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaSupplierCheques');
    const small = [...c.querySelectorAll('button,input')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'all visible controls at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background: ' + lay.bg);

  // In-app dialog flow for markBounced
  await page.locator('#novaSupplierCheques .nsc-row-btns button', { hasText: 'ارتد' }).first().click();
  await page.waitForSelector('#novaChequesDialog', { timeout: 3000 });
  await page.fill('#nscDialogInput', 'عدم كفاية الرصيد');
  await page.locator('#novaChequesDialog .btn-primary').click();
  const bouncedCount = await page.evaluate(() => window.novaCheques.list('bounced').length);
  assert.equal(bouncedCount, 1, 'in-app dialog marked cheque bounced');

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  console.log('supplier-cheques PASS');
} finally {
  await browser.close();
  server.close();
}