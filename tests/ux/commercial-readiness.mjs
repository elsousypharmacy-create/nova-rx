// Commercial & pharmacy readiness E2E: catalog CRUD, white-label profile, encrypted backup/restore drill,
// offline emergency-sales, English settings sub-tabs, and mobile /purchases nav unclipped.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json'
};

const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (u === '/' || u === '/whatsapp' || u === '/wa') u = '/index.html';
  if (u === '/purchases') u = '/purchases.html';
  const f = path.resolve(ROOT, '.' + u);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const snapshot = fs.readFileSync(path.join(ROOT, 'data', 'emergency-stock.json'), 'utf8');

async function blockExternal(ctx) {
  await ctx.route('**/*', r => {
    const u = r.request().url(), m = r.request().method();
    if (m !== 'GET' && m !== 'HEAD') return r.abort();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await blockExternal(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 1. Catalog CRUD: Add custom product with opening lot -> Sell -> Stock decrements -> Edit via Item Card -> Persist
  await page.addInitScript(() => {
    try { localStorage.setItem('nova-rx-language', 'ar'); } catch {}
  });
  await page.goto(BASE + '/index.html#products', { waitUntil: 'load' });
  await page.waitForSelector('#novaAddProductBtn');

  await page.click('#novaAddProductBtn');
  await page.waitForSelector('#novaProductModal');
  await page.fill('#novaNpName', 'كريم نيفا تجريبي');
  await page.fill('#novaNpBarcode', '6229990001122');
  await page.fill('#novaNpPrice', '85.5');
  await page.fill('#novaNpPack', 'أنبوب 50 جم');
  await page.fill('#novaNpCat', 'رف C4');
  await page.fill('#novaNpQty', '12');
  await page.fill('#novaNpExp', '2028-06');
  await page.click('#novaNpOk');
  await page.waitForSelector('#novaProductModal', { state: 'detached' });

  await page.fill('#novaFilter', '6229990001122');
  await page.waitForTimeout(150);
  const rowText = await page.locator('.nova-prod-panel tbody tr').first().innerText();
  assert.ok(rowText.includes('كريم نيفا تجريبي') && rowText.includes('85.50') && rowText.includes('12'), 'Added item visible in products: ' + rowText);

  // Sell 2 units on POS
  await page.click('.nova-tab[data-page="sale"]');
  await page.fill('#mainSearchInput', '6229990001122');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#invoiceTableBody tr').length === 1);
  await page.fill('#invoiceTableBody .qty-input', '2');
  await page.dispatchEvent('#invoiceTableBody .qty-input', 'change');
  await page.click('#btnCheckout');
  await page.waitForSelector('#checkoutModal.active');
  await page.click('.pay-method-btn[data-method="cash"]');
  await page.fill('#inputCashReceived', '200');
  await page.click('#btnConfirmPayment');
  await page.waitForTimeout(300);

  // Check stock decremented to 10 in Item Card and edit item price/name
  await page.click('.nova-tab[data-page="products"]');
  await page.fill('#novaFilter', '6229990001122');
  await page.waitForTimeout(150);
  const afterSaleRow = await page.locator('.nova-prod-panel tbody tr').first().innerText();
  assert.ok(afterSaleRow.includes('10'), 'Stock decremented to 10 after sale: ' + afterSaleRow);

  await page.locator('.nova-prod-panel tbody tr').first().click();
  await page.waitForSelector('.nova-ic-dialog');
  assert.equal(await page.locator('[data-ic-onhand]').innerText(), '10');
  await page.click('[data-ic-act="open-edit"]');
  await page.fill('#nova-ic-edit-name', 'كريم نيفا المعدل');
  await page.fill('#nova-ic-edit-price', '95.00');
  await page.click('#nova-ic-edit-submit');
  await page.waitForSelector('.nova-ic-banner-ok');
  assert.equal(await page.locator('#nova-ic-title').innerText(), 'كريم نيفا المعدل', 'Item card dialog title refreshes immediately after custom item edit');
  await page.click('.nova-ic-dialog [data-ic-act="close"]');
  await page.reload({ waitUntil: 'load' });
  await page.click('.nova-tab[data-page="products"]');
  await page.fill('#novaFilter', '6229990001122');
  await page.waitForTimeout(150);
  const editedRow = await page.locator('.nova-prod-panel tbody tr').first().innerText();
  assert.ok(editedRow.includes('كريم نيفا المعدل') && editedRow.includes('95.00'), 'Edited item persisted: ' + editedRow);
  console.log('ok - catalog add, opening lot, POS deduction, edit item, reload persist');

  // 2. White-label Pharmacy Profile -> Banner, Title, Thermal Receipt, Day Report, Emergency Sales
  await page.click('.nova-tab[data-page="settings"]');
  await page.waitForSelector('#novaPharmacyProfileCard');
  await page.fill('#novaProfName', 'صيدلية الشفاء الحديثة');
  await page.fill('#novaProfOwner', 'د. سارة منصور');
  await page.fill('#novaProfBranch', 'فرع المعادي');
  await page.fill('#novaProfPhone', '01001234567');
  await page.fill('#novaProfAddress', 'شارع 9 المعادي');
  await page.fill('#novaProfFooter', 'خدمة 24 ساعة');
  await page.click('#novaProfSave');
  await page.waitForFunction(() => (document.querySelector('.pharmacy-banner-copy strong') || {}).textContent === 'صيدلية الشفاء الحديثة');
  assert.ok((await page.title()).includes('صيدلية الشفاء الحديثة'), 'Document title updated');

  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.locator('.pharmacy-banner-copy strong').textContent(), 'صيدلية الشفاء الحديثة');
  assert.equal(await page.locator('.pharmacy-banner-copy span').textContent(), 'د. سارة منصور');

  const receiptHtml = await page.evaluate(() => {
    const s = window.novaSales.list()[0];
    window.novaReceipt.open(s, { copy: false });
    return document.getElementById('receiptSlipContent').innerText;
  });
  assert.ok(receiptHtml.includes('صيدلية الشفاء الحديثة') && receiptHtml.includes('فرع المعادي') && receiptHtml.includes('خدمة 24 ساعة'), 'Receipt uses white-label profile: ' + receiptHtml);
  await page.click('#btnCloseReceipt');

  await page.click('.nova-tab[data-page="reports"]');
  await page.waitForSelector('#novaPrintDay');
  await page.click('#novaPrintDay');
  const dayText = await page.locator('#novaDayReport').innerText();
  assert.ok(dayText.includes('صيدلية الشفاء الحديثة') && dayText.includes('د. سارة منصور') && dayText.includes('فرع المعادي'), 'Day report uses white-label profile');
  await page.click('#novaDayReportModal [data-dlg-close]');
  console.log('ok - white-label pharmacy profile across header, title, receipt, and day report');

  // 3. Full Encrypted Backup & Restore Drill
  const envStr = await page.evaluate(async () => {
    if (!window.novaFullBackup && window.novaLazy) await window.novaLazy.load();
    const res = await window.novaFullBackup.create('StrongPass123!');
    return JSON.stringify(res.envelope);
  });
  const env = JSON.parse(envStr);
  assert.equal(env.format, 'nova-rx-encrypted-backup');
  assert.ok(!envStr.includes('الشفاء') && !envStr.includes('نيفا'), 'Backup payload is encrypted (no plaintext leak)');

  // Wipe browser storage and verify defaults return
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.locator('.pharmacy-banner-copy strong').textContent(), 'صيدلية السوسي', 'Cleared back to default profile');
  const salesAfterClear = await page.evaluate(() => (window.novaSales ? window.novaSales.list().length : 0));
  assert.equal(salesAfterClear, 0, 'Sales wiped before restore');

  // Wrong passphrase fails; correct passphrase restores 100%
  const restoreResult = await page.evaluate(async rawEnv => {
    if (!window.novaFullBackup && window.novaLazy) await window.novaLazy.load();
    let wrongErr = '';
    try { await window.novaFullBackup.restore(rawEnv, 'WrongPass!'); } catch (e) { wrongErr = e.code || e.message; }
    const okRes = await window.novaFullBackup.restore(rawEnv, 'StrongPass123!');
    return { wrongErr, okRes };
  }, envStr);
  assert.equal(restoreResult.wrongErr, 'bad-passphrase-or-tampered');
  assert.ok(restoreResult.okRes && restoreResult.okRes.keyCount > 0, 'Restored keys: ' + JSON.stringify(restoreResult));

  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.locator('.pharmacy-banner-copy strong').textContent(), 'صيدلية الشفاء الحديثة', 'Restored custom profile');
  assert.equal(await page.evaluate(() => window.novaSales.list().length), 1, 'Restored sale');
  await page.click('.nova-tab[data-page="products"]');
  await page.fill('#novaFilter', '6229990001122');
  await page.waitForTimeout(150);
  const restoredProd = await page.locator('.nova-prod-panel tbody tr').first().innerText();
  assert.ok(restoredProd.includes('كريم نيفا المعدل') && restoredProd.includes('95.00') && restoredProd.includes('10'), 'Restored edited item + decremented lot');
  console.log('ok - encrypted .novabak backup & full restore drill verified');

  // 4. Offline Emergency Sales + White-label Title/Heading
  await page.goto(BASE + '/emergency-sales.html', { waitUntil: 'load' });
  assert.ok((await page.title()).includes('صيدلية الشفاء الحديثة'), 'Emergency page title uses custom profile');
  assert.ok((await page.locator('header h1').textContent()).includes('صيدلية الشفاء الحديثة'), 'Emergency H1 uses custom profile');
  await page.evaluate(rawSnap => {
    const parsed = window.NovaEmergency.parseSnapshot(rawSnap, { exportedAt: new Date().toISOString() });
    window.NovaEmergency.saveSnapshot(localStorage, parsed, { key: 'novaEmergencySnapshot' });
  }, snapshot);
  await page.reload({ waitUntil: 'load' });
  await page.fill('#who', 'أحمد');
  await page.fill('#q', 'جافيسكون');
  await page.waitForSelector('#results [data-add]');
  await page.click('#results [data-add]');
  await page.click('#bMake');
  await page.waitForFunction(() => document.getElementById('qCount').textContent.includes('1'));
  console.log('ok - emergency-sales.html offline snapshot + queue + custom pharmacy name');

  // 5. English Settings Sub-tabs
  await page.goto(BASE + '/index.html#settings', { waitUntil: 'load' });
  await page.click('.nova-lang-btn[data-lang="en"]');
  await page.waitForTimeout(250);
  const navText = await page.locator('.nova-set-nav').innerText();
  assert.ok(navText.includes('General') && /Lots\s*(?:&|and)\s*Expiry/i.test(navText) && navText.includes('Suppliers') && navText.includes('Accounts and permissions'), 'English settings nav sub-tabs complete: ' + navText);
  console.log('ok - English settings sub-tabs include Lots and expiry & Suppliers');

  assert.deepEqual(errors, [], 'No pageerrors on desktop');
  await ctx.close();

  // 6. Mobile /purchases top-nav unclipped check (428x926)
  const mobCtx = await browser.newContext({ viewport: { width: 428, height: 926 }, locale: 'ar-EG', hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await blockExternal(mobCtx);
  const mp = await mobCtx.newPage();
  await mp.goto(BASE + '/purchases.html', { waitUntil: 'load' });
  const maskStyle = await mp.evaluate(() => {
    const nav = document.querySelector('.nova-topbar nav');
    const cs = getComputedStyle(nav);
    return { mask: cs.maskImage, webkitMask: cs.webkitMaskImage };
  });
  assert.equal(maskStyle.mask, 'none', 'Mobile purchases nav has no mask clipping');
  assert.equal(maskStyle.webkitMask, 'none', 'Mobile purchases nav has no webkit-mask clipping');
  await mobCtx.close();
  console.log('ok - mobile /purchases nav has no edge clipping');

  // 7. Native Light Mode + Bulk CSV Import + 3-Step Quick Setup Wizard (clean buyer profile)
  const b3Ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await blockExternal(b3Ctx);
  const bp = await b3Ctx.newPage();
  const b3Errs = [];
  bp.on('pageerror', e => b3Errs.push(String(e)));

  await bp.addInitScript(() => {
    try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.setItem('nova-theme', 'light'); } catch {}
  });
  await bp.goto(BASE + '/index.html#sale', { waitUntil: 'load' });
  await bp.waitForSelector('#mainSearchInput');

  const lightCheck = await bp.evaluate(() => {
    const csHtml = getComputedStyle(document.documentElement);
    const csBody = getComputedStyle(document.body);
    return {
      attr: document.documentElement.getAttribute('data-nova-theme'),
      filter: csHtml.filter,
      bodyBg: csBody.backgroundColor
    };
  });
  assert.equal(lightCheck.attr, 'light');
  assert.equal(lightCheck.filter, 'none', 'Native Light Mode must not use filter:invert');
  assert.equal(lightCheck.bodyBg, 'rgb(245, 245, 247)', 'Apple Light Mode body background');

  // Bulk CSV Import
  await bp.click('.nova-tab[data-page="products"]');
  await bp.waitForSelector('#novaImportProductsBtn');
  await bp.click('#novaImportProductsBtn');
  await bp.waitForSelector('#novaImportModal');
  await bp.fill('#novaImpText', 'الاسم,الباركود,السعر,العبوة,التصنيف,الرصيد\nأدفيل ليكوي جيل 20,6227770003344,142.5,20 كبسولة,مسكنات,25');
  await bp.waitForFunction(() => !document.getElementById('novaImpOk').disabled);
  const prevRows = await bp.locator('#novaImpPreview tbody tr').count();
  assert.equal(prevRows, 1, 'Preview shows parsed CSV row');
  await bp.click('#novaImpOk');
  await bp.waitForSelector('#novaImportModal', { state: 'detached' });
  await bp.fill('#novaFilter', '6227770003344');
  await bp.waitForTimeout(150);
  const impRow = await bp.locator('.nova-prod-panel tbody tr').first().innerText();
  assert.ok(impRow.includes('أدفيل ليكوي جيل 20') && impRow.includes('142.50'), 'Bulk CSV imported item visible: ' + impRow);

  // Add imported item to cart on Light Mode POS and verify green/white checkout CTA contrast
  await bp.click('.nova-tab[data-page="sale"]');
  await bp.fill('#mainSearchInput', '6227770003344');
  await bp.keyboard.press('Enter');
  await bp.waitForFunction(() => document.querySelectorAll('#invoiceTableBody tr').length >= 1 && !document.getElementById('btnCheckout').disabled);
  await bp.waitForFunction(() => getComputedStyle(document.getElementById('btnCheckout')).backgroundColor === 'rgb(22, 163, 74)');
  const payActive = await bp.evaluate(() => {
    const btn = document.getElementById('btnCheckout');
    const cs = getComputedStyle(btn);
    return { disabled: btn.disabled, bg: cs.backgroundColor, color: cs.color };
  });
  assert.equal(payActive.disabled, false);
  assert.equal(payActive.bg, 'rgb(22, 163, 74)', 'Active pay CTA uses crisp emerald green in Light Mode');
  assert.equal(payActive.color, 'rgb(255, 255, 255)', 'Active pay CTA uses pure white text');

  // 3-Step Quick Setup Wizard -> hides demo badge + sets pharmacy identity & owner account
  await bp.click('.nova-tab[data-page="settings"]');
  await bp.waitForSelector('#novaOpenQuickSetupBtn');
  await bp.click('#novaOpenQuickSetupBtn');
  await bp.waitForSelector('#novaQuickSetupModal');
  await bp.fill('#novaQsName', 'صيدلية النور');
  await bp.fill('#novaQsOwner', 'د. سارة علي');
  await bp.fill('#novaQsBranch', 'فرع المعادي');
  await bp.click('#novaQsStep1Next');
  await bp.waitForSelector('#novaQsAdminPw');
  await bp.fill('#novaQsAdminPw', 'OwnerPass123');
  await bp.click('#novaQsStep2Ok');
  await bp.waitForSelector('#novaQsStartSale');
  await bp.click('#novaQsStartSale');
  await bp.waitForSelector('#novaQuickSetupModal', { state: 'detached' });
  const postSetup = await bp.evaluate(() => ({
    banner: document.querySelector('.pharmacy-banner-copy strong')?.textContent || '',
    demoHidden: !!document.querySelector('.nova-demo-label')?.hidden,
    hasAcc: !!(window.novaAuth && window.novaAuth.hasAccounts()),
    curRole: window.novaAuth?.current()?.role || ''
  }));
  assert.equal(postSetup.banner, 'صيدلية النور');
  assert.equal(postSetup.demoHidden, true, 'Demo pill hides after pharmacy profile customization');
  assert.equal(postSetup.hasAcc, true);
  assert.equal(postSetup.curRole, 'owner');
  assert.deepEqual(b3Errs, [], 'No pageerrors on Batch 3 checks');
  await b3Ctx.close();
  console.log('ok - Native Light Mode, Bulk CSV import, and 3-step Quick Setup verified');
  console.log('PASS commercial-readiness: 7 groups');
} finally {
  await browser.close();
  srv.close();
}
