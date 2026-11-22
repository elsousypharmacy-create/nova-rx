// CTRL-01: «دفتر الأدوية المراقبة» — mark an item controlled, capture patient / national ID (14 digits) / doctor,
// append-only register on the reports page with the ID masked. Fake data; external and non-GET requests blocked.
import { chromium } from 'playwright';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const ORIGIN = new URL(BASE).origin;

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    serviceWorkers: 'block'
  });
  const page = await context.newPage();

  const pageErrors = [];
  const nativeDialogs = [];

  page.on('pageerror', function (err) {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  page.on('dialog', async function (dlg) {
    nativeDialogs.push(dlg.type() + ': ' + dlg.message());
    await dlg.dismiss();
  });

  await page.route('**/*', function (route) {
    const req = route.request();
    const url = req.url();
    if (req.method() !== 'GET' || !url.startsWith(ORIGIN)) {
      return route.abort();
    }
    return route.continue();
  });

  await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale', { waitUntil: 'domcontentloaded' });
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.novaLazy && window.novaLazy.load());

  // Wait for core globals and controlled drugs module
  await page.waitForFunction(function () {
    return !!(window.novaSearch && window.novaStock && window.novaControlled);
  }, { timeout: 15000 });

  // Pick a product with a barcode
  const product = await page.evaluate(function () {
    const queries = ['6281001234567', 'panadol', 'a'];
    for (let i = 0; i < queries.length; i++) {
      const list = window.novaSearch.search(queries[i], 1);
      if (list && list.length && list[0] && list[0].barcode) {
        return {
          name: list[0].name,
          barcode: list[0].barcode,
          key: window.novaStock.keyOf(list[0])
        };
      }
    }
    return null;
  });

  if (!product || !product.key) {
    throw new Error('No product with barcode found via novaSearch');
  }

  // Mark product as controlled
  const marked = await page.evaluate(function (key) {
    window.novaControlled.setControlled(key, true, 'اختبار جدول');
    return window.novaControlled.isControlled(key);
  }, product.key);

  if (!marked) {
    throw new Error('Failed to mark product as controlled');
  }

  // Trigger capture() in-page (non-blocking) and fill the dialog
  const capturePromise = page.evaluate(function (p) {
    return window.novaControlled.capture({
      saleId: 'TEST-SALE-1',
      lines: [{ key: p.key, name: p.name, qty: 2, unit: 'علبة' }]
    }).then(function (entries) {
      if (entries && entries.length) {
        window.novaControlled.record(entries);
      }
      return entries;
    });
  }, product);

  const dialog = page.locator('.nova-ctrl-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });

  // 1. Verify 13-digit national ID is rejected
  await dialog.locator('#novaCtrlPatient').fill('أحمد محمد');
  await dialog.locator('#novaCtrlNid').fill('2900101123456');
  await dialog.locator('#novaCtrlDoctor').fill('د. سامي علي');
  await dialog.locator('[data-action="save"]').click();

  const errText = await dialog.locator('.nova-ctrl-err').textContent();
  if (!errText || errText.indexOf('14') === -1) {
    throw new Error('Expected 14-digit validation error, got: ' + errText);
  }

  // 2. Fill valid 14-digit national ID and submit
  await dialog.locator('#novaCtrlNid').fill('29001011234567');
  await dialog.locator('[data-action="save"]').click();

  const recordedEntries = await capturePromise;
  if (!recordedEntries || recordedEntries.length !== 1) {
    throw new Error('Expected 1 recorded entry');
  }
  if (recordedEntries[0].hasImage !== false) {
    throw new Error('Expected hasImage to be false');
  }

  // 3. Open reports page and verify masked ID
  await page.evaluate(() => { try { sessionStorage.setItem('nova.reportsTab', 'shift'); } catch {} }); // UI-BATCH1: reports tabs
  const reportsTab = page.locator('.nova-tab[data-page="reports"]');
  await reportsTab.click();

  const reg = page.locator('#novaControlledRegister');
  await reg.waitFor({ state: 'visible', timeout: 5000 });

  const regText = await reg.textContent();
  if (!regText || regText.indexOf('**********4567') === -1) {
    throw new Error('Expected masked national ID **********4567 in register');
  }
  if (regText.indexOf('29001011234567') !== -1) {
    throw new Error('Full national ID leaked in register before manager unlock');
  }

  if (nativeDialogs.length) {
    throw new Error('Native dialogs fired: ' + nativeDialogs.join('; '));
  }
  if (pageErrors.length) {
    throw new Error('Page errors: ' + pageErrors.join('; '));
  }

  await browser.close();
  console.log('PASS: controlled-drugs UX test');
}

main().catch(function (err) {
  console.error('FAIL:', err);
  process.exit(1);
});