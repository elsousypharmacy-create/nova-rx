// PUR-03 browser test:
// - Verifies سجل الفواتير tab (mountInvoiceHistory) on /purchases.html#history
// - Empty state «لسه مفيش فواتير» with «استلام فاتورة» CTA
// - Real localStorage receipts (`nova-rx-receipts-v1`) displayed newest-first with Arabic dates, totals (ج.م), and status chips
// - Search by invoice number or supplier + data-backed filter chips (الكل / مسودات / فيها فرق)
// - Tapping a card opens the read-only detail sheet; zero storage writes occur from the history view
// - Help icons (.info) >= 32x32 tap targets with aria-labels
// - No horizontal overflow / layout shift at 390x844 and 768x1024
// - Captures 390x844 and 768x1024 screenshots into qa/screens/PUR-03/
// Fake/local data only; all non-GET and external network requests are blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const OUT_DIR = 'qa/screens/PUR-03';
fs.mkdirSync(OUT_DIR, { recursive: true });

let localServer = null;
async function resolveOrigin() {
  if (process.env.NOVA_PUR03_URL) return process.env.NOVA_PUR03_URL.replace(/\/+$/, '');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  localServer = http.createServer((req, res) => {
    const clean = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(process.cwd(), clean === 'purchases' ? 'purchases.html' : clean);
    if (!file.startsWith(process.cwd()) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => localServer.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${localServer.address().port}`;
}

const origin = await resolveOrigin();
const executablePath = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean).find(p => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });

const sampleReceipts = [
  {
    id: 'RCV-10288',
    supplier: 'فارما أوفرسيز',
    invoice: '10288',
    date: '2026-11-08',
    at: '2026-11-08T09:00:00Z',
    pending: false,
    lines: [
      { key: 'p1', code: '6221001', name: 'كونجستال 20 قرص', qty: 10, lot: 'B102', expiry: '2028-05-31', cost: 89.05 }
    ]
  },
  {
    id: 'RCV-10310',
    supplier: 'فارما أوفرسيز',
    invoice: '10310',
    date: '2026-11-12',
    at: '2026-11-12T11:30:00Z',
    pending: false,
    lines: [
      { key: 'p2', code: '6221002', name: 'أوجمنتين 1 جم 14 قرص', qty: 12, lot: 'A901', expiry: '2028-11-30', cost: 610 }
    ],
    corrections: [
      {
        id: 'CORR-1',
        at: '2026-11-12T13:00:00Z',
        by: { id: 'u1', name: 'د. أحمد' },
        reason: 'فرق عد العبوات عند الاستلام الفعلي (2 علبة ناقصة)',
        changes: [{ index: 0, code: '6221002', key: 'p2', lot: 'A901', expiry: '2028-11-30', cost: 610, before: 12, after: 10, delta: -2 }]
      }
    ]
  },
  {
    id: 'RCV-8891',
    supplier: 'أوميت',
    invoice: '8891',
    date: '2026-11-17',
    at: '2026-11-17T14:15:00Z',
    pending: true,
    lines: [
      { key: 'p3', code: '6221003', name: 'بنادول أكسترا 24 قرص', qty: 16, lot: 'P44', expiry: '2029-01-31', cost: 80 }
    ]
  },
  {
    id: 'RCV-10452',
    supplier: 'فارما أوفرسيز',
    invoice: '10452',
    date: '2026-11-18',
    at: '2026-11-18T17:00:00Z',
    pending: false,
    lines: [
      { key: 'p4', code: '6221004', name: 'جلوكوفاج 500 مجم 50 قرص', qty: 20, lot: 'G500', expiry: '2028-08-31', cost: 100 },
      { key: 'p5', code: '6221005', name: 'كونكور 5 مجم 30 قرص', qty: 10, lot: 'C300', expiry: '2029-03-31', cost: 145 }
    ]
  }
];

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', hasTouch: true });
  // Block any non-GET or external request
  await context.route('**/*', route => {
    const req = route.request();
    const u = req.url();
    if (req.method() !== 'GET') return route.abort();
    if (u.startsWith(origin) || u.startsWith('data:')) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 1. Empty state check + screenshot at 390x844
  await page.goto(`${origin}/purchases.html#history`, { waitUntil: 'load' });
  await page.locator('[data-testid="history-empty"]').waitFor({ state: 'visible' });
  assert.ok((await page.locator('[data-testid="history-empty"] h2').innerText()).includes('لسه مفيش فواتير'));
  assert.ok((await page.locator('[data-pur-hist-start-receive]').innerText()).includes('استلام فاتورة'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow in empty state at 390x844');
  await page.screenshot({ path: `${OUT_DIR}/history-empty-390x844.png` });

  // 2. Help icons (.info) check on طلب tab (>= 32x32 tap targets with aria-label)
  await page.locator('#tabNeeds').click();
  await page.locator('#coverBtn').click();
  const helpIcons = await page.evaluate(() => {
    return [...document.querySelectorAll('.info')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(el => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id || '',
        w: Math.round(r.width),
        h: Math.round(r.height),
        aria: el.getAttribute('aria-label') || ''
      };
    });
  });
  assert.ok(helpIcons.length >= 1, 'at least one visible help icon on purchases hub');
  for (const ic of helpIcons) {
    assert.ok(ic.w >= 32 && ic.h >= 32, `help icon ${ic.id} must be >= 32x32, got ${ic.w}x${ic.h}`);
    assert.ok(ic.aria.trim().length > 0, `help icon ${ic.id} must have a non-empty aria-label`);
  }

  // 3. Populate localStorage with sample receipts and switch to سجل الفواتير
  await page.evaluate((rows) => {
    localStorage.setItem('nova-rx-receipts-v1', JSON.stringify(rows));
  }, sampleReceipts);

  await page.locator('#tabHistory').click();
  await page.locator('.pur-hist-card').first().waitFor({ state: 'visible' });

  // Verify newest-first order
  const cardInvoices = await page.locator('.pur-hist-card .no').allInnerTexts();
  assert.deepEqual(cardInvoices, ['فاتورة 10452', 'فاتورة 8891', 'فاتورة 10310', 'فاتورة 10288']);

  // Verify Arabic dates, totals, and statuses
  const cardStatuses = await page.locator('.pur-hist-card .st').allInnerTexts();
  assert.deepEqual(cardStatuses, ['تم الاستلام', 'مسودة', 'فرق: 2 ناقص', 'تم الاستلام']);
  const cardTotals = await page.locator('.pur-hist-card .amt').allInnerTexts();
  assert.deepEqual(cardTotals, ['3,450.00 ج.م', '1,280.00 ج.م', '6,100.00 ج.م', '890.50 ج.م']);
  const cardDates = await page.locator('.pur-hist-card .date').allInnerTexts();
  assert.deepEqual(cardDates, ['18 نوفمبر 2026', '17 نوفمبر 2026', '12 نوفمبر 2026', '8 نوفمبر 2026']);

  // Track localStorage writes during all history interactions (must stay 0)
  await page.evaluate(() => {
    window.__histWrites = 0;
    const origSet = Storage.prototype.setItem;
    const origRem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) { window.__histWrites++; return origSet.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { window.__histWrites++; return origRem.call(this, k); };
  });

  // Screenshot of populated ledger at 390x844
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390x844');
  await page.screenshot({ path: `${OUT_DIR}/history-ledger-390x844.png` });

  // 4. Filter chips (الكل / مسودات / فيها فرق)
  await page.locator('[data-pur-hist-filter="draft"]').click();
  assert.deepEqual(await page.locator('.pur-hist-card .no').allInnerTexts(), ['فاتورة 8891']);

  await page.locator('[data-pur-hist-filter="diff"]').click();
  assert.deepEqual(await page.locator('.pur-hist-card .no').allInnerTexts(), ['فاتورة 10310']);

  await page.locator('[data-pur-hist-filter="all"]').click();
  assert.equal(await page.locator('.pur-hist-card').count(), 4);

  // 5. Search by invoice number or supplier
  await page.locator('#purHistorySearch').fill('10310');
  assert.deepEqual(await page.locator('.pur-hist-card .no').allInnerTexts(), ['فاتورة 10310']);

  await page.locator('#purHistorySearch').fill('أوميت');
  assert.deepEqual(await page.locator('.pur-hist-card .no').allInnerTexts(), ['فاتورة 8891']);

  await page.locator('#purHistorySearch').fill('');
  assert.equal(await page.locator('.pur-hist-card').count(), 4);

  // 6. Tap card to open read-only detail sheet
  await page.locator('[data-pur-hist-id="RCV-10310"]').click();
  const dlg = page.locator('#purHistoryDetailOverlay .pur-hist-dlg');
  await dlg.waitFor({ state: 'visible' });
  const dlgText = await dlg.innerText();
  assert.ok(dlgText.includes('فاتورة 10310 — فارما أوفرسيز'));
  assert.ok(dlgText.includes('أوجمنتين 1 جم 14 قرص'));
  assert.ok(dlgText.includes('فرق عد العبوات'));
  assert.ok(dlgText.includes('عرض للقراءة فقط'));
  await page.screenshot({ path: `${OUT_DIR}/history-detail-390x844.png` });
  await page.locator('#purHistoryDetailOverlay [data-pur-hist-close]').first().click();
  await page.locator('#purHistoryDetailOverlay').waitFor({ state: 'hidden' });

  // 7. Tablet 768x1024 layout and screenshot
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 768x1024');
  await page.screenshot({ path: `${OUT_DIR}/history-ledger-768x1024.png` });

  // Open detail at 768x1024 and capture screenshot
  await page.locator('[data-pur-hist-id="RCV-10452"]').click();
  await page.locator('#purHistoryDetailOverlay .pur-hist-dlg').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT_DIR}/history-detail-768x1024.png` });
  await page.locator('#purHistoryDetailOverlay [data-pur-hist-close]').first().click();

  // Verify zero storage writes happened in the history view
  const writes = await page.evaluate(() => window.__histWrites);
  assert.equal(writes, 0, 'history view must be strictly read-only (zero storage writes)');
  assert.deepEqual(errors, []);

  console.log('PASS PUR-03 browser: history ledger, empty state, search, filters, read-only detail, help icons >=32px, 390x844 & 768x1024 screenshots');
} finally {
  await browser.close();
  if (localServer) await new Promise(r => localServer.close(r));
}
