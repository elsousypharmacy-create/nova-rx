import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const BASE_URL = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const SCRIPT_PATH = path.resolve('app/566-owner-dashboard.js');

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pageErrors = [];
  const dialogs = [];

  page.on('pageerror', function (err) {
    pageErrors.push(String(err));
  });
  page.on('dialog', async function (dialog) {
    dialogs.push(dialog.type() + ': ' + dialog.message());
    await dialog.dismiss();
  });

  await page.addInitScript(function () {
    var now = Date.now();
    var pastDueMs = now - (10 * 86400000);

    // Seed cash-out of 30 today
    window.localStorage.setItem('nova-rx-cash-out-v1', JSON.stringify([
      { id: 'co-1', at: now, amount: 30, note: 'مصروف نثرية', by: 'أحمد' }
    ]));

    // Ensure no backup exists
    window.localStorage.removeItem('nova-rx-last-backup-v1');

    // Seed one cash sale today of 100 where the app reads it (the real novaSales is defined by the app after this script)
    window.localStorage.setItem('nova-rx-sales-v1', JSON.stringify([
      { id: 's-1', no: 1, at: now, total: 100, payment: 'cash', lines: [{ name: 'بانادول', barcode: 'T-1', qty: 2, price: 50 }] }
    ]));
    window.__odPastDue = pastDueMs;
  });

  await page.goto(BASE_URL + (BASE_URL.indexOf('127.0.0.1') >= 0 ? 'index.html' : '') + '#sale', { waitUntil: 'domcontentloaded' });
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  // a 50 credit debt that is already overdue, through the real credit ledger
  await page.evaluate(function () { var due = window.__odPastDue; window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').charge({ id: 'od-1', customerId: 'c-1', amount: 50, at: due - 86400000, due: due, override: true }); });

  // Activate reports tab if present, otherwise create minimal host for standalone verification
  const hasReportsTab = await page.locator('.nova-tab[data-page="reports"]').count();
  if (hasReportsTab > 0) {
    await page.locator('.nova-tab[data-page="reports"]').first().click();
  } else {
    await page.evaluate(function () {
      var tab = document.createElement('button');
      tab.className = 'nova-tab active';
      tab.setAttribute('data-page', 'reports');
      document.body.appendChild(tab);

      var view = document.getElementById('novaPageView');
      if (!view) {
        view = document.createElement('div');
        view.id = 'novaPageView';
        document.body.appendChild(view);
      }
    });
  }

  // Ensure the lazy-loaded script is present
  const loaded = await page.evaluate(function () {
    return !!window.novaOwnerDash;
  });
  if (!loaded) {
    await page.addScriptTag({ path: SCRIPT_PATH });
  }

  const section = page.locator('#novaOwnerDashboardSection');
  await section.waitFor({ state: 'visible', timeout: 5000 });

  // 1. Cash drawer expected = 100 - 30 = 70.00
  const cashText = await section.locator('[data-od-card="cash-drawer"]').innerText();
  assert.ok(cashText.indexOf('70.00') !== -1, 'Expected cash drawer to show 70.00, got: ' + cashText);

  // 2. Credit outstanding = 50.00 + overdue alert
  const creditText = await section.locator('[data-od-card="credit-out"]').innerText();
  assert.ok(creditText.indexOf('50.00') !== -1, 'Expected credit card to show 50.00, got: ' + creditText);

  const alertsText = await section.locator('[data-od-card="alerts"]').innerText();
  assert.ok(alertsText.indexOf('متأخرة') !== -1 && alertsText.indexOf('50.00') !== -1, 'Expected overdue alert in: ' + alertsText);

  // 3. No backup -> backup tile is red (nova-od-danger)
  const backupTile = section.locator('[data-od-card="last-backup"]');
  const backupClass = await backupTile.getAttribute('class');
  assert.ok(backupClass && backupClass.indexOf('nova-od-danger') !== -1, 'Expected backup tile to have nova-od-danger class, got: ' + backupClass);

  // 4. Verify compute() API directly
  const computed = await page.evaluate(function () {
    return window.novaOwnerDash.compute(Date.now());
  });
  assert.equal(computed.cashDrawer.expected, 70);
  assert.equal(computed.credit.totalOutstanding, 50);
  assert.equal(computed.credit.overdue, 50);
  assert.equal(computed.backup.isRed, true);

  // 5. No native dialogs and no page errors
  assert.equal(dialogs.length, 0, 'Unexpected native dialogs: ' + dialogs.join('; '));
  assert.equal(pageErrors.length, 0, 'Unexpected page errors: ' + pageErrors.join('; '));

  await browser.close();
  console.log('owner-dashboard.mjs passed');
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});
