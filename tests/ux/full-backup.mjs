// BACKUP-01: full encrypted backup file from the settings card, wrong passphrase changes nothing, restore downloads an
// encrypted safety copy first, replaces the data and reloads. Fake/local data; external and non-GET requests blocked.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

var BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
var PASS = 'test-pass-123';

function isAllowedUrl(urlStr) {
  if (urlStr.indexOf('data:') === 0 || urlStr.indexOf('blob:') === 0) return true;
  try {
    var u = new URL(urlStr);
    var b = new URL(BASE);
    return u.origin === b.origin;
  } catch (e) {
    return false;
  }
}

async function openSettings(page) {
  var card = page.locator('#novaFullBackupCard');
  if (await card.count()) return;

  var navSelectors = [
    '[data-page="settings"]',
    '[data-view="settings"]',
    'a[href*="settings"]',
    'button:has-text("الإعدادات")',
    'a:has-text("الإعدادات")'
  ];
  for (var i = 0; i < navSelectors.length; i++) {
    var el = page.locator(navSelectors[i]).first();
    if (await el.count()) {
      await el.click();
      break;
    }
  }
  await page.waitForSelector('#novaFullBackupCard', { timeout: 10000 });
}

async function run() {
  var browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  var context = await browser.newContext({
    serviceWorkers: 'block',
    acceptDownloads: true
  });
  var page = await context.newPage();

  var pageErrors = [];
  var nativeDialogs = [];
  page.on('pageerror', function (err) { pageErrors.push(String(err)); });
  page.on('dialog', function (d) {
    nativeDialogs.push(d.type() + ': ' + d.message());
    d.dismiss();
  });

  await page.route('**/*', function (route) {
    var req = route.request();
    if (req.method() !== 'GET' || !isAllowedUrl(req.url())) {
      return route.abort();
    }
    return route.continue();
  });

  /* 1. Load app and seed localStorage */
  await page.goto(BASE + (BASE.indexOf('127.0.0.1') >= 0 ? 'index.html' : '') + '#sale', { waitUntil: 'domcontentloaded' });
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  await page.evaluate(function () {
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify([
      { id: 'sale-1', total: 120, at: '2026-11-20T10:00:00.000Z' }
    ]));
    localStorage.setItem('nova-rx-test-k', 'v1');
  });

  /* 2. Open Settings -> Full Backup card -> Create backup */
  await openSettings(page);
  await page.locator('#novaFullBackupCard button:has-text("اعمل نسخة دلوقتي")').click();
  await page.waitForSelector('.nfb-dialog[role="dialog"]');

  await page.fill('#nfbPass1', PASS);
  await page.fill('#nfbPass2', PASS);

  var downloadPromise = page.waitForEvent('download');
  await page.locator('.nfb-dialog button:has-text("تشفير وتنزيل النسخة")').click();
  var backupDownload = await downloadPromise;
  var backupPath = await backupDownload.path();
  assert.ok(backupDownload.suggestedFilename().indexOf('nova-rx-backup-') === 0, 'Backup filename prefix mismatch');
  assert.ok(backupDownload.suggestedFilename().slice(-8) === '.novabak', 'Backup extension mismatch');

  var backupText = await fs.readFile(backupPath, 'utf8');
  var env = JSON.parse(backupText);
  assert.equal(env.format, 'nova-rx-encrypted-backup');
  assert.equal(env.version, 1);
  assert.equal(env.kind, 'full');

  /* 3. Mutate localStorage */
  await page.evaluate(function () {
    localStorage.setItem('nova-rx-test-k', 'v2');
  });
  var mutated = await page.evaluate(function () { return localStorage.getItem('nova-rx-test-k'); });
  assert.equal(mutated, 'v2');

  /* 4. Restore with WRONG passphrase -> error, no change */
  await page.locator('#novaFullBackupCard button:has-text("استرجاع من نسخة")').click();
  await page.waitForSelector('.nfb-dialog[role="dialog"]');
  await page.setInputFiles('#nfbRestoreFile', backupPath);
  await page.fill('#nfbRestorePass', 'wrong-pass-999');
  await page.locator('.nfb-dialog button:has-text("فحص النسخة")').click();

  var errBox = page.locator('.nfb-dialog [role="alert"]');
  await errBox.waitFor({ state: 'visible' });
  await page.waitForFunction(function () {
    var el = document.querySelector('.nfb-dialog [role="alert"]');
    return el && el.textContent.trim().length > 0;
  });
  var stillV2 = await page.evaluate(function () { return localStorage.getItem('nova-rx-test-k'); });
  assert.equal(stillV2, 'v2', 'Wrong passphrase must not alter data');

  /* 5. Restore with CORRECT passphrase -> safety copy download + reload + v1 restored */
  await page.fill('#nfbRestorePass', PASS);
  await page.locator('.nfb-dialog button:has-text("فحص النسخة")').click();
  var redBtn = page.locator('.nfb-dialog button.btn-danger:has-text("استبدال البيانات الآن")');
  await redBtn.waitFor({ state: 'visible' });
  assert.equal(await redBtn.isDisabled(), true, 'restore stays locked until the safety copy was saved');

  // step 1: safety copy of the current data (its own click)
  var safetyBtn = page.locator('.nfb-dialog button:has-text("نسخة أمان")');
  await page.waitForFunction(function () { var b = [].slice.call(document.querySelectorAll('.nfb-dialog button')).find(function (x) { return x.textContent.indexOf('نسخة أمان') >= 0; }); return b && !b.disabled; });
  var safetyDownloadPromise = page.waitForEvent('download');
  await safetyBtn.click();
  var safetyDownload = await safetyDownloadPromise;
  assert.ok(
    safetyDownload.suggestedFilename().indexOf('nova-rx-before-restore-') === 0,
    'Safety copy filename prefix mismatch'
  );
  // step 2: replace + reload
  assert.equal(await redBtn.isDisabled(), false);
  var reloadPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await redBtn.click();
  await reloadPromise;

  var restoredVal = await page.evaluate(function () { return localStorage.getItem('nova-rx-test-k'); });
  assert.equal(restoredVal, 'v1', 'nova-rx-test-k should be restored to v1');

  var lastRestore = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('nova-rx-last-restore-v1') || 'null');
  });
  assert.ok(lastRestore && lastRestore.at, 'nova-rx-last-restore-v1 should be recorded');

  assert.equal(nativeDialogs.length, 0, 'No native dialogs allowed: ' + nativeDialogs.join('; '));
  assert.equal(pageErrors.length, 0, 'No page errors allowed: ' + pageErrors.join('; '));

  await browser.close();
  console.log('PASS: full-backup UX test');
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});