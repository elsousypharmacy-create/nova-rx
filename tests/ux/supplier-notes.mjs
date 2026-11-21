// tests/ux/supplier-notes.mjs
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
    if (!sessionStorage.getItem('__nsn_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nsn_cleared__', '1');
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

  await page.evaluate(() => { window.novaPerms = { require: () => true }; });

  const apiCheck = await page.evaluate(() => {
    const api = window.novaSupplierNotes;
    const out = {};

    // Corrupt JSON must not crash
    localStorage.setItem('nova-rx-supplier-notes-v1', '{broken-json');
    out.corruptList = api.list();
    out.corruptTotals = api.totals();
    localStorage.removeItem('nova-rx-supplier-notes-v1');

    // Add credit 150.00 then debit 50.00 -> balance -10000
    const n1 = api.add({
      supplier: 'مورد الشفاء',
      kind: 'credit',
      amountPiasters: 15000,
      reference: 'CN-101',
      reason: 'مسحوبات منتهية الصلاحية'
    });
    const n2 = api.add({
      supplier: 'مورد الشفاء',
      kind: 'debit',
      amountPiasters: 5000,
      reference: 'DN-201',
      reason: 'فرق تسعير'
    });
    out.n1 = n1;
    out.n2 = n2;
    out.bal1 = api.balance('مورد الشفاء');
    out.totals1 = api.totals();

    // Duplicate supplier + reference refused
    out.dupRef = api.add({
      supplier: 'مورد الشفاء',
      kind: 'credit',
      amountPiasters: 1000,
      reference: 'CN-101',
      reason: 'تكرار'
    });

    // Amount 0 / negative / non-integer refused
    out.zeroAmt = api.add({
      supplier: 'مورد الشفاء',
      kind: 'credit',
      amountPiasters: 0,
      reference: 'CN-102',
      reason: 'صفر'
    });
    out.negAmt = api.add({
      supplier: 'مورد الشفاء',
      kind: 'credit',
      amountPiasters: -500,
      reference: 'CN-103',
      reason: 'سالب'
    });
    out.floatAmt = api.add({
      supplier: 'مورد الشفاء',
      kind: 'credit',
      amountPiasters: 12.5,
      reference: 'CN-104',
      reason: 'كسر'
    });

    // Permission false, throw, and missing refused (fail closed); reading stays open
    const origPerms = window.novaPerms;
    window.novaPerms = { require: () => false };
    out.permFalseAdd = api.add({
      supplier: 'مورد الشفاء',
      kind: 'debit',
      amountPiasters: 2000,
      reference: 'DN-202',
      reason: 'اختبار صلاحية'
    });
    out.permFalseApply = api.apply(n1.id, 'INV-1');
    out.permFalseVoid = api.void(n1.id, 'سبب');
    out.readWhenDenied = api.balance('مورد الشفاء');

    window.novaPerms = { require: () => { throw new Error('perm boom'); } };
    out.permThrowAdd = api.add({
      supplier: 'مورد الشفاء',
      kind: 'debit',
      amountPiasters: 2000,
      reference: 'DN-203',
      reason: 'اختبار خطأ صلاحية'
    });
    out.permThrowVoid = api.void(n1.id, 'سبب');

    window.novaPerms = null;
    out.permMissingAdd = api.add({
      supplier: 'مورد الشفاء',
      kind: 'debit',
      amountPiasters: 2000,
      reference: 'DN-204',
      reason: 'اختبار غياب الصلاحية'
    });
    out.readWhenMissingPerms = api.balance('مورد الشفاء');
    window.novaPerms = origPerms;

    // Void without reason refused; with reason removes from balance but keeps record
    out.voidNoReason = api.void(n2.id, '   ');
    out.voided = api.void(n2.id, 'إدخال خاطئ');
    out.balAfterVoid = api.balance('مورد الشفاء');
    out.listCountAfterVoid = api.list({ supplier: 'مورد الشفاء' }).length;

    // Apply sets status applied
    out.applied = api.apply(n1.id, 'INV-7788');
    out.totalsAfterApply = api.totals();

    return out;
  });

  assert.deepEqual(apiCheck.corruptList, []);
  assert.deepEqual(apiCheck.corruptTotals, { creditTotal: 0, debitTotal: 0, net: 0, pendingCount: 0 });
  assert.ok(apiCheck.n1 && apiCheck.n1.id);
  assert.ok(apiCheck.n2 && apiCheck.n2.id);
  assert.equal(apiCheck.bal1, -10000);
  assert.deepEqual(apiCheck.totals1, { creditTotal: 15000, debitTotal: 5000, net: -10000, pendingCount: 2 });
  assert.equal(apiCheck.dupRef, false);
  assert.equal(apiCheck.zeroAmt, false);
  assert.equal(apiCheck.negAmt, false);
  assert.equal(apiCheck.floatAmt, false);
  assert.equal(apiCheck.permFalseAdd, false);
  assert.equal(apiCheck.permFalseApply, false);
  assert.equal(apiCheck.permFalseVoid, false);
  assert.equal(apiCheck.readWhenDenied, -10000);
  assert.equal(apiCheck.permThrowAdd, false);
  assert.equal(apiCheck.permThrowVoid, false);
  assert.equal(apiCheck.permMissingAdd, false);
  assert.equal(apiCheck.readWhenMissingPerms, -10000);
  assert.equal(apiCheck.voidNoReason, false);
  assert.ok(apiCheck.voided && apiCheck.voided.voidedAt && apiCheck.voided.voidReason === 'إدخال خاطئ');
  assert.equal(apiCheck.balAfterVoid, -15000);
  assert.equal(apiCheck.listCountAfterVoid, 2, 'voided record is kept in storage');
  assert.equal(apiCheck.applied.status, 'applied');
  assert.equal(apiCheck.applied.appliedInvoiceRef, 'INV-7788');
  assert.equal(apiCheck.totalsAfterApply.pendingCount, 0);

  // Switch to reports page and verify card mounts once
  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.waitForSelector('#novaSupplierNotes', { timeout: 5000 });
  assert.equal(await page.locator('#novaSupplierNotes').count(), 1, 'mounted once');

  // UI form with Arabic-Indic digits: «١٢٣٫٥٠» -> 12350
  await page.fill('#nsnSupplierInput', 'شركة الدواء');
  await page.selectOption('#nsnKindSelect', 'credit');
  await page.fill('#nsnAmountInput', '١٢٣٫٥٠');
  await page.fill('#nsnRefInput', 'CN-500');
  await page.fill('#nsnReasonInput', 'مرتجع أصناف');
  await page.click('#nsnAddBtn');

  const uiAdded = await page.evaluate(() => {
    const list = window.novaSupplierNotes.list({ supplier: 'شركة الدواء' });
    return { count: list.length, amt: list[0] && list[0].amountPiasters, id: list[0] && list[0].id };
  });
  assert.equal(uiAdded.count, 1);
  assert.equal(uiAdded.amt, 12350, 'Arabic-Indic «١٢٣٫٥٠» parsed as 12350 piasters');

  // In-app dialog for Apply to Invoice (no window.prompt/confirm)
  await page.locator(`#novaSupplierNotes button[data-action="apply"][data-id="${uiAdded.id}"]`).click();
  await page.waitForSelector('#nsnDialogInput', { timeout: 3000 });
  await page.fill('#nsnDialogInput', 'INV-900');
  await page.click('#nsnDialogConfirm');
  const afterUiApply = await page.evaluate((id) => {
    const rec = window.novaSupplierNotes.list().find((r) => r.id === id);
    return rec && { status: rec.status, inv: rec.appliedInvoiceRef };
  }, uiAdded.id);
  assert.deepEqual(afterUiApply, { status: 'applied', inv: 'INV-900' });

  // 390px layout check: no horizontal page overflow, >=44px controls, dark theme
  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaSupplierNotes');
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
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + ' > ' + lay.cw);
  assert.equal(lay.small, 0, 'all controls at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card bg: ' + lay.bg);

  // English labels check
  await page.evaluate(() => {
    localStorage.setItem('nova-rx-language', 'en');
    const c = document.getElementById('novaSupplierNotes');
    if (c) c.remove();
  });
  await page.waitForSelector('#novaSupplierNotes', { timeout: 5000 });
  assert.ok((await page.locator('#novaSupplierNotes').textContent()).includes('Supplier Debit & Credit Notes'));

  assert.equal(errors.length, 0, 'page errors: ' + errors.join(' | '));
  console.log('supplier-notes PASS');
} finally {
  await browser.close();
  server.close();
}