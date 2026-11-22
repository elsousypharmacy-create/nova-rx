// tests/ux/payroll-commissions.mjs
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
  const ext = path.extname(full).toLowerCase();
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
    if (!sessionStorage.getItem('__npr_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__npr_cleared__', '1');
    }
    const nowIso = new Date().toISOString();
    const seededSales = [
      {
        id: 'npr-sale-1',
        number: 'INV-P1',
        at: nowIso,
        cashier: 'أحمد علي',
        subtotal: 6000,
        discount: 0,
        total: 6000,
        lines: [
          { name: 'صنف أ', barcode: '622100000001', unit: 'box', unitFactor: 1, price: 300, qty: 20, discount: 0 }
        ]
      },
      {
        id: 'npr-sale-2',
        number: 'INV-P2',
        at: nowIso,
        cashier: 'أحمد علي',
        subtotal: 4000,
        discount: 0,
        total: 4000,
        lines: [
          { name: 'صنف ب', barcode: '622100000002', unit: 'box', unitFactor: 1, price: 200, qty: 20, discount: 0 }
        ]
      },
      {
        id: 'npr-sale-unassigned',
        number: 'INV-P3',
        at: nowIso,
        subtotal: 500,
        discount: 0,
        total: 500,
        lines: [
          { name: 'صنف ج', barcode: '622100000003', unit: 'box', unitFactor: 1, price: 500, qty: 1, discount: 0 }
        ]
      }
    ];
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify(seededSales));
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

  const monthKey = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // 0. Corrupt storage JSON must not crash
  const corruptOk = await page.evaluate(() => {
    localStorage.setItem('nova-rx-payroll-v1', '{not-valid-json');
    const list = window.novaPayroll.employees();
    localStorage.removeItem('nova-rx-payroll-v1');
    return Array.isArray(list) && list.length === 0;
  });
  assert.equal(corruptOk, true, 'corrupt storage JSON handled safely');

  // 1. Core API: sales attribution, commission 2% of 10000.00 = 200.00, target bonus, target 0 = none, adjustments
  const core = await page.evaluate((mk) => {
    const P = window.novaPayroll;

    // Target 0 means no target even when bonusPercent > 0
    P.setEmployee({
      name: 'أحمد علي',
      baseSalaryPiasters: 500000,
      commissionPercent: 2,
      targetPiasters: 0,
      bonusPercent: 5
    });
    const zeroTarget = P.compute('أحمد علي', mk);

    // Set employee with target NOT reached (target 15000.00 > 10000.00)
    P.setEmployee({
      name: 'أحمد علي',
      baseSalaryPiasters: 500000,
      commissionPercent: 2,
      targetPiasters: 1500000,
      bonusPercent: 1
    });
    const salesAhmed = P.sales('أحمد علي', mk);
    const salesUnassigned = P.sales('غير محدد', mk);
    const belowTarget = P.compute('أحمد علي', mk);

    // Lower target to 10000.00 so target IS reached -> 1% bonus = 100.00 (10000 piasters)
    P.setEmployee({
      name: 'أحمد علي',
      baseSalaryPiasters: 500000,
      commissionPercent: 2,
      targetPiasters: 1000000,
      bonusPercent: 1
    });
    const reachedTarget = P.compute('أحمد علي', mk);

    // Adjustment without reason must be refused
    const noReason = P.addAdjustment({
      employee: 'أحمد علي',
      monthKey: mk,
      type: 'advance',
      amountPiasters: 50000,
      reason: '   '
    });

    // Advance reduces net by 500.00 (50000 piasters)
    const advOk = P.addAdjustment({
      employee: 'أحمد علي',
      monthKey: mk,
      type: 'advance',
      amountPiasters: 50000,
      reason: 'سلفة منتصف الشهر'
    });

    // Deduction reduces net by 100.00 (10000 piasters) and reward adds 150.00 (15000 piasters)
    const dedOk = P.addAdjustment({
      employee: 'أحمد علي',
      monthKey: mk,
      type: 'deduction',
      amountPiasters: 10000,
      reason: 'تأخير'
    });
    const rewOk = P.addAdjustment({
      employee: 'أحمد علي',
      monthKey: mk,
      type: 'reward',
      amountPiasters: 15000,
      reason: 'التزام'
    });

    const afterAdj = P.compute('أحمد علي', mk);
    const empList = P.employees();

    return {
      zeroTarget,
      salesAhmed,
      salesUnassigned,
      belowTarget,
      reachedTarget,
      noReason,
      advOk,
      dedOk,
      rewOk,
      afterAdj,
      empList
    };
  }, monthKey);

  assert.equal(core.zeroTarget.targetReached, false, 'target 0 = none');
  assert.equal(core.zeroTarget.bonusPiasters, 0, 'no bonus when target is 0');

  assert.equal(core.salesAhmed.totalPiasters, 1000000, 'Ahmed sales = 10000.00 EGP');
  assert.equal(core.salesAhmed.count, 2);
  assert.equal(core.salesUnassigned.totalPiasters, 50000, 'Unassigned sales = 500.00 EGP');

  assert.equal(core.belowTarget.commissionPiasters, 20000, '2% of 10000.00 = 200.00');
  assert.equal(core.belowTarget.targetReached, false);
  assert.equal(core.belowTarget.bonusPiasters, 0);

  assert.equal(core.reachedTarget.targetReached, true);
  assert.equal(core.reachedTarget.bonusPiasters, 10000, '1% bonus of 10000.00 = 100.00');
  assert.equal(core.reachedTarget.netPiasters, 530000, '5000 + 200 + 100 = 5300.00');

  assert.equal(core.noReason, false, 'adjustment without reason refused');
  assert.ok(core.advOk && core.advOk.id);
  assert.ok(core.dedOk && core.dedOk.id);
  assert.ok(core.rewOk && core.rewOk.id);
  // net = 500000 + 20000 + 10000 + 15000 - 50000 - 10000 = 485000
  assert.equal(core.afterAdj.netPiasters, 485000, 'advance/deduction subtract and reward adds');
  assert.equal(core.empList.length, 1);

  // 2. Card visible on reports + 390px no horizontal overflow + 44px controls + dark theme
  await page.evaluate(() => {
    try { sessionStorage.setItem('nova.reportsTab', 'staff'); } catch (e) {} // UI-BATCH1: reports tabs
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaPayroll'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaPayroll', { timeout: 5000 });
  assert.equal(await page.locator('#novaPayroll').count(), 1, 'mounted once');

  const stmtText = await page.locator('#nprStatementsWrap').textContent();
  assert.ok(stmtText && stmtText.includes('أحمد علي'), 'statement shows employee');
  assert.ok(stmtText.includes('4850.00'), 'statement shows computed net');
  assert.ok(stmtText.includes('اطبع كشف المرتب'), 'print payslip button visible');

  const layout = await page.evaluate(() => {
    const c = document.getElementById('novaPayroll');
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
  assert.ok(layout.sw <= layout.cw, `no horizontal overflow at 390px: ${layout.sw} > ${layout.cw}`);
  assert.equal(layout.small, 0, 'all controls at least 44px tall');
  assert.ok(layout.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), `dark card background: ${layout.bg}`);

  // 3. UI Arabic-Indic digits input check
  await page.fill('#nprEmpName', 'سارة حسن');
  await page.fill('#nprEmpBase', '٤٠٠٠.٥٠');
  await page.fill('#nprEmpComm', '٣');
  await page.fill('#nprEmpTarget', '٠');
  await page.fill('#nprEmpBonus', '٠');
  await page.click('#nprSaveEmpBtn');
  const sara = await page.evaluate((mk) => window.novaPayroll.compute('سارة حسن', mk), monthKey);
  assert.equal(sara.baseSalaryPiasters, 400050, 'Arabic-Indic EGP parsed to piasters');
  assert.equal(sara.commissionPercent, 3);

  // 4. closeMonth freezes snapshot, refuses later adjustments, refuses double close
  const closedCheck = await page.evaluate((mk) => {
    const P = window.novaPayroll;
    const beforeClosed = P.isClosed(mk);
    const closedRes = P.closeMonth(mk);
    const afterClosed = P.isClosed(mk);
    const doubleClose = P.closeMonth(mk);
    const lateAdj = P.addAdjustment({
      employee: 'أحمد علي',
      monthKey: mk,
      type: 'reward',
      amountPiasters: 99900,
      reason: 'بعد القفل'
    });
    // Mutate employee base salary after close; compute() must still return frozen snapshot
    P.setEmployee({
      name: 'أحمد علي',
      baseSalaryPiasters: 999900,
      commissionPercent: 10,
      targetPiasters: 0,
      bonusPercent: 0
    });
    const frozenSnap = P.compute('أحمد علي', mk);
    return { beforeClosed, closedRes, afterClosed, doubleClose, lateAdj, frozenSnap };
  }, monthKey);

  assert.equal(closedCheck.beforeClosed, false);
  assert.ok(closedCheck.closedRes && closedCheck.closedRes.monthKey === monthKey);
  assert.equal(closedCheck.afterClosed, true);
  assert.equal(closedCheck.doubleClose, false, 'double close refused');
  assert.equal(closedCheck.lateAdj, false, 'adjustment after close refused');
  assert.equal(closedCheck.frozenSnap.netPiasters, 485000, 'compute returns frozen snapshot');
  assert.equal(closedCheck.frozenSnap.baseSalaryPiasters, 500000);
  assert.equal(closedCheck.frozenSnap.closed, true);

  // 5. Permission false, throw, AND missing (fail closed) — API refuses and UI shows only «محتاج صلاحية المالك»
  const testAllApiCalls = async (mode) => {
    const res = await page.evaluate(({ mk, permMode }) => {
      const P = window.novaPayroll;
      if (permMode === 'false') {
        window.novaPerms = { require: () => false };
      } else if (permMode === 'throw') {
        window.novaPerms = { require: () => { throw new Error('perm boom'); } };
      } else {
        window.novaPerms = undefined;
      }
      const apiRes = {
        setEmployee: P.setEmployee({ name: 'مرفوض', baseSalaryPiasters: 100 }),
        employees: P.employees(),
        sales: P.sales('أحمد علي', mk),
        compute: P.compute('أحمد علي', mk),
        addAdjustment: P.addAdjustment({ employee: 'أحمد علي', monthKey: mk, type: 'advance', amountPiasters: 100, reason: 'x' }),
        closeMonth: P.closeMonth('2025-01'),
        isClosed: P.isClosed(mk)
      };
      const existing = document.getElementById('novaPayroll');
      if (existing) existing.remove();
      return apiRes;
    }, { mk: monthKey, permMode: mode });

    for (const k of Object.keys(res)) {
      assert.equal(res[k], false, `${mode} perm refused ${k}`);
    }

    await page.waitForSelector('#novaPayroll');
    const deniedText = await page.locator('#novaPayroll').textContent();
    assert.ok(deniedText && deniedText.includes('محتاج صلاحية المالك'), `${mode} perm shows owner permission message`);
    assert.ok(!deniedText.includes('أحمد علي'), `${mode} perm hides employee names`);
    assert.ok(!deniedText.includes('4850.00'), `${mode} perm hides numbers`);
    assert.equal(await page.locator('#novaPayroll table').count(), 0, `${mode} perm renders no tables`);
    assert.equal(await page.locator('#novaPayroll input').count(), 0, `${mode} perm renders no inputs`);
  };

  await testAllApiCalls('false');
  await testAllApiCalls('throw');
  await testAllApiCalls('missing');

  assert.equal(errors.length, 0, 'page errors: ' + errors.join(' | '));
  console.log('payroll-commissions PASS');
} finally {
  await browser.close();
  server.close();
}