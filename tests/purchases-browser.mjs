import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// OPS-NEEDS Phase 1 browser workflow (synthetic data only; ZERO supplier cart/order writes).
const stamp = new Date().toISOString();
const stock = Array.from({ length: 4 }, (_, i) => ({
  id: String(i + 1),
  code: String(1201 + i),
  name: `صنف اختباري ${i + 1}`,
  nameEn: `Testdrug${i + 1} 500mg 20 tabs`,
  stock: i === 0 ? 0 : 2,
  minStock: 4,
  idealStock: 10,
  dailySales: 0.5,
  observedDays: 14,
  cheapestSupplier: 'أوميت',
  purchasePrice: 40 + i * 5
}));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const writeCalls = [];
  await context.addInitScript(() => {
    localStorage.setItem('novaApiPin', 'test-pin');
    localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet'], aumetSellers: ['one', 'two'] }));
  });
  await context.route('**/api/**', async route => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    let data;
    if (pathname === '/api/purchases/stock') {
      let pin = '';
      try { pin = String((req.postDataJSON() || {}).dashboardPin || ''); } catch {}
      if (!pin) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'source-auth-required' }) });
        return;
      }
      data = { ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock };
    } else if (pathname === '/api/suppliers/status') {
      data = { suppliers: [{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'ok' }] };
    } else if (pathname === '/api/suppliers/sellers') {
      data = { sellers: [{ id: 'one', name: 'مخزن تجريبي أ' }, { id: 'excluded', name: 'مخزن مستبعد' }, { id: 'two', name: 'مخزن تجريبي ب' }] };
    } else {
      if (req.method() !== 'GET') writeCalls.push(`${req.method()} ${pathname}`);
      return route.fulfill({ status: 404, body: '{}' });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('http://127.0.0.1:8766/purchases.html');
  await page.locator('#dashboard-style').waitFor({ state: 'visible' });
  assert((await page.locator('#needsStagePill').innerText()).includes('مرحلة 1 من 5'));
  await page.locator('#dashboard-style').fill('synthetic-owner-pin');
  await page.locator('[data-empty-act=unlock]').click();
  await page.waitForFunction(() => document.querySelectorAll('#rows tr.needs-row').length === 4);
  assert.equal(await page.locator('#rows tr.needs-row [data-qty-val]').first().innerText(), '11');

  // Arabic-Indic digits coverage days in filter dialog
  await page.locator('#tileFilterBtn').click();
  await page.locator('#days').fill('٢٣');
  await page.locator('#applyFilterDialog').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchasePrefsV1')).days), 23);

  // Top nav links preserved in exact order with direct /purchases tab
  const navLinks = await page.locator('.nova-topbar nav a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  assert.deepEqual(navLinks, ['/#sale', '/#invoices', '/#customers', '/purchases', '/#receiving', '/#products', '/#reports', '/#settings']);

  // Local-only order draft (NEVER calls supplier cart/order API)
  await page.locator('#prepareOrderBtn').click();
  await page.locator('#localDraftDialog').waitFor({ state: 'visible' });
  assert((await page.locator('#localDraftDialog').innerText()).includes('مش بتتبعت للمورد'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchaseDraftV1')));
  assert.equal(saved.state, 'local-draft');
  assert.equal(saved.itemCount, 4);
  assert.deepEqual(writeCalls, [], 'no supplier cart/order POST/PUT calls');
  await page.locator('#closeLocalDraftOk').click();

  // Supplier/warehouse settings cancel preserves selection; save updates prefs; no duplicate #dashboardPin
  await page.locator('#tileFilterBtn').click();
  await page.locator('#openSettings').click();
  assert.equal(await page.locator('#dashboardPin').count(), 0);
  await page.locator('#refreshSellers').click();
  await page.locator('[data-seller=two]').waitFor();
  await page.locator('[data-seller=two]').uncheck();
  await page.locator('#settings .close').click();

  await page.locator('#tileFilterBtn').click();
  await page.locator('#openSettings').click();
  assert(await page.locator('[data-seller=two]').isChecked(), 'cancel preserves seller selection');
  await page.locator('[data-seller=two]').uncheck();
  await page.locator('#saveSettings').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchasePrefsV1')).aumetSellers), ['one']);

  // Geometry checks: no horizontal overflow at 1280x800 and 390x844, CTA visible in viewport
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: innerHeight,
    scrollHeight: document.documentElement.scrollHeight
  }));
  assert.equal(geometry.width, geometry.scrollWidth);
  assert.equal(geometry.height, geometry.scrollHeight);
  const ctaRect = await page.locator('#prepareOrderBtn').boundingBox();
  assert(ctaRect && ctaRect.y + ctaRect.height <= geometry.height, 'primary CTA visible in viewport');

  fs.mkdirSync('reports/purchasing', { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  fs.writeFileSync('reports/purchasing/browser.json', JSON.stringify({
    result: 'PASS',
    syntheticData: true,
    geometry,
    checks: ['free-form Arabic days', 'read-only stock', 'local-only draft', 'cancel settings', 'no duplicate PIN', 'wide and phone layout'],
    errors
  }, null, 2));
  console.log('PASS purchasing browser workflow (OPS-NEEDS Phase 1, synthetic data)');
} finally {
  await browser.close();
}
