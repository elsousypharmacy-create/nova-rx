import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// #116: per-row offer states, selected-warehouse scope chip, seller-scope cart message.
// Synthetic fixtures only (intercepted routes). Nothing here talks to a real supplier.
const stamp = new Date().toISOString();
const stock = ['found', 'none', 'flaky', 'partial', 'pfound'].map((k, i) => ({ id: String(i + 1), code: String(1301 + i), name: `صنف ${k}`, nameEn: `Ux${k} 500mg 20 tabs`, stock: 1, minStock: 4, idealStock: 8, dailySales: null, observedDays: 0 }));
let searchCalls = 0, flakyFailures = 1, scopeBody = null;
const offerFor = q => ({ offer: { supplierId: 'aumet', sellerId: 'one', sellerName: 'مخزن تجريبي أ', supplierProductId: 'one' + q, productName: q, availableQuantity: 100, unitPrice: 40, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    localStorage.setItem('novaApiPin', 'test-pin');
    localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet'], aumetSellers: ['one', 'two'] }));
  });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data, status = 200;
    if (path === '/api/purchases/stock') data = { ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock };
    else if (path === '/api/suppliers/status') data = { suppliers: [{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'ok' }] };
    else if (path === '/api/suppliers/sellers') data = { sellers: [{ id: 'one', name: 'مخزن تجريبي أ' }, { id: 'two', name: 'مخزن تجريبي ب' }] };
    else if (path === '/api/purchases/aumet-cart/preview') { scopeBody = route.request().postDataJSON(); status = 409; data = { ok: false, error: 'cart-seller-not-selected' }; }
    else if (path === '/api/suppliers/search') {
      const body = route.request().postDataJSON(); searchCalls++;
      await new Promise(r => setTimeout(r, 450)); // keep the "searching" state observable
      if (/flaky/.test(body.query) && flakyFailures > 0) { flakyFailures--; return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream"}' }); }
      // A supplier that did not answer (state error) makes the search INCOMPLETE even with HTTP 200.
      if (/partial/.test(body.query)) { data = { suppliers: [{ id: 'aumet', state: 'error', message: 'x' }], results: [{ offers: [] }] }; }
      else if (/pfound/.test(body.query)) { data = { suppliers: [{ id: 'aumet', state: 'error', message: 'x' }], results: [{ offers: [offerFor(body.query)] }] }; }
      else { const rows = /none/.test(body.query) ? [] : [offerFor(body.query)]; data = { suppliers: [{ id: 'aumet', state: 'ok' }], results: [{ offers: rows }] }; }
    } else return route.fulfill({ status: 404, body: '{}' });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8766/purchases.html');

  // Scope chip: two selected warehouses, English digits, display only.
  const chip = page.locator('#scopeChip');
  assert.equal((await chip.innerText()).trim(), 'أوميت: 2 مخازن');
  assert.equal(await chip.getAttribute('data-state'), 'ok');

  // Load stock (first load asks for the dashboard PIN, same flow as the main purchasing test).
  await page.locator('#load').click(); await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#dashboardPin').fill('synthetic-owner-pin'); await page.locator('#saveSettings').click();
  await page.locator('[data-action=qty]').first().waitFor();
  assert.equal(await page.locator('.offer-state').count(), 0, 'unsearched rows carry no offer state');
  assert((await page.locator('#rows').innerText()).includes('اختَر عرضًا أو وزّع تلقائيًا'));

  // Distribution: a row being searched is visibly "searching", then none / error / found are distinct.
  await page.locator('#distribute').click();
  await page.locator('.offer-state[data-state=searching]').first().waitFor({ timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById('distribute').disabled, { timeout: 30000 });
  assert.equal(await page.locator('.offer-state[data-state=searching]').count(), 0, 'no row stays in searching');
  assert.equal(await page.locator('.offer-state[data-state=none]').count(), 1);
  assert.equal(await page.locator('.offer-state[data-state=error]').count(), 1);
  assert.equal(await page.locator('.supplier-select').count(), 2);
  // An empty result from an INCOMPLETE search is never shown as "no suitable offer".
  assert.equal(await page.locator('.offer-state[data-state=incomplete]').count(), 1);
  assert((await page.locator('.offer-state[data-state=incomplete]').innerText()).includes('لم يكتمل'));
  assert.equal(await page.locator('.offer-state[data-state=none]').count(), 1, 'only the genuinely empty, complete search says none');
  // Offers found by a partial search are kept but flagged as incomplete.
  assert.equal(await page.locator('.partial-note').count(), 1);
  assert((await page.locator('.offer-state[data-state=none]').innerText()).includes('لا عرض مناسب'));
  assert((await page.locator('.offer-state[data-state=error]').innerText()).includes('تعذر البحث'));
  const noneRow = page.locator('tr', { has: page.locator('.offer-state[data-state=none]') });
  const errRow = page.locator('tr', { has: page.locator('.offer-state[data-state=error]') });

  // Retry and manual selection stay available: the error row recovers through the offers dialog.
  assert(await noneRow.locator('[data-action=offers]').isEnabled());
  await errRow.locator('[data-action=offers]').click();
  await page.locator('[data-offer]').first().waitFor();
  await page.locator('[data-offer]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.offer-state[data-state=error]').length === 0);
  assert.equal(await page.locator('.supplier-select').count(), 3, 'manual pick turned the failed row into a found row');
  await noneRow.locator('[data-action=offers]').click(); await page.locator('#offerRows').waitFor();
  await page.locator('#closeOffers').click();
  assert.equal(await page.locator('.offer-state[data-state=none]').count(), 1, 'a genuinely empty row stays "no suitable offer"');

  // Seller-scope cart error is an actionable Arabic message, not the generic fallback.
  await page.locator('#review').click(); await page.locator('#saveDraft').click();
  await page.locator('#prepareAumet').click();
  await page.getByText('ليس ضمن مخازن أوميت المختارة', { exact: false }).first().waitFor({ timeout: 10000 });
  assert.deepEqual(scopeBody.aumetSellerIds, ['one', 'two'], 'the cart preview carries the selected warehouses (provider change from #119)');
  await page.locator('#closeReview').click();

  // Layout: no horizontal overflow and no overlap in the controls row, tablet and phone.
  const overlap = async () => page.evaluate(() => {
    const ids = ['days', 'scopeChip', 'load', 'distribute'];
    const r = ids.map(id => document.getElementById(id).getBoundingClientRect());
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return ids[i] + '/' + ids[j];
    }
    return null;
  });
  assert.equal(await overlap(), null);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  fs.mkdirSync('reports/purchasing', { recursive: true });
  const badge = async () => page.evaluate(() => { if (document.getElementById('uxBadge')) return; const b = document.createElement('div'); b.id = 'uxBadge'; b.textContent = 'اختبار الواجهة • بيانات توضيحية'; b.style.cssText = 'position:fixed;bottom:4px;left:50%;transform:translateX(-50%);z-index:99999;background:#344354;color:white;border-radius:5px;padding:3px 10px;font:12px Cairo,Tahoma,sans-serif'; document.body.appendChild(b); });
  await badge(); await page.screenshot({ path: 'reports/purchasing/ux-tablet.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await overlap(), null); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'reports/purchasing/ux-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Scope chip follows preference changes and never widens the search.
  const before = searchCalls;
  await page.locator('#openSettings').click(); await page.locator('#refreshSellers').click(); await page.locator('[data-seller=two]').waitFor(); await page.locator('[data-seller=two]').uncheck(); await page.locator('#saveSettings').click();
  assert.equal((await chip.innerText()).trim(), 'أوميت: 1 مخزن');
  assert.equal(await page.locator('.offer-state').count(), 0, 'saving settings clears stale offer states');
  await page.locator('#openSettings').click(); await page.locator('#refreshSellers').click(); await page.locator('[data-seller=one]').waitFor(); await page.locator('[data-seller=one]').uncheck(); await page.locator('#saveSettings').click();
  assert.equal((await chip.innerText()).trim(), 'أوميت: لا مخازن مختارة');
  assert.equal(await chip.getAttribute('data-state'), 'warn');
  await page.locator('[data-action=select]').first().check().catch(() => {});
  await page.locator('#distribute').click();
  await page.waitForTimeout(400);
  assert.equal(searchCalls, before, 'zero selected warehouses must not search Aumet at all');
  await badge(); await page.screenshot({ path: 'reports/purchasing/ux-zero-scope.png' });
  assert.deepEqual(errors, []);
  console.log('PASS purchases UX: offer states, scope chip, seller-scope message, no overlap (synthetic, not live)');
} finally { await browser.close(); }
