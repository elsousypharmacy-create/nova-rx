// OPS-NEEDS (Phase 1): comprehensive Playwright verification & screenshot capture
// at 390x844 (phone), 1180x820 (landscape tablet = wide), and 1280x800 (desktop = wide).
// Fake/local data only. Blocks all external requests and asserts ZERO supplier cart/order writes.
// Run: node tests/purchases-ops-needs-browser.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, 'qa/screens/OPS-NEEDS');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

let serveMainIndex = false;
let mainIndexHtml = null;
try { mainIndexHtml = execSync('git show origin/main:index.html', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
  if (serveMainIndex && mainIndexHtml && (urlPath === '/' || urlPath === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(mainIndexHtml);
    return;
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath === '/purchases' ? 'purchases.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    if (serveMainIndex && rel.startsWith('assets/')) {
      try {
        const oldAsset = execSync(`git show origin/main:${rel}`, { stdio: ['ignore', 'pipe', 'ignore'] });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
        res.end(oldAsset);
        return;
      } catch {}
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;
const PURCHASES_URL = `${ORIGIN}/purchases.html`;

const FAKE_PIN = '0000';
const FAKE_STOCK = [
  { id: 'n1', code: '1001', gtin: '6221000001001', name: 'بانادول اكسترا 24 قرص', nameEn: 'Panadol Extra 24 tabs', stock: 2, minStock: 5, idealStock: 14, dailySales: 6 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 41.00 },
  { id: 'n2', code: '1002', gtin: '6221000001002', name: 'أوجمنتين 1 جم 14 قرص', nameEn: 'Augmentin 1g 14 tabs', stock: 0, minStock: 3, idealStock: 6, dailySales: 3 / 7, observedDays: 14, cheapestSupplier: 'فارما أوفرسيز', purchasePrice: 118.00 },
  { id: 'n3', code: '1003', gtin: '6221000001003', name: 'فيتامين سي 1000 فوار', nameEn: 'Vitamin C 1000 Eff', stock: 3, minStock: 5, idealStock: 11, dailySales: 4 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 63.00 },
  { id: 'n4', code: '1004', gtin: '6221000001004', name: 'كونجستال 20 قرص', nameEn: 'Congestal 20 tabs', stock: 1, minStock: 3, idealStock: 6, dailySales: 3 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 34.00 },
  { id: 'n5', code: '1005', gtin: '6221000001005', name: 'بروفين 400 مجم 30 قرص', nameEn: 'Brufen 400mg 30 tabs', stock: 4, minStock: 6, idealStock: 10, dailySales: 5 / 7, observedDays: 14, cheapestSupplier: 'فارما أوفرسيز', purchasePrice: 52.00 },
  { id: 'n6', code: '1006', gtin: '6221000001006', name: 'كتافلام 50 مجم 20 قرص', nameEn: 'Cataflam 50mg 20 tabs', stock: 1, minStock: 4, idealStock: 8, dailySales: 4 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 48.00 },
  { id: 'n7', code: '1007', gtin: '6221000001007', name: 'أنتينال 200 مجم 24 كبسولة', nameEn: 'Antinal 200mg 24 caps', stock: 0, minStock: 3, idealStock: 6, dailySales: 3 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 39.00 },
  { id: 'n8', code: '1008', gtin: '6221000001008', name: 'فولتارين جل 50 جم', nameEn: 'Voltaren Gel 50g', stock: 2, minStock: 4, idealStock: 6, dailySales: 3 / 7, observedDays: 14, cheapestSupplier: 'فارما أوفرسيز', purchasePrice: 75.00 },
  { id: 'n9', code: '1009', gtin: '6221000001009', name: 'ميبو مرهم 15 جرام', nameEn: 'Mebo Ointment 15g', stock: 1, minStock: 2, idealStock: 4, dailySales: 2 / 7, observedDays: 14, cheapestSupplier: 'أوميت', purchasePrice: 95.00 },
  { id: 'n10', code: '1010', gtin: '6221000001010', name: 'ليزوزال شامبو', nameEn: 'Lizozal Shampoo', stock: 0, minStock: 2, idealStock: 4, dailySales: 2 / 7, observedDays: 14, cheapestSupplier: 'فارما أوفرسيز', purchasePrice: 52.00 },
];

const FAKE_CATALOG = [
  { id: 'c1', code: '2001', gtin: '6221000002001', name: 'بانادول كولد اند فلو 24 قرص', nameEn: 'Panadol Cold & Flu 24 tabs', stock: 1, dailySales: 3 / 7, cheapestSupplier: 'أوميت', price: 38.00, purchasePrice: 38.00 },
  { id: 'c2', code: '1001', gtin: '6221000001001', name: 'بانادول اكسترا 24 قرص', nameEn: 'Panadol Extra 24 tabs', stock: 2, dailySales: 6 / 7, cheapestSupplier: 'أوميت', price: 45.00, purchasePrice: 41.00 },
  { id: 'c3', code: '2003', gtin: '6221000002003', name: 'بانادول نايت 20 قرص', nameEn: 'Panadol Night 20 tabs', stock: 0, dailySales: 2 / 7, cheapestSupplier: 'أوميت', price: 52.00, purchasePrice: 44.00 },
  { id: 'c4', code: '2004', gtin: '6221000002004', name: 'بانادول أدفانس 24 قرص', nameEn: 'Panadol Advance 24 tabs', stock: 6, dailySales: 5 / 7, cheapestSupplier: 'أوميت', price: 41.00, purchasePrice: 35.00 },
  { id: 'c5', code: '2005', gtin: '6221000002005', name: 'أوميبرازول 20 مجم 14 كبسولة', nameEn: 'Omeprazole 20mg 14 caps', stock: 3, dailySales: 2 / 7, cheapestSupplier: 'فارما أوفرسيز', price: 33.00, purchasePrice: 28.00 },
];

const execPath = process.env.NOVA_CHROMIUM || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });

const VIEWPORTS = [
  { width: 390, height: 844, isPhone: true },
  { width: 1180, height: 820, isPhone: false },
  { width: 1280, height: 800, isPhone: false },
];

try {
  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}x${vp.height}`;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', hasTouch: vp.isPhone });
    let force403 = false;
    const stockCalls = [];
    const writeCalls = [];
    const logs = [];
    const errors = [];

    await ctx.addInitScript((cat) => {
      window.NOVA_ENV = 'production';
      window.NOVA_NEEDS_CATALOG = cat;
      localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({
        days: 21,
        level: 'ideal',
        mode: 'auto',
        suppliers: ['aumet', 'pharmaoverseas'],
        aumetSellers: ['s1'],
        excludedSuppliers: [],
        excludedSellers: []
      }));
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    }, FAKE_CATALOG);

    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.hostname !== '127.0.0.1') return route.abort();
      if (!u.pathname.startsWith('/api/')) {
        if (req.method() !== 'GET') {
          writeCalls.push(`${req.method()} ${u.pathname}`);
          return route.abort();
        }
        return route.continue();
      }
      if (u.pathname === '/api/purchases/stock') {
        const body = req.postDataJSON() || {};
        stockCalls.push(body);
        if (force403 || body.dashboardPin !== FAKE_PIN) {
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'source-auth-required' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, schemaVersion: 1, generatedAt: new Date().toISOString(), items: FAKE_STOCK }) });
      }
      if (u.pathname === '/api/suppliers/status') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suppliers: [{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'ok' }] }) });
      }
      if (u.pathname === '/api/suppliers/sellers') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sellers: [{ id: 's1', name: 'مخزن تجريبي' }] }) });
      }
      // Any other API write (supplier cart/order) MUST NEVER happen!
      if (req.method() !== 'GET') writeCalls.push(`${req.method()} ${u.pathname}`);
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => logs.push(m.text()));

    // 1. Open /purchases -> LOCKED state (< 1s, 0 network calls, CLS < 0.1, visible without scroll)
    const t0 = Date.now();
    await page.goto(PURCHASES_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 1000 });
    const unlockCardMs = Date.now() - t0;
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => Number(window.__cls.toFixed(4)));
    assert.ok(unlockCardMs < 1000, `${tag}: locked card < 1000ms (got ${unlockCardMs}ms)`);
    assert.equal(stockCalls.length, 0, `${tag}: 0 stock calls without PIN`);
    assert.ok(cls < 0.1, `${tag}: CLS ${cls} < 0.1`);

    // Check top nav direct tab «النواقص» active + العمليات still has receiving & stock
    const navInfo = await page.evaluate(() => {
      const a = document.getElementById('novaPurchasesNav');
      const opsItems = [...document.querySelectorAll('#novaOpsNav a')].map(x => x.getAttribute('href'));
      return { text: a?.textContent.trim(), href: a?.getAttribute('href'), cur: a?.getAttribute('aria-current'), opsItems };
    });
    assert.equal(navInfo.text, 'النواقص');
    assert.equal(navInfo.href, '/purchases');
    assert.equal(navInfo.cur, 'page');
    assert.deepEqual(navInfo.opsItems, ['/#receiving', '/#products']);

    // Check stage pill & locked visibility without scroll
    assert.equal((await page.locator('#needsStagePill').innerText()).trim(), 'مرحلة 1 من 5 · افتح النواقص');
    const lockBox = await page.locator('#needsLockWrap .unlock-card').boundingBox();
    assert.ok(lockBox && lockBox.y >= 0 && lockBox.y + lockBox.height <= vp.height, `${tag}: locked card visible without scroll (${JSON.stringify(lockBox)})`);
    assert.equal(await page.locator('#needsSearchBox').isVisible(), false, `${tag}: search hidden while locked`);
    assert.equal(await page.locator('#needsTableWrap').isVisible(), false, `${tag}: table hidden while locked`);
    assert.equal(await page.locator('#needsRailOpen').isVisible(), false, `${tag}: tiles hidden while locked`);
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: no horizontal overflow (locked)`);

    // Capture locked screenshot BEFORE typing any PIN
    await page.screenshot({ path: path.join(SHOTS, `needs-locked-${tag}.png`) });

    // 2. Wrong PIN -> shows hint, NOT saved to sessionStorage/localStorage
    await page.locator('#dashboard-style').fill('9999');
    await page.locator('#dashboard-style').press('Enter');
    await page.locator('#unlockHint').waitFor({ state: 'visible' });
    const badPinCheck = await page.evaluate(() => ({
      ss: sessionStorage.getItem('novaNeedsSessionPin'),
      ls: JSON.stringify(localStorage),
    }));
    assert.equal(badPinCheck.ss, null, `${tag}: wrong PIN not saved to sessionStorage`);
    assert.ok(!badPinCheck.ls.includes('9999'), `${tag}: wrong PIN not in localStorage`);

    // 3. Valid fake PIN -> unlocks, stage 2, saved in sessionStorage ONLY, not logged
    await page.locator('#dashboard-style').fill(FAKE_PIN);
    await page.locator('#unlockNeedsBtn').click();
    await page.locator('#rows tr.needs-row').first().waitFor({ state: 'visible', timeout: 3000 });
    assert.equal((await page.locator('#needsStagePill').innerText()).trim(), 'مرحلة 2 من 5 · راجع الكميات');
    const pinCheck = await page.evaluate((pin) => ({
      ss: sessionStorage.getItem('novaNeedsSessionPin'),
      ls: JSON.stringify(localStorage),
      domVal: document.body.innerHTML.includes(`value="${pin}"`),
    }), FAKE_PIN);
    assert.equal(pinCheck.ss, FAKE_PIN, `${tag}: PIN saved in sessionStorage after 200 OK`);
    assert.ok(!pinCheck.ls.includes(FAKE_PIN), `${tag}: PIN NOT in localStorage`);
    assert.equal(pinCheck.domVal, false, `${tag}: PIN NOT in DOM value`);
    assert.ok(!logs.join('\n').includes(FAKE_PIN), `${tag}: PIN NOT in console logs`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: no horizontal overflow (open)`);

    // Verify WIDE (>=768px) layout: 1180x820 uses exact desktop layout (right rail ~280px, table visible)
    if (!vp.isPhone) {
      const railBox = await page.locator('#needsRail').boundingBox();
      assert.ok(railBox && railBox.width >= 270 && railBox.width <= 290, `${tag}: right rail ~280px (got ${railBox?.width})`);
      assert.equal(await page.locator('#prepareOrderBtn').isVisible(), true);
      assert.equal(await page.locator('#needsPhoneCtaWrap').isVisible(), false, `${tag}: phone CTA hidden on wide`);
    } else {
      assert.equal(await page.locator('#needsRail').isVisible(), false, `${tag}: right rail hidden on phone when unlocked`);
      assert.equal(await page.locator('#phonePrepareOrderBtn').isVisible(), true, `${tag}: sticky bottom CTA visible on phone`);
      assert.equal(await page.locator('.bnav').count(), 0, `${tag}: deferred 4-item bottom bar NOT added`);
    }

    // Verify stepper buttons & trash button >= 44px tap targets
    const tapCheck = await page.evaluate(() => {
      const inc = document.querySelector('[data-action="qty-inc"]').getBoundingClientRect();
      const dec = document.querySelector('[data-action="qty-dec"]').getBoundingClientRect();
      const tr = document.querySelector('[data-action="delete"]').getBoundingClientRect();
      return { inc: [inc.width, inc.height], dec: [dec.width, dec.height], tr: [tr.width, tr.height] };
    });
    assert.ok(tapCheck.inc[0] >= 44 && tapCheck.inc[1] >= 44, `${tag}: + stepper >=44px (${tapCheck.inc})`);
    assert.ok(tapCheck.dec[0] >= 44 && tapCheck.dec[1] >= 44, `${tag}: - stepper >=44px (${tapCheck.dec})`);
    assert.ok(tapCheck.tr[0] >= 44 && tapCheck.tr[1] >= 44, `${tag}: trash >=44px (${tapCheck.tr})`);

    // Capture open screenshot
    await page.screenshot({ path: path.join(SHOTS, `needs-open-${tag}.png`) });

    // 4. Reload -> auto-unlocks from sessionStorage!
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#rows tr.needs-row').first().waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#needsLockWrap').isVisible(), false, `${tag}: auto-unlocked from sessionStorage on reload`);

    // 5. Type in search -> dropdown (3-6 suggestions) -> capture typing screenshot -> Enter adds qty 1 at TOP with «جديد»
    if (!vp.isPhone) {
      // Test F2 shortcut focuses search
      await page.keyboard.press('F2');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'needsSearchInput', `${tag}: F2 focuses search`);
    }
    await page.locator('#needsSearchInput').fill('بانادول');
    await page.locator('#needsSearchDropdown .needs-dd-o').first().waitFor({ state: 'visible' });
    const suggCount = await page.locator('#needsSearchDropdown .needs-dd-o').count();
    assert.ok(suggCount >= 3 && suggCount <= 6, `${tag}: dropdown shows 3-6 suggestions (got ${suggCount})`);
    assert.ok((await page.locator('#needsSearchDropdown').innerText()).includes('↑ ↓ للاختيار · Enter يضيفه بكمية 1 · Esc يقفل'));
    if (vp.isPhone) {
      assert.equal(await page.locator('#needsSearchDropdown .needs-dd-add:visible').count(), suggCount, `${tag}: phone shows + ضيف on every suggestion`);
    }
    await page.screenshot({ path: path.join(SHOTS, `needs-typing-${tag}.png`) });

    // Verify ArrowDown / ArrowUp moves highlight across suggestions
    await page.locator('#needsSearchInput').press('ArrowDown');
    assert.equal(await page.locator('#needsSearchDropdown .needs-dd-o.on').getAttribute('data-sugg-idx'), '1', `${tag}: ArrowDown moves selection to index 1`);
    await page.locator('#needsSearchInput').press('ArrowUp');
    assert.equal(await page.locator('#needsSearchDropdown .needs-dd-o.on').getAttribute('data-sugg-idx'), '0', `${tag}: ArrowUp moves selection back to index 0`);

    // Press Enter -> adds first suggestion (بانادول كولد اند فلو 24 قرص) at TOP with qty 1 and «جديد»
    const firstSuggName = (await page.locator('#needsSearchDropdown .needs-dd-o.on b').innerText()).trim();
    const countBeforeAdd = await page.locator('#rows tr.needs-row').count();
    await page.locator('#needsSearchInput').press('Enter');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#rows tr.needs-row').count(), countBeforeAdd + 1, `${tag}: added 1 new row`);
    const topRowText = await page.locator('#rows tr.needs-row').first().innerText();
    assert.ok(topRowText.includes(firstSuggName) && topRowText.includes('جديد'), `${tag}: new item at TOP with جديد tag (${topRowText})`);
    assert.equal(await page.locator('#rows tr.needs-row').first().locator('[data-qty-val]').innerText(), '1');
    assert.equal(await page.locator('#needsSearchInput').inputValue(), '', `${tag}: search cleared after add`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'needsSearchInput', `${tag}: focus stays in search after add`);

    // 6. Add EXISTING item -> increments qty by 1 instead of duplicating!
    await page.locator('#needsSearchInput').fill('بانادول كولد اند فلو');
    await page.locator('#needsSearchDropdown .needs-dd-o').first().waitFor({ state: 'visible' });
    await page.locator('#needsSearchInput').press('Enter');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#rows tr.needs-row').count(), countBeforeAdd + 1, `${tag}: existing item NOT duplicated`);
    assert.equal(await page.locator('#rows tr.needs-row').first().locator('[data-qty-val]').innerText(), '2', `${tag}: existing item qty incremented to 2`);

    // 7. Trash removes row -> bottom toast «اتشال صنف «X» · تراجع» -> capture deleted+undo screenshot -> تراجع restores at old position with old qty!
    const targetName = 'كونجستال 20 قرص';
    const targetIdxBefore = await page.evaluate((nm) => {
      const rows = [...document.querySelectorAll('#rows tr.needs-row')];
      return rows.findIndex(r => r.innerText.includes(nm));
    }, targetName);
    assert.ok(targetIdxBefore >= 0, `${tag}: target item found before delete`);
    const targetRow = page.locator('#rows tr.needs-row').nth(targetIdxBefore);
    const oldQty = await targetRow.locator('[data-qty-val]').innerText();
    await targetRow.locator('[data-action="delete"]').click();
    await page.locator('#needsUndoToast').waitFor({ state: 'visible' });
    const toastTxt = await page.locator('#needsUndoToast').innerText();
    assert.ok(toastTxt.includes(`اتشال صنف «${targetName}»`) && toastTxt.includes('تراجع'), `${tag}: undo toast text (${toastTxt})`);

    // Capture deleted + undo screenshot (shows newly added item at top + undo toast at bottom)
    await page.screenshot({ path: path.join(SHOTS, `needs-deleted-undo-${tag}.png`) });

    // Click تراجع -> restores row at exact old position with exact old qty
    await page.locator('#needsUndoBtn').click();
    await page.locator('#needsUndoToast').waitFor({ state: 'hidden' });
    const restoredIdx = await page.evaluate((nm) => {
      const rows = [...document.querySelectorAll('#rows tr.needs-row')];
      return rows.findIndex(r => r.innerText.includes(nm));
    }, targetName);
    assert.equal(restoredIdx, targetIdxBefore, `${tag}: undo restored item at exact old position`);
    assert.equal(await page.locator('#rows tr.needs-row').nth(restoredIdx).locator('[data-qty-val]').innerText(), oldQty, `${tag}: undo restored old qty`);

    // 8. Qty − to 0 also removes the row (top row currently has qty 2 -> click − twice -> removed + toast)
    await page.locator('#rows tr.needs-row').first().locator('[data-action="qty-dec"]').click();
    assert.equal(await page.locator('#rows tr.needs-row').first().locator('[data-qty-val]').innerText(), '1');
    await page.locator('#rows tr.needs-row').first().locator('[data-action="qty-dec"]').click();
    await page.locator('#needsUndoToast').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#rows tr.needs-row').count(), countBeforeAdd, `${tag}: qty - to 0 removed row`);

    // 9. Delete an item permanently and reload -> verify deleted row does NOT resurrect!
    await page.locator('#rows tr.needs-row').first().locator('[data-action="delete"]').click();
    const removedKey = await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchaseNeedsWorkingV1') || '{}').removedKeys || []);
    assert.ok(removedKey.length >= 1, `${tag}: deleted key saved in local working state`);
    const countAfterPermDelete = await page.locator('#rows tr.needs-row').count();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#rows tr.needs-row').first().waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#rows tr.needs-row').count(), countAfterPermDelete, `${tag}: reload did NOT resurrect deleted row`);

    // 10. Settings dialog has NO #dashboardPin field (ONE PIN flow)
    if (!vp.isPhone) await page.locator('#tileFilterBtn').click();
    else await page.locator('#phoneFilterBtn').click();
    await page.locator('#needsFilterDialog').waitFor({ state: 'visible' });
    await page.locator('#openSettings').click();
    await page.locator('#settings').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#dashboardPin').count(), 0, `${tag}: settings dialog has NO #dashboardPin field`);
    await page.locator('#settings .close').click();

    // 11. «جهّز طلبية N صنف» saves LOCAL draft ONLY (ZERO supplier POST/PUT)
    const ctaBtn = vp.isPhone ? page.locator('#phonePrepareOrderBtn') : page.locator('#prepareOrderBtn');
    await ctaBtn.click();
    await page.locator('#localDraftDialog').waitFor({ state: 'visible' });
    const savedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('novaPurchaseDraftV1') || 'null'));
    assert.equal(savedDraft?.state, 'local-draft', `${tag}: saved local draft`);
    assert.equal(savedDraft?.itemCount, countAfterPermDelete, `${tag}: draft item count matches live N`);
    assert.deepEqual(writeCalls, [], `${tag}: ZERO supplier POST/PUT requests`);
    await page.locator('#closeLocalDraftOk').click();

    // 12. 403 clears sessionStorage; «قفل» clears sessionStorage
    force403 = true;
    if (!vp.isPhone) {
      await page.locator('#load').click();
    } else {
      await page.locator('#phoneFilterBtn').click();
      await page.locator('#phoneRefreshBtn').click();
    }
    await page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('novaNeedsSessionPin')), null, `${tag}: 403 cleared sessionStorage`);

    // Unlock again, then click «قفل»
    force403 = false;
    await page.locator('#dashboard-style').fill(FAKE_PIN);
    await page.locator('#unlockNeedsBtn').click();
    await page.locator('#rows tr.needs-row').first().waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('novaNeedsSessionPin')), FAKE_PIN);
    if (!vp.isPhone) {
      await page.locator('#lockNeedsBtn').click();
    } else {
      await page.locator('#phoneFilterBtn').click();
      await page.locator('#phoneLockBtn').click();
    }
    await page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 2000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('novaNeedsSessionPin')), null, `${tag}: قفل cleared sessionStorage`);

    assert.deepEqual(errors, [], `${tag}: zero pageerror`);
    await ctx.close();
  }

  // 13. Sale screen (/) verification at all 3 sizes:
  //     - Direct «النواقص» tab in topbar, #novaOpsNav still has receiving & stock
  //     - Topbar height unchanged (48px), no overflow at 1180x820 / 1280x800
  //     - F2 is NOT bound to needs search on the sale screen
  //     - .pos-root starts at y=48 (did not move)
  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}x${vp.height}`;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG' });
    await ctx.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    const saleCheck = await page.evaluate(() => {
      const nav = document.querySelector('.nova-nav');
      const row = document.querySelector('.nova-nav-row');
      const pos = document.querySelector('.pos-root');
      const tab = document.getElementById('novaPurchasesNav');
      const opsPages = [...document.querySelectorAll('#novaOpsNav [data-page]')].map(e => e.dataset.page);
      return {
        navOverflow: nav.scrollWidth > nav.clientWidth,
        rowH: Math.round(row.getBoundingClientRect().height),
        posY: Math.round(pos.getBoundingClientRect().y),
        tabText: tab?.textContent.trim(),
        tabHref: tab?.getAttribute('href'),
        opsPages,
        hasNeedsSearch: Boolean(document.getElementById('needsSearchInput')),
      };
    });
    assert.equal(saleCheck.rowH, 48, `sale ${tag}: top nav height stayed 48px`);
    assert.equal(saleCheck.posY, 48, `sale ${tag}: .pos-root y stayed 48px`);
    assert.equal(saleCheck.tabText, 'النواقص');
    assert.equal(saleCheck.tabHref, '/purchases');
    assert.deepEqual(saleCheck.opsPages, ['receiving', 'products']);
    assert.equal(saleCheck.hasNeedsSearch, false);
    if (!vp.isPhone) assert.equal(saleCheck.navOverflow, false, `sale ${tag}: top nav must not overflow`);

    // Pixel-identical sale screen (.pos-root) comparison against origin/main (before pressing F2)
    if (mainIndexHtml) {
      await page.evaluate(() => { document.activeElement?.blur(); });
      await page.waitForTimeout(150);
      const curPosPng = await page.locator('.pos-root').screenshot({ animations: 'disabled', caret: 'hide' });

      serveMainIndex = true;
      const ctxMain = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG' });
      await ctxMain.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
      const pageMain = await ctxMain.newPage();
      await pageMain.goto(`${ORIGIN}/`, { waitUntil: 'load' });
      await pageMain.waitForTimeout(600);
      await pageMain.evaluate(() => { document.activeElement?.blur(); });
      await pageMain.waitForTimeout(150);
      const mainPosPng = await pageMain.locator('.pos-root').screenshot({ animations: 'disabled', caret: 'hide' });
      serveMainIndex = false;
      await ctxMain.close();
      assert.equal(Buffer.compare(curPosPng, mainPosPng), 0, `sale ${tag}: .pos-root must be pixel-identical to origin/main`);
    }

    // Pressing F2 on sale screen must NOT error and must stay on sale screen
    await page.keyboard.press('F2');
    assert.ok(page.url().startsWith(ORIGIN + '/'));
    assert.deepEqual(errors, [], `sale ${tag}: zero pageerror`);
    await ctx.close();
  }

  console.log('PASS: OPS-NEEDS all checks + 12 screenshots captured in qa/screens/OPS-NEEDS/');
} finally {
  await browser.close();
  server.close();
}
