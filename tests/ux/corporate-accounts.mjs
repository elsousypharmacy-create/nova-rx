// tests/ux/corporate-accounts.mjs
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
    if (!sessionStorage.getItem('__ncorp_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__ncorp_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
  });

  // 1. Core API tests: discount, credit limit, payment, duplicate company, two-month statement, closeMonth, permissions, corrupt JSON, invalid date, negative correction
  const apiRes = await page.evaluate(() => {
    window.novaPerms = { require: () => true };
    const C = window.novaCorporate;
    const out = {};

    // Corrupt JSON resilience
    localStorage.setItem('nova-rx-corporate-v1', '{bad-json');
    out.corruptCompanies = C.companies();
    localStorage.removeItem('nova-rx-corporate-v1');

    // Add company with 10% discount, limit 200.00 EGP (20000 piasters), 15 payDays
    out.addA = C.addCompany({
      name: 'شركة النيل',
      taxNo: '100-200-300',
      contact: 'أحمد علي',
      phone: '01000000001',
      creditLimitPiasters: 20000,
      discountPercent: 10,
      payDays: 15
    });

    // Duplicate company refused
    out.dupA = C.addCompany({ name: 'شركة النيل', creditLimitPiasters: 5000, discountPercent: 0, payDays: 30 });

    // Invalid calendar date refused
    out.badDateChg = C.addCharge({
      company: 'شركة النيل',
      date: '2026-02-31',
      ref: 'INV-BAD',
      description: 'تاريخ غير موجود',
      amountPiasters: 1000
    });

    // Charge 100.00 with 10% discount -> stores 90.00 (9000 piasters)
    out.chg1 = C.addCharge({
      company: 'شركة النيل',
      date: '2026-01-10',
      ref: 'INV-1',
      description: 'أدوية شهر يناير',
      amountPiasters: 10000
    });
    out.balAfterChg1 = C.balance('شركة النيل');

    // Limit 200.00 refuses a charge that makes balance 250.00 (gross 17778 -> net 16000 => 9000 + 16000 = 25000 > 20000)
    out.overLimitChg = C.addCharge({
      company: 'شركة النيل',
      date: '2026-01-15',
      ref: 'INV-2',
      description: 'طلب إضافي',
      amountPiasters: 17778
    });
    out.balAfterRefused = C.balance('شركة النيل');

    // Payment of 40.00 reduces balance from 90.00 to 50.00
    out.pay1 = C.addPayment({
      company: 'شركة النيل',
      date: '2026-01-20',
      amountPiasters: 4000,
      method: 'نقدي',
      ref: 'PAY-1'
    });
    out.balAfterPay1 = C.balance('شركة النيل');

    // Month 2 charge: 100.00 with 10% discount -> 90.00; closing = 50.00 + 90.00 = 140.00
    out.chg2 = C.addCharge({
      company: 'شركة النيل',
      date: '2026-02-05',
      ref: 'INV-3',
      description: 'أدوية شهر فبراير',
      amountPiasters: 10000
    });

    out.stmtJan = C.statement('شركة النيل', '2026-01');
    out.stmtFeb = C.statement('شركة النيل', '2026-02');
    out.chargesJan = C.charges('شركة النيل', '2026-01');

    // Negative correction: refused without reason, accepted with reason
    out.negNoReason = C.addCharge({
      company: 'شركة النيل',
      date: '2026-02-08',
      ref: 'CORR-1',
      description: '',
      amountPiasters: -1000
    });
    out.negWithReason = C.addCharge({
      company: 'شركة النيل',
      date: '2026-02-08',
      ref: 'CORR-1',
      description: 'مرتجع صنف',
      amountPiasters: -1000
    });
    out.balAfterCorrection = C.balance('شركة النيل');

    // Close January -> freezes snapshot; charge after close refused; double close refused
    out.isClosedBefore = C.isClosed('شركة النيل', '2026-01');
    out.closeJan = C.closeMonth('شركة النيل', '2026-01');
    out.isClosedAfter = C.isClosed('شركة النيل', '2026-01');
    out.chgAfterClose = C.addCharge({
      company: 'شركة النيل',
      date: '2026-01-25',
      ref: 'INV-LATE',
      description: 'متأخر',
      amountPiasters: 1000
    });
    out.doubleClose = C.closeMonth('شركة النيل', '2026-01');

    // Permissions: false and throw refused (fail closed), reads remain open
    const origPerms = window.novaPerms;
    window.novaPerms = { require: () => false };
    out.permFalseCompany = C.addCompany({ name: 'شركة مرفوضة' });
    out.permFalseCharge = C.addCharge({ company: 'شركة النيل', date: '2026-02-10', amountPiasters: 1000 });
    out.permFalsePay = C.addPayment({ company: 'شركة النيل', date: '2026-02-10', amountPiasters: 1000 });
    out.permFalseClose = C.closeMonth('شركة النيل', '2026-02');
    out.readWhileDenied = C.companies().length;

    window.novaPerms = { require: () => { throw new Error('perm boom'); } };
    out.permThrowCompany = C.addCompany({ name: 'شركة خطأ' });
    out.permThrowCharge = C.addCharge({ company: 'شركة النيل', date: '2026-02-10', amountPiasters: 1000 });
    out.permThrowPay = C.addPayment({ company: 'شركة النيل', date: '2026-02-10', amountPiasters: 1000 });
    out.permThrowClose = C.closeMonth('شركة النيل', '2026-02');
    window.novaPerms = origPerms;

    // Unlimited company (creditLimit 0) for Arabic-Indic UI test
    out.addB = C.addCompany({
      name: 'شركة الأمل',
      taxNo: '555-666',
      creditLimitPiasters: 0,
      discountPercent: 0,
      payDays: 30
    });

    return out;
  });

  assert.deepEqual(apiRes.corruptCompanies, []);
  assert.equal(apiRes.addA.ok, true);
  assert.equal(apiRes.dupA.ok, false);
  assert.equal(apiRes.badDateChg.ok, false);

  assert.equal(apiRes.chg1.ok, true);
  assert.equal(apiRes.chg1.charge.grossPiasters, 10000);
  assert.equal(apiRes.chg1.charge.discountPiasters, 1000);
  assert.equal(apiRes.chg1.charge.netPiasters, 9000);
  assert.equal(apiRes.balAfterChg1, 9000);

  assert.equal(apiRes.overLimitChg.ok, false);
  assert.ok(apiRes.overLimitChg.error.includes('تعدّى حد الائتمان'), 'Expected credit limit error message');
  assert.equal(apiRes.balAfterRefused, 9000);

  assert.equal(apiRes.pay1.ok, true);
  assert.equal(apiRes.balAfterPay1, 5000);

  assert.equal(apiRes.stmtJan.openingBalancePiasters, 0);
  assert.equal(apiRes.stmtJan.chargesTotalPiasters, 9000);
  assert.equal(apiRes.stmtJan.paymentsTotalPiasters, 4000);
  assert.equal(apiRes.stmtJan.closingBalancePiasters, 5000);
  assert.equal(apiRes.stmtJan.dueDate, '2026-02-15');

  assert.equal(apiRes.stmtFeb.openingBalancePiasters, 5000);
  assert.equal(apiRes.stmtFeb.chargesTotalPiasters, 9000);
  assert.equal(apiRes.stmtFeb.closingBalancePiasters, 14000);
  assert.equal(apiRes.stmtFeb.dueDate, '2026-03-15');
  assert.equal(apiRes.chargesJan.length, 1);

  assert.equal(apiRes.negNoReason.ok, false);
  assert.equal(apiRes.negWithReason.ok, true);
  assert.equal(apiRes.balAfterCorrection, 13100);

  assert.equal(apiRes.isClosedBefore, false);
  assert.equal(apiRes.closeJan.ok, true);
  assert.equal(apiRes.isClosedAfter, true);
  assert.equal(apiRes.chgAfterClose.ok, false);
  assert.equal(apiRes.doubleClose.ok, false);

  assert.equal(apiRes.permFalseCompany.ok, false);
  assert.equal(apiRes.permFalseCharge.ok, false);
  assert.equal(apiRes.permFalsePay.ok, false);
  assert.equal(apiRes.permFalseClose.ok, false);
  assert.equal(apiRes.readWhileDenied, 1);
  assert.equal(apiRes.permThrowCompany.ok, false);
  assert.equal(apiRes.permThrowCharge.ok, false);
  assert.equal(apiRes.permThrowPay.ok, false);
  assert.equal(apiRes.permThrowClose.ok, false);

  // 2. Navigate to reports page and verify card mount + layout at 390px
  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaCorporate'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaCorporate', { timeout: 5000 });
  assert.equal(await page.locator('#novaCorporate').count(), 1, 'Card mounted once');

  const layout = await page.evaluate(() => {
    const c = document.getElementById('novaCorporate');
    const small = [...c.querySelectorAll('button,input,select')].filter(
      (x) => x.offsetParent && x.getBoundingClientRect().height < 43
    ).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(layout.sw <= layout.cw, `No horizontal overflow at 390px: ${layout.sw} > ${layout.cw}`);
  assert.equal(layout.small, 0, 'All visible controls are at least 44px high');
  assert.ok(layout.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), `Dark card bg: ${layout.bg}`);

  // 3. Arabic-Indic digits + Arabic decimal separator via UI: «١٢٣٫٥٠» -> 12350 piasters
  await page.selectOption('#ncorpChargeCompany', 'شركة الأمل');
  await page.fill('#ncorpChargeDate', '٢٠٢٦-٠٣-١٠');
  await page.fill('#ncorpChargeRef', 'ف-١٠٠');
  await page.fill('#ncorpChargeDesc', 'مسحوبات اختبار');
  await page.fill('#ncorpChargeAmount', '١٢٣٫٥٠');
  await page.click('#ncorpAddChargeBtn');

  const arabicAmtBal = await page.evaluate(() => window.novaCorporate.balance('شركة الأمل'));
  assert.equal(arabicAmtBal, 12350, 'Arabic-Indic «١٢٣٫٥٠» must store 12350 piasters');

  // 4. English labels check
  await page.evaluate(() => {
    localStorage.setItem('nova-rx-language', 'en');
    const c = document.getElementById('novaCorporate');
    if (c) c.remove();
  });
  await page.waitForSelector('#novaCorporate', { timeout: 5000 });
  const enText = await page.locator('#novaCorporate').textContent();
  assert.ok(enText && enText.includes('Print Monthly Invoice'), 'English labels rendered');

  assert.equal(errors.length, 0, 'Page errors: ' + errors.join(' | '));
  console.log('corporate-accounts PASS');
} finally {
  await browser.close();
  server.close();
}