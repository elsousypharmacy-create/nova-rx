// CREDIT-LIMIT (#116): limit set from the customer details dialog (logged), «قرب الحد / فوق الحد» badges in the list,
// window.novaCreditLimit.check() for the sale screen. Fake/local data; external and non-GET requests blocked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  const pageErrors = [];
  const nativeDialogs = [];

  page.on('pageerror', function (err) {
    pageErrors.push(String(err));
  });
  page.on('dialog', function (dlg) {
    nativeDialogs.push(dlg.type() + ': ' + dlg.message());
    dlg.dismiss().catch(function () {});
  });

  const baseOrigin = new URL(BASE).origin;
  await page.route('**/*', function (route) {
    const req = route.request();
    const url = req.url();
    if (req.method() !== 'GET' || !url.startsWith(baseOrigin)) {
      return route.abort();
    }
    return route.continue();
  });

  await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#customers', { waitUntil: 'domcontentloaded' });

  // Navigate to Customers page
  const custNav = { count: async () => 1, click: async () => { await page.evaluate(() => { location.hash = '#customers'; const t = document.querySelector('.nova-tab[data-page="customers"]'); if (t && !t.classList.contains('active')) t.click(); }); } };  if (await custNav.count()) {
    await custNav.click();
  }
  await page.waitForSelector('tr[data-cust-row]', { timeout: 10000 });

  // Pick first existing customer from DOM and seed a 90 EGP credit charge
  const custId = await page.evaluate(function () {
    const row = document.querySelector('tr[data-cust-row]');
    if (!row) throw new Error('No customer row found');
    const id = row.getAttribute('data-cust-row');
    const ledger = window.NovaCredit.createCreditLedger(window.localStorage, 'nova.credit');
    window.novaLazy && window.novaLazy.load();
    ledger.charge({ id: 'ux-test-cl-' + Date.now(), customerId: String(id), amount: 90, override: true });
    return String(id);
  });

  // Reload to reflect seeded debt in list
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await custNav.count()) {
    await custNav.click();
  }
  const targetRow = page.locator('tr[data-cust-row="' + custId + '"]');
  await targetRow.waitFor({ state: 'visible', timeout: 10000 });

  // Open customer details dialog and set limit = 100
  await targetRow.click();
  await page.waitForSelector('#novaCustDetail #novaCustCreditLimit', { timeout: 5000 });
  await page.click('#novaCustCreditLimit [data-cl-edit]');
  await page.fill('#novaClInput', '100');
  await page.click('#novaCustCreditLimit [data-cl-save]');

  // Assert dialog values
  const limitText = await page.textContent('#novaCustCreditLimit [data-cl-limit-val]');
  assert.ok(limitText && limitText.includes('100'), 'Expected limit 100 in dialog, got: ' + limitText);

  // Close dialog
  await page.click('#novaCustDetail [data-dlg-close]');
  await page.waitForSelector('#novaCustDetail', { state: 'detached', timeout: 5000 });

  // Assert "قرب الحد" badge (90 >= 80% of 100)
  const nearBadge = targetRow.locator('[data-cl-badge="near"]');
  await nearBadge.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal((await nearBadge.textContent()).trim(), 'قرب الحد');

  // Assert window.novaCreditLimit.check() results
  const checks = await page.evaluate(function (id) {
    return {
      okCase: window.novaCreditLimit.check(id, 10),
      overCase: window.novaCreditLimit.check(id, 15),
      log: JSON.parse(window.localStorage.getItem('nova-rx-credit-limit-log-v1') || '[]')
    };
  }, custId);

  assert.equal(checks.okCase.ok, true);
  assert.equal(checks.okCase.limit, 100);
  assert.equal(checks.okCase.balance, 90);
  assert.equal(checks.okCase.available, 10);
  assert.equal(checks.okCase.after, 100);

  assert.equal(checks.overCase.ok, false);
  assert.equal(checks.overCase.after, 105);

  assert.ok(checks.log.length >= 1, 'Expected audit log entry');
  assert.equal(checks.log[checks.log.length - 1].customerId, custId);
  assert.equal(checks.log[checks.log.length - 1].to, 100);

  // Lower limit to 50 and verify "فوق الحد" badge
  await targetRow.click();
  await page.waitForSelector('#novaCustCreditLimit [data-cl-edit]', { timeout: 5000 });
  await page.click('#novaCustCreditLimit [data-cl-edit]');
  await page.fill('#novaClInput', '50');
  await page.click('#novaCustCreditLimit [data-cl-save]');
  await page.click('#novaCustDetail [data-dlg-close]');

  const overBadge = targetRow.locator('[data-cl-badge="over"]');
  await overBadge.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal((await overBadge.textContent()).trim(), 'فوق الحد');

  assert.deepEqual(nativeDialogs, [], 'Unexpected native dialogs: ' + nativeDialogs.join('; '));
  assert.deepEqual(pageErrors, [], 'Unexpected page errors: ' + pageErrors.join('; '));

  await browser.close();
  console.log('PASS: credit-limit UX test');
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});