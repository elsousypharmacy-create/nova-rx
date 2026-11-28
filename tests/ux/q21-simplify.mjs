// Q21 step 2 (SIMPLIFY): a role nav, b short top/bottom nav without «العمليات», c «الأدوات» hub (one tool at a time, none left at the
// bottom of the reports/stock pages), f «الوردية» as its own entry with its actions at the top. SHOT_DIR=<dir> saves screenshots.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOT = process.env.SHOT_DIR || '';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: SHOT + '/' + name + '.png' }); };

async function open(vp, init, block) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD'].includes(q.method()) || (block && block.test(u))) return r.abort();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova-rx-onboarding-done', '1'); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
  await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const topNav = page => page.evaluate(() => [...document.querySelectorAll('.nova-nav .nova-tab')].filter(e => e.offsetParent).map(e => (e.textContent.trim() || e.getAttribute('aria-label'))));
const bottomNav = page => page.locator('#novaBottomNav button').allInnerTexts().then(a => a.map(s => s.trim()));
const shown = page => page.evaluate(() => [...document.getElementById('novaPageView').children].filter(e => e.offsetParent).map(e => e.id || e.className.split(' ')[0]));
const asCashier = page => page.evaluate(() => {
  localStorage.setItem('nova.auth.accounts', JSON.stringify([{ id: 'c1', name: 'Cashier', role: 'cashier' }]));
  window.novaPerms = { can: a => ['sale.create', 'sale.return'].includes(a), require: a => ['sale.create', 'sale.return'].includes(a) };
  window.novaNavRoles.apply(); window.novaPageViews.apply();
});
const OPS = ['novaVaultCard', 'novaIncomeCard', 'novaSupplierAccountsSection', 'novaPayroll', 'novaShiftClose', 'novaExpensesSection', 'novaStockCount', 'novaItemLimits', 'novaShelfLabels'];

try {
  // ---- owner, desktop ----
  {
    const { ctx, page, errors } = await open({ width: 1366, height: 800 });
    assert.deepEqual(await topNav(page), ['البيع', 'الوردية', 'المخزون', 'التقارير', 'الأدوات', 'الإعدادات'], 'owner top nav');
    assert.equal(await page.locator('#novaOpsNav, .nova-ops').count(), 0, 'no «العمليات» dropdown');
    await shot(page, 'q21-owner-sale-1366');
    // f) «الوردية»: its own entry, the actions on top without scrolling
    await page.locator('.nova-tab[data-page=shift]').click();
    await page.waitForFunction(() => document.getElementById('novaShiftClose') && document.getElementById('novaExpensesSection'), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.body.dataset.activePage + '/' + document.body.dataset.novaView), 'reports/shift');
    assert.ok(await page.locator('.nova-tab[data-page=shift]').evaluate(e => e.classList.contains('active')), 'الوردية is the active entry');
    assert.equal(await page.locator('.nova-tab[data-page=reports]').evaluate(e => e.classList.contains('active')), false, 'التقارير not highlighted');
    const s = await shown(page);
    assert.equal(s[0], 'novaViewHead');
    for (const id of s.slice(1)) assert.ok(['novaShiftClose', 'novaCashDrawerCard', 'novaExpensesSection', 'novaShiftNotes', 'novaFridgeLog', 'novaControlledRegister'].includes(id), 'shift view shows only shift cards, got ' + id);
    assert.equal(await page.locator('#novaOwnerDashboardSection').isVisible().catch(() => false), false, 'no owner board in the shift view');
    for (const k of ['count', 'expense', 'close']) {
      const b = await page.locator('[data-shift-go=' + k + ']').boundingBox();
      assert.ok(b && b.y + b.height <= 800, 'shift action «' + k + '» visible without scrolling');
    }
    const order = await page.evaluate(() => ['novaShiftClose', 'novaCashDrawerCard', 'novaExpensesSection'].map(id => document.getElementById(id)).filter(Boolean).map(e => e.getBoundingClientRect().top));
    assert.ok(order.every((y, i) => i === 0 || y > order[i - 1]), 'close → drawer → expenses order');
    await page.locator('[data-shift-go=close]').click();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'novaShiftCount', '«قفل الوردية» jumps to the counted cash');
    await shot(page, 'q21-shift-1366');
    // reports page: own content only (no ops cards at the bottom)
    await page.locator('.nova-tab[data-page=reports]').click(); await page.waitForTimeout(1500);
    const r = await shown(page);
    for (const id of OPS) assert.ok(!r.includes(id), 'reports page does not show ' + id);
    assert.ok(r.includes('novaKpiPeriod') || r.includes('novaRepEmpty'), 'reports page keeps the report');
    assert.equal(await page.locator('#novaRepTabs').count(), 0, 'no reports tab strip any more');
    // stock page: own content only
    await page.locator('.nova-tab[data-page=products]').click(); await page.waitForTimeout(1500);
    const p = await shown(page);
    for (const id of OPS) assert.ok(!p.includes(id), 'stock page does not show ' + id);
    // c) tools hub: grouped, searchable, a tile opens only that tool, back returns
    await page.locator('.nova-tab[data-page=tools]').click();
    await page.waitForSelector('.nth-tile', { timeout: 10000 });
    assert.deepEqual(await page.locator('.nth-group h2').allInnerTexts(), ['فلوس', 'مخزون', 'موردين', 'عملاء', 'قانوني ورقابة', 'موظفين'], 'tool groups');
    assert.ok(await page.locator('.nth-tile').count() >= 25, 'all ops cards are tiles');
    await shot(page, 'q21-tools-1366');
    await page.locator('#novaToolsSearch').fill('الخزنة'); await page.waitForTimeout(200);
    assert.deepEqual(await page.locator('.nth-tile b').allInnerTexts(), ['الخزنة والبنك'], 'search filters the tiles');
    await page.locator('#novaToolsSearch').fill('zzzz'); await page.waitForTimeout(200);
    assert.equal(await page.locator('.nth-tile').count(), 0); assert.ok(await page.getByText('مفيش أداة بالاسم ده').isVisible());
    await page.locator('#novaToolsSearch').fill(''); await page.waitForTimeout(200);
    await page.locator('[data-tool=novaPayroll]').click();
    await page.waitForFunction(() => document.getElementById('novaPayroll') && document.getElementById('novaPayroll').offsetParent, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    assert.deepEqual(await shown(page), ['novaViewHead', 'novaPayroll'], 'one tool at a time');
    assert.ok(await page.locator('.nova-tab[data-page=tools]').evaluate(e => e.classList.contains('active')), 'الأدوات stays highlighted');
    await shot(page, 'q21-tool-payroll-1366');
    await page.locator('[data-view-back]').click(); await page.waitForSelector('.nth-tile');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'tools', 'back to the hub');
    await page.locator('[data-tool=novaStockCount]').click();
    await page.waitForFunction(() => document.getElementById('novaStockCount') && document.getElementById('novaStockCount').offsetParent, null, { timeout: 10000 });
    assert.deepEqual(await shown(page), ['novaViewHead', 'novaStockCount'], 'a stock-page tool opens alone too');
    await page.locator('[data-view-back]').click(); await page.waitForSelector('.nth-tile');
    await page.locator('[data-quick=shift]').click(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.body.dataset.novaView), 'shift', 'hub quick tile opens الوردية');
    // a reload keeps the view
    await page.reload(); await page.waitForSelector('#mainSearchInput', { state: 'attached' }); await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => location.hash + ' ' + document.body.dataset.novaView), '#shift shift', 'a reload keeps «الوردية»');
    // a) cashier: only the daily entries
    await asCashier(page); await page.waitForTimeout(200);
    assert.deepEqual(await topNav(page), ['البيع', 'النواقص', 'الوردية'], 'cashier top nav');
    await page.locator('.nova-tab[data-page=sale]').click(); await page.waitForTimeout(300);
    // a cashier who reaches the reports page by its address only gets the shift view
    await page.evaluate(() => window.novaSwitchPage('reports')); await page.waitForTimeout(1200);
    assert.equal(await page.locator('#novaKpiPeriod').isVisible().catch(() => false), false, 'cashier: no owner numbers');
    assert.ok(await page.locator('#novaViewHead').isVisible(), 'cashier on reports → shift view');
    await page.waitForSelector('#novaExpensesSection [data-nsa-act=addexp]', { state: 'visible', timeout: 10000 });
    assert.equal(await page.locator('#novaSupplierAccountsSection').isVisible().catch(() => false), false, 'cashier: supplier accounts hidden');
    await shot(page, 'q21-cashier-1366');
    assert.deepEqual(errors, [], 'page errors');
    await ctx.close();
  }
  // ---- phone: bottom nav per role ----
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844 });
    assert.deepEqual(await bottomNav(page), ['البيع', 'الفواتير', 'الوردية', 'المخزون', 'المزيد'], 'owner bottom nav');
    await page.locator('#novaBottomNav [data-bnav=more]').click();
    assert.deepEqual(await page.locator('#novaMoreSheet .nms-item').allInnerTexts(), ['العملاء', 'التقارير', 'الأدوات', 'النواقص', 'استلام الطلبيات', 'الإعدادات'], 'owner «المزيد»');
    await page.locator('#novaMoreSheet [data-more=tools]').click(); await page.waitForSelector('.nth-tile');
    assert.equal(await page.locator('#novaBottomNav [data-bnav=more]').getAttribute('aria-current'), 'page', '«المزيد» marks the tools page');
    await shot(page, 'q21-tools-390');
    await page.locator('#novaBottomNav [data-bnav=shift]').click(); await page.waitForTimeout(1500);
    for (const k of ['count', 'expense', 'close']) { const b = await page.locator('[data-shift-go=' + k + ']').boundingBox(); assert.ok(b && b.y + b.height <= 844 - 58, '390: shift action «' + k + '» above the bottom bar'); }
    await shot(page, 'q21-shift-390');
    await asCashier(page); await page.waitForTimeout(300);
    assert.deepEqual(await bottomNav(page), ['البيع', 'الفواتير', 'العملاء', 'النواقص', 'الوردية'], 'cashier bottom nav (no «المزيد»)');
    assert.deepEqual(errors, [], '390 page errors');
    await ctx.close();
  }
  // ---- fail closed: accounts on the device, permissions not loaded ----
  {
    const acc = () => { try { localStorage.setItem('nova.auth.accounts', JSON.stringify([{ id: 'o', name: 'Owner', role: 'owner' }])); } catch {} };
    const { ctx, page } = await open({ width: 1366, height: 800 }, acc, /auth-permissions\.js/);
    await page.evaluate(() => document.querySelectorAll('#novaStaffGate, .nova-staff-gate').forEach(e => e.remove()));
    assert.deepEqual(await topNav(page), ['البيع', 'النواقص', 'الوردية'], 'fail closed: admin entries hidden until permissions are known');
    await page.evaluate(() => { window.novaPerms = { can: () => true, require: () => true }; });
    await page.waitForTimeout(1800);
    assert.deepEqual(await topNav(page), ['البيع', 'الوردية', 'المخزون', 'التقارير', 'الأدوات', 'الإعدادات'], 'permissions loaded (owner) → admin entries come back');

    // Batch 5: Invoices & Customers shortcuts live in POS header with instant return to open sale
    await page.click('#btnSaleInvoices');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'invoices', 'POS shortcut opens invoices');
    assert.ok(await page.locator('[data-back-sale]').isVisible(), 'subpage back button visible on invoices');
    // Escape closes active receipt modal without leaving invoices or triggering startNewSale()
    await page.evaluate(() => document.getElementById('receiptModal')?.classList.add('active'));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'invoices', 'Escape with open receipt modal stays on invoices');
    assert.equal(await page.evaluate(() => document.getElementById('receiptModal')?.classList.contains('active')), false, 'Escape closes receipt modal');
    assert.equal(await page.locator('#novaInvoiceActionDialog').count(), 0, 'Escape on receipt modal does not trigger new-sale action dialog');
    assert.equal(await page.evaluate(() => (document.getElementById('toastContainer')?.innerText || '').includes('الفاتورة الجديدة جاهزة')), false, 'Escape on receipt modal does not trigger new-sale toast');
    await page.click('.nova-subpill[data-page="customers"]');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'customers', 'subpill switches to customers');
    await page.click('[data-back-sale]');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'sale', 'back button returns to sale');
    assert.equal(await page.locator('.nova-tab[data-page="invoices"]').count(), 1, 'single invoices tab after return to sale');
    await page.click('#btnSaleCustomers');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'customers', 'POS shortcut opens customers');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'sale', 'Escape returns to sale');
    await ctx.close();
  }
  console.log('q21-simplify: all checks passed');
} finally { await browser.close(); }
