// tests/ux/pharmacy-swaps.mjs
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
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 }
  });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nps_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nps_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Core API tests: balances, settlement, validation, permissions, reversals, totals, statement order
  const apiRes = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    window.novaPerms = { require: () => true };
    const S = window.novaPharmacySwaps;

    const p1 = S.addPharmacy({ name: 'صيدلية الأمل', phone: '01000000001', note: 'الشارع المجاور' });
    const p2 = S.addPharmacy({ name: 'صيدلية الشفاء', phone: '01000000002', note: '' });

    const r1 = S.record({
      pharmacy: 'صيدلية الأمل',
      direction: 'out',
      item: 'أوجمنتين ١ جم',
      qty: 1,
      valuePiasters: 10000,
      note: 'عبوة كاملة'
    });
    const balAfterOut = S.balance('صيدلية الأمل');

    const r2 = S.record({
      pharmacy: 'صيدلية الأمل',
      direction: 'in',
      item: 'بنادول إكسترا',
      qty: 1,
      valuePiasters: 3000,
      note: ''
    });
    const balAfterIn = S.balance('صيدلية الأمل');

    const zeroSettle = S.settle({
      pharmacy: 'صيدلية الأمل',
      amountPiasters: 0,
      direction: 'received',
      note: 'صفر'
    });

    const s1 = S.settle({
      pharmacy: 'صيدلية الأمل',
      amountPiasters: 7000,
      direction: 'received',
      note: 'تحصيل نقدي'
    });
    const balAfterSettle = S.balance('صيدلية الأمل');

    // Permission checks: false, throw, and missing novaPerms must fail closed
    const keepPerms = window.novaPerms;
    window.novaPerms = { require: () => false };
    const deniedFalseRec = S.record({ pharmacy: 'صيدلية الأمل', direction: 'out', item: 'س', qty: 1, valuePiasters: 500 });
    const deniedFalseSettle = S.settle({ pharmacy: 'صيدلية الأمل', direction: 'paid', amountPiasters: 500 });
    const deniedFalseAdd = S.addPharmacy({ name: 'صيدلية مرفوضة' });

    window.novaPerms = { require: () => { throw new Error('perm-error'); } };
    const deniedThrowRec = S.record({ pharmacy: 'صيدلية الأمل', direction: 'out', item: 'س', qty: 1, valuePiasters: 500 });
    const deniedThrowRev = S.reverse({ id: r1.id, reason: 'اختبار' });

    window.novaPerms = undefined;
    const deniedMissingRec = S.record({ pharmacy: 'صيدلية الأمل', direction: 'out', item: 'س', qty: 1, valuePiasters: 500 });
    const deniedMissingSettle = S.settle({ pharmacy: 'صيدلية الأمل', direction: 'paid', amountPiasters: 500 });
    window.novaPerms = keepPerms;

    // Reversal requires a non-empty reason
    const r3 = S.record({
      pharmacy: 'صيدلية الشفاء',
      direction: 'in',
      item: 'كونجستال',
      qty: 2,
      valuePiasters: 4000,
      note: 'استلاف'
    });
    const revNoReason = S.reverse({ id: r3.id, reason: '   ' });
    const revOk = S.reverse({ id: r3.id, reason: 'خطأ في التسجيل' });
    const revTwice = S.reverse({ id: r3.id, reason: 'محاولة ثانية' });
    const balP2AfterRev = S.balance('صيدلية الشفاء');

    // Record another 'in' on p2 and 'out' on p1 to check totals()
    S.record({ pharmacy: 'صيدلية الشفاء', direction: 'in', item: 'فيتامين سي', qty: 1, valuePiasters: 2500 });
    S.record({ pharmacy: 'صيدلية الأمل', direction: 'out', item: 'أوميبرازول', qty: 1, valuePiasters: 6000 });

    const tot = S.totals();
    const stmtP1 = S.statement('صيدلية الأمل');

    return {
      p1,
      p2,
      balAfterOut,
      balAfterIn,
      zeroSettle,
      balAfterSettle,
      deniedFalseRec,
      deniedFalseSettle,
      deniedFalseAdd,
      deniedThrowRec,
      deniedThrowRev,
      deniedMissingRec,
      deniedMissingSettle,
      revNoReason,
      revOk: !!revOk,
      revTwice,
      balP2AfterRev,
      tot,
      stmtTypes: stmtP1.map((e) => e.type + ':' + (e.direction || '')),
      stmtIds: stmtP1.map((e) => e.id),
      r1Id: r1.id,
      r2Id: r2.id,
      s1Id: s1.id
    };
  });

  assert.equal(apiRes.balAfterOut, 10000, 'out 100.00 -> +10000');
  assert.equal(apiRes.balAfterIn, 7000, 'in 30.00 -> +7000');
  assert.equal(apiRes.zeroSettle, false, 'settle amount 0 refused');
  assert.equal(apiRes.balAfterSettle, 0, 'settle received 70.00 -> 0');
  assert.equal(apiRes.deniedFalseRec, false);
  assert.equal(apiRes.deniedFalseSettle, false);
  assert.equal(apiRes.deniedFalseAdd, false);
  assert.equal(apiRes.deniedThrowRec, false);
  assert.equal(apiRes.deniedThrowRev, false);
  assert.equal(apiRes.deniedMissingRec, false, 'missing novaPerms fails closed on record');
  assert.equal(apiRes.deniedMissingSettle, false, 'missing novaPerms fails closed on settle');
  assert.equal(apiRes.revNoReason, false, 'reversal without reason refused');
  assert.equal(apiRes.revOk, true, 'reversal with reason succeeds');
  assert.equal(apiRes.revTwice, false, 'double reversal refused');
  assert.equal(apiRes.balP2AfterRev, 0, 'balance restored to 0 after reversal');
  assert.deepEqual(apiRes.tot, { theyOweUs: 6000, weOweThem: 2500, net: 3500 }, 'totals match');
  assert.deepEqual(
    apiRes.stmtIds.slice(0, 3),
    [apiRes.r1Id, apiRes.r2Id, apiRes.s1Id],
    'statement lists entries in chronological order'
  );

  // Navigate to reports tab and verify card mounts once
  await page.evaluate(() => {
    try { sessionStorage.setItem('nova.reportsTab', 'suppliers'); } catch (e) {} // UI-BATCH1: reports tabs
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaPharmacySwaps'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaPharmacySwaps', { timeout: 5000 });
  assert.equal(await page.locator('#novaPharmacySwaps').count(), 1, 'card mounted once');

  // UI flow: record value with Arabic-Indic digits «١٢٫٥٠» -> 1250 piasters
  await page.selectOption('#npsRecordPharm', 'صيدلية الأمل');
  await page.click('#npsDirOut');
  await page.fill('#npsRecordItem', 'سيتال شراب');
  await page.fill('#npsRecordQty', '١');
  await page.fill('#npsRecordVal', '١٢٫٥٠');
  await page.click('#npsSaveRecordBtn');

  const afterArabicInput = await page.evaluate(() => {
    const stmt = window.novaPharmacySwaps.statement('صيدلية الأمل');
    const last = stmt[stmt.length - 1];
    return {
      lastValue: last ? last.valuePiasters : null,
      balance: window.novaPharmacySwaps.balance('صيدلية الأمل')
    };
  });
  assert.equal(afterArabicInput.lastValue, 1250, 'value «١٢٫٥٠» stored as 1250 piasters');
  assert.equal(afterArabicInput.balance, 7250, 'balance updated to 6000 + 1250');

  // Open statement in UI to verify table renders without overflow
  await page.locator('#npsPharmList .nps-row', { hasText: 'صيدلية الأمل' })
    .locator('button', { hasText: 'كشف الحساب' })
    .click();
  await page.waitForSelector('#npsStatementArea table', { timeout: 3000 });

  // 390px layout check: no horizontal overflow, 44px controls, dark theme
  const layout = await page.evaluate(() => {
    const c = document.getElementById('novaPharmacySwaps');
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
  assert.ok(layout.sw <= layout.cw, 'no horizontal overflow at 390px: ' + layout.sw + '>' + layout.cw);
  assert.equal(layout.small, 0, 'all controls at least 44px tall');
  assert.ok(layout.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background');

  // Corrupt storage must not crash
  const corruptOk = await page.evaluate(() => {
    localStorage.setItem('nova-rx-pharmacy-swaps-v1', '{broken-json');
    return {
      list: window.novaPharmacySwaps.pharmacies(),
      tot: window.novaPharmacySwaps.totals()
    };
  });
  assert.deepEqual(corruptOk.list, []);
  assert.deepEqual(corruptOk.tot, { theyOweUs: 0, weOweThem: 0, net: 0 });

  assert.equal(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  console.log('pharmacy-swaps PASS');
} finally {
  await browser.close();
  server.close();
}