import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// PUR-02: purchases hub (طلب | استلام | سجل الفواتير). Fake data only; every non-GET request is blocked unless it is a mocked read-only /api call.
const BASE = process.env.NOVA_HUB_URL || 'http://127.0.0.1:8766/';
const SHOTS = process.env.NOVA_SHOTS || 'qa/screens/PUR-02';
const stamp = new Date().toISOString();
const stock = [{ id: '1', code: '1301', name: 'صنف تجريبي', nameEn: 'Hub 500mg', stock: 1, minStock: 4, idealStock: 8, dailySales: null, observedDays: 0 }];
let expired = true, stockStatus = 200, writes = [];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    if (sessionStorage.getItem('hub-seeded')) return; sessionStorage.setItem('hub-seeded', '1');
    localStorage.setItem('novaApiPin', 'test-pin');
    localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet', 'pharmaoverseas'], aumetSellers: ['one', 'two', 'three'] }));
  });
  await context.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== new URL(BASE).origin) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    if (u.pathname === '/api/purchases/stock') { // read-only POST (existing contract)
      return route.fulfill({ status: stockStatus, contentType: 'application/json', body: JSON.stringify(stockStatus === 200 ? { ok: true, schemaVersion: 1, sourceUpdatedAt: stamp, items: stock } : { ok: false, error: 'source-unavailable' }) });
    }
    if (req.method() !== 'GET') { writes.push(req.method() + ' ' + u.pathname); return route.fulfill({ status: 403, body: '{}' }); }
    const data = u.pathname === '/api/suppliers/status' ? { suppliers: [{ id: 'aumet', state: expired ? 'expired' : 'ok' }, { id: 'pharmaoverseas', state: 'ok' }] } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage(), errors = [], navs = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url()); });
  fs.mkdirSync(SHOTS, { recursive: true });

  // --- طلب tab: auto-load, labelled chips, banner, one primary CTA
  await page.goto(BASE + 'purchases.html');
  await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-key]').length === 1);
  assert.equal(await page.locator('#tabNeeds').getAttribute('aria-selected'), 'true');
  assert.equal((await page.locator('#scopeChip').innerText()).trim(), 'موردين: 2 · مخازن أوميت: 3');
  await page.waitForTimeout(600); assert.equal(await page.locator('#sessionBanner').isVisible(), false, 'owner 20 Nov: no supplier session banner');
  assert.equal(await page.locator('#loadMock:visible').count(), 0, 'demo data button is not on the page surface');
  await page.locator('.tools-menu summary').click();
  assert.equal(await page.locator('.tools-pop').getByText('بيانات تجريبية').count(), 0, 'no demo data in the ⋮ menu');
  assert.ok(await page.locator('.tools-pop').getByText('الموردون والمخازن').count() >= 1, 'supplier/warehouse settings grouped in the menu');
  await page.locator('.tools-menu summary').click();
  assert.equal(await page.locator('main button.primary:visible').evaluateAll(b => b.filter(x => !x.closest('dialog,[hidden]') && !x.closest('#sessionBanner')).length), 1, 'one primary CTA on the needs tab');
  await page.screenshot({ path: SHOTS + '/01-talab.png' });
  // renew button opens the existing read-only settings/reconnect flow
  await page.locator('#renewSession').click();
  await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#settings .close').click();
  // the demo button lives in the settings dialog's advanced area
  await page.locator('#openSettings').click(); await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#advSettings summary').click(); assert.ok(await page.locator('#advSettings #loadMock').isVisible());
  await page.locator('#settings .close').click();

  // --- tab switching without navigation
  await page.evaluate(() => { window.__hubMarker = 'same-document'; });
  await page.locator('#tabReceive').click();
  assert.equal(await page.locator('#tabReceive').getAttribute('aria-selected'), 'true');
  assert.ok(page.url().endsWith('/purchases.html#receive'));
  const frame = page.frameLocator('#receiveFrame');
  await frame.locator('.rcv').waitFor();
  assert.equal(await frame.locator('.nova-nav-row').isVisible(), false, 'embedded receiving hides the app top bar');
  assert.ok((await frame.locator('.rcv-kpi strong').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))) >= 24, 'KPI numbers readable');
  await page.screenshot({ path: SHOTS + '/02-receive.png' });
  // PUR-01 dialog opens directly from the primary button
  await frame.locator('[data-rcv="new"]').click();
  await frame.locator('#rcvForm').waitFor();
  await page.screenshot({ path: SHOTS + '/03-receive-dialog.png' });
  await frame.locator('[data-rcv-close]').first().click();
  // empty state -> طلب
  await frame.locator('[data-rcv="needs"]').click();
  await page.waitForFunction(() => document.getElementById('tabNeeds').getAttribute('aria-selected') === 'true');
  await page.locator('#tabHistory').click();
  assert.ok((await page.locator('#panelHistory').innerText()).includes('سجل الفواتير'));
  assert.ok(page.url().endsWith('#history'));
  await page.screenshot({ path: SHOTS + '/04-history.png' });
  await page.locator('#tabNeeds').click();
  assert.equal(await page.evaluate(() => window.__hubMarker), 'same-document', 'no page reload on tab switches');
  assert.ok(navs.every(u => /\/purchases\.html(#\w+)?$/.test(u)), 'main frame never left purchases.html: ' + navs.join(','));
  assert.equal(await page.evaluate(() => localStorage.getItem('nova.activePage')), null, 'embedded receiving did not change the app home page');

  // --- deep links
  await page.goto(BASE + 'purchases.html#receive');
  assert.equal(await page.locator('#tabReceive').getAttribute('aria-selected'), 'true');
  await page.goto(BASE + 'purchases.html#history');
  assert.equal(await page.locator('#tabHistory').getAttribute('aria-selected'), 'true');
  // old receiving screen still works standalone
  await page.goto(BASE + '#receiving'); await page.locator('.rcv').waitFor();
  assert.ok(await page.locator('.nova-nav-row').isVisible());

  // --- error state + healthy session hides banner
  expired = false; stockStatus = 503;
  await page.goto(BASE + 'purchases.html');
  await page.locator('.load-error').waitFor();
  assert.equal(await page.locator('#sessionBanner').isHidden(), true);
  await page.screenshot({ path: SHOTS + '/05-needs-error.png' });
  assert.deepEqual(writes, [], 'no write requests');
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  console.log('PASS purchases hub: tabs, no navigation, deep links, auto-load, banner, demo moved, embedded receiving (fake data)');
} finally { await browser.close(); }
