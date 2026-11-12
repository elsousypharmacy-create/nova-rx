// N28 (BUY-03): Multi-select suppliers with saved exclusions; auto-suggest split vs manual mode
// comparing price, availability, minimum order and shipping; split explained and editable (mock data).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  buildNeeds,
  filterOffers,
  distribute,
  compareSplitModes,
  applyManualSplit,
  groupCart,
  offerKey,
  createMockPurchasingScenario,
} from '../purchases-core.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const scenario = createMockPurchasingScenario(now);
const needs = buildNeeds(scenario.items, scenario.prefs);
assert.equal(needs.length, 2);
const [omeprazole, concor] = needs.map(i => ({ ...i, selected: true }));
assert.equal(omeprazole.qty, 10);
assert.equal(concor.qty, 6);

// 1. Unit checks: saved exclusions, price/availability/MOQ/shipping comparison, auto vs manual mode, editable split
{
  const omOffers = scenario.offersByQuery[omeprazole.nameEn];
  const filtered = filterOffers(omeprazole, omOffers, scenario.prefs, now);
  const exclRow = filtered.find(r => r.offer.sellerId === 's-excl');
  assert.equal(exclRow.eligible, false);
  assert.equal(exclRow.reason, 'المخزن مستبعد');

  const suppExcl = filterOffers(omeprazole, omOffers, { ...scenario.prefs, excludedSuppliers: ['pharmaoverseas'] }, now);
  assert.equal(suppExcl.find(r => r.offer.supplierId === 'pharmaoverseas').eligible, false);
  assert.equal(suppExcl.find(r => r.offer.supplierId === 'pharmaoverseas').reason, 'المورد مستبعد');

  const cmp = compareSplitModes(omeprazole, omOffers, scenario.prefs, now);
  assert.deepEqual(
    cmp.auto.allocations.map(a => [a.offer.sellerId, a.qty, a.price, a.shipping]),
    [
      ['s-nour', 4, 45, 0],
      ['po-main', 6, 52, 0],
    ],
    'auto mode splits 10 into 4 (best price 45, max avail 4) + 6 (price 52, subtotal 312 >= 300 waives 15 shipping)'
  );
  assert.equal(cmp.autoTotal, 492);
  assert.deepEqual(
    cmp.single.allocations.map(a => [a.offer.sellerId, a.qty, a.price]),
    [['po-main', 10, 52]],
    'manual/single mode selects single supplier covering all 10 without auto-splitting'
  );
  assert.equal(cmp.singleTotal, 520);
  assert.equal(cmp.savings, 28);
  assert(cmp.auto.splitExplanation.includes('توزيع تلقائي مقسم على 2 عروض'));

  // Item 2 (Concor, qty 6): MOQ and shipping comparison
  const coOffers = scenario.offersByQuery[concor.nameEn];
  const coDist = distribute(concor, coOffers, scenario.prefs, now);
  assert.equal(coDist.allocations.length, 1);
  assert.equal(coDist.allocations[0].offer.supplierId, 'pharmaoverseas', '75 EGP free shipping (450) beats 72 EGP + 45 shipping (477), while 70 EGP MOQ 10 is skipped');
  assert.equal(coDist.totalCost, 450);
  assert(coDist.splitExplanation.includes('مخزن الشفاء'), 'explanation cites skipped MOQ warehouse');

  // Editable manual split validation and application
  const nourKey = offerKey(omOffers[1].offer);
  const poKey = offerKey(omOffers[2].offer);
  const deltaKey = offerKey(omOffers[3].offer);
  assert.throws(
    () => applyManualSplit(omeprazole, omOffers, [{ key: nourKey, qty: 1 }], scenario.prefs, now),
    /الحد الأدنى/,
    'rejects qty below MOQ (2)'
  );
  assert.throws(
    () => applyManualSplit(omeprazole, omOffers, [{ key: nourKey, qty: 5 }], scenario.prefs, now),
    /تتجاوز المتاح/,
    'rejects qty above availableQuantity (4)'
  );
  assert.throws(
    () => applyManualSplit(omeprazole, omOffers, [{ key: poKey, qty: 11 }], scenario.prefs, now),
    /يتجاوز الكمية المطلوبة/,
    'rejects split sum above needed item qty (10)'
  );
  const edited = applyManualSplit(
    omeprazole,
    omOffers,
    [
      { key: nourKey, qty: 3 },
      { key: poKey, qty: 5 },
      { key: deltaKey, qty: 2 },
    ],
    scenario.prefs,
    now
  );
  assert.equal(edited.manualSplit, true);
  assert.equal(edited.unallocated, 0);
  assert.equal(edited.totalCost, 526);
  assert.equal(edited.totalShipping, 15);
  assert(edited.splitExplanation.includes('توزيع يدوي معدل'));

  const grouped = groupCart([{ ...omeprazole, ...edited }]);
  assert.equal(grouped.length, 3);
  assert.equal(grouped.find(g => g.supplierId === 'pharmaoverseas').shipping, 15);
}

// 2. Browser UI test on purchases.html (mock mode, zero external calls)
let localServer = null;
async function resolveBaseUrl() {
  if (process.env.NOVA_BUY03_URL) return process.env.NOVA_BUY03_URL;
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  localServer = http.createServer((req, res) => {
    const clean = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(process.cwd(), clean);
    if (!file.startsWith(process.cwd()) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => localServer.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${localServer.address().port}/purchases.html`;
}

const pageUrl = await resolveBaseUrl();
const origin = new URL(pageUrl).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let apiCalls = 0;
  await context.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/api/')) {
      apiCalls++;
      return route.fulfill({ status: 500, body: '{"error":"backend-frozen"}' });
    }
    if (u.startsWith(origin) || u.startsWith('data:')) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pageUrl, { waitUntil: 'load' });

  // Load mock dataset via UI button
  await page.locator('#loadMock').click();
  await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-key]').length === 2);
  assert.equal(apiCalls, 0, 'mock mode never contacts backend or real supplier endpoints');

  // Auto mode is active by default and splits Omeprazole (10 packs) across 2 offers (4 + 6)
  assert.equal(await page.locator('#modeAuto').getAttribute('aria-pressed'), 'true');
  const row1 = page.locator('#rows tr[data-key="mock-1::pack"]');
  const row2 = page.locator('#rows tr[data-key="mock-2::pack"]');
  assert((await row1.innerText()).includes('مقسم على 2 عروض (مخزن النور: 4 + فرع القاهرة: 6)'));
  assert((await row2.innerText()).includes('فرع القاهرة'));
  assert.equal(await page.locator('#total').innerText(), '942 ج.م');

  // Switch to Manual mode: disables auto-splitting and picks single supplier (10 from فرع القاهرة = 520 + 450 = 970)
  await page.locator('#modeManual').click();
  assert.equal(await page.locator('#modeManual').getAttribute('aria-pressed'), 'true');
  assert(!(await row1.innerText()).includes('مقسم على 2 عروض'));
  assert.equal(await page.locator('#total').innerText(), '970 ج.م');

  // Switch back to Auto-suggest split mode: restores 4 + 6 split and 942 EGP total
  await page.locator('#modeAuto').click();
  assert.equal(await page.locator('#modeAuto').getAttribute('aria-pressed'), 'true');
  assert((await row1.innerText()).includes('مقسم على 2 عروض (مخزن النور: 4 + فرع القاهرة: 6)'));
  assert.equal(await page.locator('#total').innerText(), '942 ج.م');

  // Open Offers & Split Editor dialog on Omeprazole
  await row1.locator('[data-action=offers]').click();
  await page.locator('#splitComparison').waitFor({ state: 'visible' });
  const cmpText = await page.locator('#splitComparison').innerText();
  assert(cmpText.includes('التوفير بالتقسيم التلقائي: 28 ج.م'));
  assert((await page.locator('#offerRows').innerText()).includes('المخزن مستبعد'));

  // Test MOQ validation in split editor (Nour has MOQ 2)
  await page.locator('[data-split-input="1"]').fill('1');
  await page.locator('[data-split-input="2"]').fill('9');
  await page.locator('#applySplitEdit').click();
  assert((await page.locator('#splitEditStatus').innerText()).includes('الحد الأدنى'));

  // Edit split to 3 (Nour) + 5 (PharmaOverseas) + 2 (Delta) = 10 packs
  await page.locator('[data-split-input="1"]').fill('3');
  await page.locator('[data-split-input="2"]').fill('5');
  await page.locator('[data-split-input="3"]').fill('2');
  await page.locator('#applySplitEdit').click();
  await page.waitForFunction(() => !document.getElementById('offers').open);
  assert((await row1.innerText()).includes('مقسم على 3 عروض (مخزن النور: 3 + فرع القاهرة: 5 + مخزن الدلتا: 2)'));
  assert((await page.locator('#status').innerText()).includes('توزيع يدوي معدل'));
  assert.equal(await page.locator('#groups .group').count(), 3);
  assert.equal(await page.locator('#total').innerText(), '961 ج.م');
  // Unchecking row2 leaves PharmaOverseas at 260 EGP (< 300 free-shipping threshold), so 15 EGP shipping is shown
  await row2.locator('[data-action=select]').uncheck();
  assert((await page.locator('#groups').innerText()).includes('شحن: 15 ج.م'));
  assert.equal(await page.locator('#total').innerText(), '526 ج.م');
  await row2.locator('[data-action=select]').check();
  assert.equal(await page.locator('#total').innerText(), '961 ج.م');

  // Verify settings dialog shows saved exclusions and persists multi-select supplier & seller exclusions
  await page.locator('#openSettings').click();
  await page.locator('#settings').waitFor({ state: 'visible' });
  assert((await page.locator('#excludedSummary').innerText()).includes('مستبعد محفوظ: 1 مخزن'));
  assert(!(await page.locator('[data-seller="s-excl"]').isChecked()));
  await page.locator('[data-seller="s-delta"]').uncheck();
  assert((await page.locator('#excludedSummary').innerText()).includes('مستبعد محفوظ: 2 مخزن'));
  await page.locator('#saveSettings').click();

  const savedPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchasePrefsV1')));
  assert(savedPrefs.excludedSellers.includes('s-excl'));
  assert(savedPrefs.excludedSellers.includes('s-delta'));
  assert(!savedPrefs.aumetSellers.includes('s-delta'));
  assert.deepEqual(errors, []);
  console.log('PASS BUY-03 supplier selection and split (multi-select, saved exclusions, auto vs manual mode, explained & editable split)');
} finally {
  await browser.close();
  if (localServer) await new Promise(r => localServer.close(r));
}
