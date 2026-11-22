import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// OPS-NEEDS Phase 1 UX checks: filter summary, offers modal recovery, search add/increment,
// trash + qty-0 delete + undo, no control overlap, no horizontal overflow (synthetic fixtures only).
const stamp = new Date().toISOString();
const stock = ['found', 'none', 'flaky'].map((k, i) => ({
  id: String(i + 1),
  code: String(1301 + i),
  name: `صنف ${k}`,
  nameEn: `Ux${k} 500mg 20 tabs`,
  stock: i === 0 ? 0 : 1,
  minStock: 4,
  idealStock: 8,
  dailySales: 0.5,
  observedDays: 14,
  cheapestSupplier: 'أوميت',
  purchasePrice: 45
}));
const extraCatalog = [
  { id: 'c-new', code: '9001', gtin: '6221000009001', name: 'صنف جديد للاختبار', nameEn: 'NewItem 500mg', stock: 2, dailySales: 0.4, cheapestSupplier: 'أوميت', price: 32, purchasePrice: 32 }
];
const offerFor = q => ({
  offer: {
    supplierId: 'aumet',
    sellerId: 'one',
    sellerName: 'مخزن تجريبي أ',
    supplierProductId: 'one' + q,
    productName: q,
    availableQuantity: 100,
    unitPrice: 40,
    publicPrice: 100,
    stockStatus: 'in_stock',
    currency: 'EGP',
    lastUpdated: stamp
  }
});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await context.addInitScript((cat) => {
    window.NOVA_NEEDS_CATALOG = cat;
    localStorage.setItem('novaApiPin', 'test-pin');
    localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet'], aumetSellers: ['one', 'two'] }));
  }, extraCatalog);
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data, status = 200;
    if (path === '/api/purchases/stock') {
      let pin = '';
      try { pin = String((route.request().postDataJSON() || {}).dashboardPin || ''); } catch {}
      if (!pin) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'source-auth-required' }) });
        return;
      }
      data = { ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock };
    } else if (path === '/api/suppliers/status') {
      data = { suppliers: [{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'ok' }] };
    } else if (path === '/api/suppliers/sellers') {
      data = { sellers: [{ id: 'one', name: 'مخزن تجريبي أ' }, { id: 'two', name: 'مخزن تجريبي ب' }] };
    } else if (path === '/api/suppliers/search') {
      const body = route.request().postDataJSON();
      const rows = /none/.test(body.query) ? [] : [offerFor(body.query)];
      data = { suppliers: [{ id: 'aumet', state: 'ok' }], results: [{ offers: rows }] };
    } else return route.fulfill({ status: 404, body: '{}' });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8766/purchases.html');

  // Unlock via ONE PIN flow
  // q17 C: the list opens without a PIN; «حدّث النواقص» shows the PIN card for a fresh stock load
  await page.waitForFunction(() => document.getElementById('panelNeeds')?.dataset.local === '1' || document.getElementById('dashboard-style')?.offsetParent, null, { timeout: 5000 }).catch(() => {});
  if (!(await page.locator('#dashboard-style').isVisible())) await page.evaluate(() => { const b = document.getElementById('load'); (b && b.offsetParent ? b : document.getElementById('phoneRefreshBtn')).click(); });
  await page.locator('#dashboard-style').waitFor({ state: 'visible' });
  await page.locator('#dashboard-style').fill('synthetic-owner-pin');
  await page.locator('[data-empty-act=unlock]').click();
  await page.locator('#rows tr.needs-row').first().waitFor();

  // Filter summary reflects prefs
  assert.equal((await page.locator('#inlineSupplierText').innerText()).trim(), 'أوميت');
  assert.equal((await page.locator('#tileFilterSummary').innerText()).trim(), 'أوميت · 3 أسابيع');

  // Offers modal still opens on supplier click and updates row price
  await page.locator('#rows tr.needs-row').first().locator('[data-action=offers]').click();
  await page.locator('[data-offer]').first().waitFor();
  await page.locator('[data-offer]').first().click();
  assert((await page.locator('#rows tr.needs-row').first().innerText()).includes('40.00'));

  // Search add + duplicate increment + delete + undo
  await page.locator('#needsSearchInput').fill('صنف جديد');
  await page.locator('#needsSearchDropdown .needs-dd-o').first().waitFor({ state: 'visible' });
  await page.locator('#needsSearchInput').press('Enter');
  assert.equal(await page.locator('#rows tr.needs-row').count(), 4);
  assert.equal(await page.locator('#rows tr.needs-row').first().locator('[data-qty-val]').innerText(), '1');
  await page.locator('#needsSearchInput').fill('صنف جديد');
  await page.locator('#needsSearchDropdown .needs-dd-o').first().waitFor({ state: 'visible' });
  await page.locator('#needsSearchInput').press('Enter');
  assert.equal(await page.locator('#rows tr.needs-row').count(), 4, 'no duplicate row');
  assert.equal(await page.locator('#rows tr.needs-row').first().locator('[data-qty-val]').innerText(), '2');

  // Trash delete + undo restores row
  await page.locator('#rows tr.needs-row').first().locator('[data-action=delete]').click();
  await page.locator('#needsUndoToast').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#rows tr.needs-row').count(), 3);
  await page.locator('#needsUndoBtn').click();
  assert.equal(await page.locator('#rows tr.needs-row').count(), 4);

  // No overlap in wide header/rail controls and no horizontal overflow across 1280, 1180, 390
  const overlap = async () => page.evaluate(() => {
    const ids = ['prepareOrderBtn', 'tileAddItemBtn', 'tileFilterBtn', 'load', 'tileDraftsBtn'];
    const r = ids.map(id => document.getElementById(id).getBoundingClientRect());
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return ids[i] + '/' + ids[j];
    }
    return null;
  });
  assert.equal(await overlap(), null);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1180, height: 820 });
  assert.equal(await overlap(), null);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  assert.deepEqual(errors, []);
  console.log('PASS purchases UX: OPS-NEEDS filter summary, offers pick, search add/increment, undo, no overlap (synthetic, not live)');
} finally {
  await browser.close();
}
