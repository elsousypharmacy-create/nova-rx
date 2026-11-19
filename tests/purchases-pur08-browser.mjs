// PUR-08 Playwright test & screenshot generator:
// Verifies B-01..B-03, S-02..S-07, and P-01..P-05 at 390x844 (and 1280x800) with fake/local data only.
// Non-GET requests and external network requests are blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const OUT_DIR = 'qa/screens/PUR-08';
fs.mkdirSync(OUT_DIR, { recursive: true });

let localServer = null;
async function resolveOrigin() {
  if (process.env.NOVA_PUR08_URL) return process.env.NOVA_PUR08_URL.replace(/\/+$/, '');
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

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', hasTouch: true });
  await context.route('**/*', route => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname === '/api/purchases/stock') {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'source-auth-required' })
      });
    }
    if (u.pathname === '/api/suppliers/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suppliers: [{ id: 'aumet', state: 'off' }, { id: 'pharmaoverseas', state: 'ok' }] })
      });
    }
    if (req.method() !== 'GET') return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());

  // 1. S-03 & P-03: Mobile 390x844 initial طلب tab (empty state / unlock card)
  await page.goto(`${origin}/purchases.html`, { waitUntil: 'load' });
  await page.locator('#rows .unlock-card').waitFor({ state: 'visible' });

  const s03State = await page.evaluate(() => {
    const vis = el => {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    const tabsSt = getComputedStyle(document.querySelector('.pur-tabs'));
    return {
      flowVisible: vis(document.querySelector('.purchase-flow')),
      scopeChipVisible: vis(document.getElementById('scopeChip')),
      distributeVisible: vis(document.getElementById('distribute')),
      theadVisible: vis(document.querySelector('.products thead')),
      cartVisible: vis(document.querySelector('aside.cart')),
      tabsTop: parseFloat(tabsSt.top) || 0
    };
  });
  assert.equal(s03State.flowVisible, false, 'S-03: .purchase-flow hidden on mobile');
  assert.equal(s03State.scopeChipVisible, false, 'S-03: #scopeChip hidden in favor of #openSettings');
  assert.equal(s03State.distributeVisible, false, 'S-03: #distribute hidden when rows are empty');
  assert.equal(s03State.theadVisible, false, 'S-03: thead hidden when rows are empty');
  assert.equal(s03State.cartVisible, false, 'S-03: empty cart hidden on mobile');
  assert.ok(s03State.tabsTop >= 70, `P-03: sticky .pur-tabs offset below topbar (got top=${s03State.tabsTop}px)`);
  await page.screenshot({ path: `${OUT_DIR}/01-needs-empty-390x844.png` });

  // 2. S-05: Settings dialog supplier checkbox cards on 390x844 (1 column, no mid-word wrap)
  await page.locator('#openSettings').click();
  await page.locator('dialog#settings').waitFor({ state: 'visible' });
  const s05State = await page.evaluate(() => {
    const sup = document.querySelector('dialog#settings .qs-sup');
    const checks = [...sup.querySelectorAll('.check')];
    const rects = checks.map(c => c.getBoundingClientRect());
    return {
      stackedVertically: rects.length >= 2 && rects[1].top >= rects[0].bottom - 1,
      whiteSpaces: checks.map(c => getComputedStyle(c).whiteSpace),
      advSummaryH: document.querySelector('dialog#settings .qs-adv > summary').getBoundingClientRect().height
    };
  });
  assert.equal(s05State.stackedVertically, true, 'S-05: supplier cards stack in 1 column at 390x844');
  assert.ok(s05State.whiteSpaces.every(ws => ws === 'nowrap'), 'S-05: supplier cards have white-space: nowrap');
  assert.ok(s05State.advSummaryH >= 32, 'P-01: #advSettings summary tap target >= 32px');
  await page.screenshot({ path: `${OUT_DIR}/02-settings-dialog-390x844.png` });

  // 3. B-03, P-01, P-02: Load mock data on طلب tab at 390x844
  await page.locator('#advSettings > summary').click();
  await page.locator('#loadMock').click();
  await page.locator('#rows tr[data-key]').first().waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('distribute').disabled);

  const b03AndP02 = await page.evaluate(() => {
    const tr = document.querySelector('#rows tr[data-key]');
    const td3Before = getComputedStyle(tr.children[2], '::before').content.replace(/^["']|["']$/g, '');
    const td4Before = getComputedStyle(tr.children[3], '::before').content.replace(/^["']|["']$/g, '');
    const td5Before = getComputedStyle(tr.children[4], '::before').content.replace(/^["']|["']$/g, '');
    const cbLabel = tr.querySelector('.row-select-label').getBoundingClientRect();
    const cbInput = tr.querySelector('input[data-action="select"]').getBoundingClientRect();
    const offersBtn = tr.querySelector('button.row-action.ico-edit');
    const offersRect = offersBtn.getBoundingClientRect();
    return {
      td3Before,
      td4Before,
      td5Before,
      cbLabelW: cbLabel.width,
      cbLabelH: cbLabel.height,
      cbInputW: cbInput.width,
      cbInputH: cbInput.height,
      offersText: offersBtn.innerText.trim(),
      offersW: offersRect.width,
      offersH: offersRect.height
    };
  });
  assert.equal(b03AndP02.td3Before, 'الرصيد / المستهدف', 'B-03: col 3 ::before is الرصيد / المستهدف');
  assert.equal(b03AndP02.td4Before, 'البيع اليومي', 'B-03: col 4 ::before is البيع اليومي');
  assert.equal(b03AndP02.td5Before, 'المطلوب', 'B-03: col 5 ::before is المطلوب');
  assert.ok(b03AndP02.cbLabelW >= 32 && b03AndP02.cbLabelH >= 32, 'P-01: row checkbox label >= 32x32px');
  assert.ok(b03AndP02.cbInputW >= 32 && b03AndP02.cbInputH >= 32, 'P-01: row checkbox input >= 32x32px');
  assert.equal(b03AndP02.offersText, 'العروض', 'P-02: mobile offers button shows العروض text');
  assert.ok(b03AndP02.offersH >= 36, 'P-02: mobile offers button >= 36px high');
  await page.locator('#rows tr[data-key]').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/03-needs-mock-390x844.png` });

  // Open #offers modal and check P-01 (.sc2-more > summary >= 32px)
  await page.locator('#rows button[data-action="offers"]').first().click();
  await page.locator('dialog#offers .sc2-more > summary').waitFor({ state: 'visible' });
  const summaryBox = await page.locator('dialog#offers .sc2-more > summary').boundingBox();
  assert.ok(summaryBox.height >= 32, `P-01: .sc2-more > summary height >= 32px (got ${summaryBox.height})`);
  await page.locator('#closeOffers').click();

  // 4. Switch to استلام tab -> check P-01 (.nx-i >= 32x32), P-04 (#novaAiPanel Arabic file input), B-01, B-02, S-02, P-05
  await page.locator('#tabReceive').click();
  const frame = page.frameLocator('#receiveFrame');
  await frame.locator('.rcv').waitFor({ state: 'visible' });

  // P-01: .nx-i next to h1 is >= 32x32px
  const nxiBox = await frame.locator('.rcv-head .nx-i').boundingBox();
  assert.ok(nxiBox && nxiBox.width >= 32 && nxiBox.height >= 32, `P-01: .nx-i tap target >= 32x32px (got ${nxiBox?.width}x${nxiBox?.height})`);
  await page.screenshot({ path: `${OUT_DIR}/04-receive-tab-390x844.png` });

  // P-04: قراءة فاتورة بالصورة opens #novaAiPanel with styled Arabic file input
  await frame.locator('[data-rcv="photo"]').click();
  await frame.locator('#novaAiPanel.open').waitFor({ state: 'visible' });
  const aiLabelText = await frame.locator('label[for="novaAiFiles"]').innerText();
  const aiCountText = await frame.locator('#novaAiFileCount').innerText();
  assert.ok(aiLabelText.includes('اختَر صور الفاتورة'), 'P-04: Arabic file input button label');
  assert.equal(aiCountText.trim(), 'لم يتم اختيار صور', 'P-04: Arabic file count status');
  await page.screenshot({ path: `${OUT_DIR}/05-receive-photo-ai-390x844.png` });
  await frame.locator('#novaAiClose').click();

  // Open #rcvForm (استلام فاتورة)
  await frame.locator('[data-rcv="new"]').click();
  await frame.locator('#rcvForm .rcv-dlg').waitFor({ state: 'visible' });

  // P-05: Tab focus trap inside #rcvForm
  const focusTrapOk = await frame.locator('#rcvForm').evaluate(ov => {
    const dlg = ov.querySelector('.rcv-dlg');
    const controls = [...ov.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
    const first = controls[0], last = controls[controls.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const wrappedToFirst = document.activeElement === first;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    const wrappedToLast = document.activeElement === last;
    ov.querySelector('#rcvSup').focus();
    dlg.scrollTop = 0;
    return wrappedToFirst && wrappedToLast;
  });
  assert.equal(focusTrapOk, true, 'P-05: Tab and Shift+Tab trap focus inside #rcvForm');

  // B-01: .rcv-dlg scrolls as a whole, #rcvLines is not trapped in a 108-179px scroll box
  const b01Empty = await frame.locator('#rcvForm').evaluate(ov => {
    const dlg = ov.querySelector('.rcv-dlg');
    const grid = ov.querySelector('#rcvLines');
    const line = ov.querySelector('.rcv-line');
    return {
      dlgOverflowY: getComputedStyle(dlg).overflowY,
      gridOverflow: getComputedStyle(grid).overflow,
      gridH: grid.getBoundingClientRect().height,
      lineH: line.getBoundingClientRect().height
    };
  });
  assert.equal(b01Empty.dlgOverflowY, 'auto', 'B-01: .rcv-dlg has overflow-y: auto at 390x844');
  assert.equal(b01Empty.gridOverflow, 'visible', 'B-01: #rcvLines has overflow: visible (no inner clipping)');
  assert.ok(b01Empty.gridH >= b01Empty.lineH && b01Empty.gridH >= 250, `B-01: #rcvLines height (${b01Empty.gridH}px) >= line card (${b01Empty.lineH}px), not 108-179px`);
  await page.screenshot({ path: `${OUT_DIR}/06-receive-form-scroll-390x844.png` });

  // B-02: #rcvInv marked required and listed in #rcvMissing
  const invReq = await frame.locator('#rcvForm').evaluate(ov => {
    const inv = ov.querySelector('#rcvInv');
    const lbl = ov.querySelector('label[for="rcvInv"]');
    return {
      ariaRequired: inv?.getAttribute('aria-required'),
      hasStar: Boolean(lbl?.querySelector('.rcv-req')),
      missingText: ov.querySelector('#rcvMissing')?.textContent || ''
    };
  });
  assert.equal(invReq.ariaRequired, 'true', 'B-02: #rcvInv has aria-required="true"');
  assert.equal(invReq.hasStar, true, 'B-02: #rcvInv label has .rcv-req star');
  assert.ok(invReq.missingText.includes('رقم الفاتورة'), 'B-02: initial #rcvMissing includes رقم الفاتورة');

  // Select supplier, search product -> check B-01 autocomplete visibility
  await frame.locator('#rcvSup').selectOption('أوميت');
  const row0 = frame.locator('.rcv-line').first();
  await row0.locator('[data-f="q"]').fill('6281001234567');
  await row0.locator('.rcv-sug:not([hidden])').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT_DIR}/07-receive-form-search-390x844.png` });
  await row0.locator('[data-pick]').first().click();

  // S-02: Standalone invoice (no PO) must NOT render #rcvReview («مراجعة الاستلام»)
  const s02Review = await frame.locator('#rcvReview').evaluate(el => ({
    html: el.innerHTML,
    display: getComputedStyle(el).display,
    height: el.getBoundingClientRect().height
  }));
  assert.equal(s02Review.html, '', 'S-02: #rcvReview is empty for standalone invoice without PO');
  assert.equal(s02Review.display, 'none', 'S-02: #rcvReview is display:none when empty');
  assert.equal(s02Review.height, 0, 'S-02: #rcvReview takes 0px height');

  // B-01: Expired date error visible without nested scroll clipping
  await row0.locator('[data-f="qty"]').fill('3');
  await row0.locator('[data-f="exp"]').fill('01/20');
  await row0.locator('[data-f="exp"]').blur();
  const errText = await row0.locator('[data-err]').innerText();
  assert.ok(errText.includes('منتهية'), 'B-01: expiry error message rendered');
  await page.screenshot({ path: `${OUT_DIR}/08-receive-form-expired-390x844.png` });

  // B-02: Valid item + qty + future expiry, but empty #rcvInv -> #rcvOk stays disabled and #rcvMissing lists رقم الفاتورة
  await row0.locator('[data-f="exp"]').fill('11/28');
  await row0.locator('[data-f="exp"]').blur();
  await frame.locator('#rcvInv').fill('');
  assert.equal(await frame.locator('#rcvOk').isDisabled(), true, 'B-02: #rcvOk stays disabled when #rcvInv is empty');
  assert.equal((await frame.locator('#rcvMissing').innerText()).trim(), 'ناقص: رقم الفاتورة', 'B-02: #rcvMissing shows ناقص: رقم الفاتورة');
  await page.screenshot({ path: `${OUT_DIR}/09-receive-form-missing-inv-390x844.png` });

  // Fill #rcvInv -> #rcvOk enables and #rcvMissing clears
  await frame.locator('#rcvInv').fill('99887');
  assert.equal(await frame.locator('#rcvOk').isEnabled(), true, 'B-02: #rcvOk enables once #rcvInv is filled');
  assert.equal((await frame.locator('#rcvMissing').innerText()).trim(), '', 'B-02: #rcvMissing clears once all required fields are valid');
  await page.screenshot({ path: `${OUT_DIR}/10-receive-form-valid-390x844.png` });

  // Submit receipt -> verify S-04 (no duplicate آخر الاستلامات table in embedded mode; shows سجل الفواتير link card with Arabic date)
  await frame.locator('#rcvOk').click();
  await frame.locator('#rcvForm').waitFor({ state: 'hidden' });

  const s04State = await frame.locator('.rcv').evaluate(el => ({
    hasDuplicateTable: Boolean(el.querySelector('.rcv-table')),
    hasHistoryBtn: Boolean(el.querySelector('[data-rcv="history"]')),
    text: el.innerText
  }));
  assert.equal(s04State.hasDuplicateTable, false, 'S-04: duplicate .rcv-table removed from embedded استلام tab');
  assert.equal(s04State.hasHistoryBtn, true, 'S-04: embedded استلام tab links to سجل الفواتير');
  assert.ok(
    ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'].some(m => s04State.text.includes(m)),
    'S-04: receipt date in استلام uses Arabic month name'
  );
  await page.screenshot({ path: `${OUT_DIR}/11-receive-after-save-390x844.png` });

  // S-06: Open تصحيح الكميات modal at 390x844 -> stacked rows, no 650px horizontal overflow
  await frame.locator('[data-rcv-correct]').first().click();
  await frame.locator('.rcv-controls').waitFor({ state: 'visible' });
  const s06State = await frame.locator('.rcv-controls').evaluate(dlg => {
    const sc = dlg.querySelector('.rcv-review-scroll');
    const tbl = sc.querySelector('table');
    const inp = sc.querySelector('[data-correct-index="0"]');
    const ir = inp.getBoundingClientRect();
    const dr = dlg.getBoundingClientRect();
    return {
      scrollW: sc.scrollWidth,
      clientW: sc.clientWidth,
      tableW: tbl.getBoundingClientRect().width,
      inputInsideViewport: ir.left >= dr.left && ir.right <= dr.right
    };
  });
  assert.ok(s06State.scrollW <= s06State.clientW + 1, `S-06: no horizontal table overflow in تصحيح الكميات (${s06State.scrollW} <= ${s06State.clientW})`);
  assert.equal(s06State.inputInsideViewport, true, 'S-06: الكمية الصحيحة input is visible inside modal without horizontal scroll');
  await page.screenshot({ path: `${OUT_DIR}/12-receive-correction-stacked-390x844.png` });
  await frame.locator('[data-control-close]').click();

  // S-07: Add a pending receipt and verify pending section styling (.rcv-sec-h, .rcv-count, .rcv-pos, مسودة · يحتاج استكمال)
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('nova-rx-receipts-v1') || '[]');
    rows.push({
      id: 'RCV-PEND-1',
      supplier: 'فارما أوفرسيز',
      invoice: '77441',
      date: '2026-11-19',
      at: '2026-11-19T18:00:00Z',
      pending: true,
      lines: [{ key: 'p1', code: '6281001234567', name: 'بانادول إكسترا 24 قرص', qty: 5, lot: 'L9', expiry: '2028-11-30', cost: 45 }]
    });
    localStorage.setItem('nova-rx-receipts-v1', JSON.stringify(rows));
    const fr = document.getElementById('receiveFrame');
    if (fr && fr.contentWindow && fr.contentWindow.novaReceiving) fr.contentWindow.novaReceiving.render();
  });
  const s07State = await frame.locator('.rcv').evaluate(el => {
    const h2 = [...el.querySelectorAll('.rcv-sec-h h2')].find(h => h.textContent.includes('استلامات تحتاج استكمال'));
    const sec = h2?.closest('.rcv-sec');
    return {
      hasSecH: Boolean(h2),
      hasCount: Boolean(sec?.querySelector('.rcv-sec-h .rcv-count')),
      hasPosGrid: Boolean(sec?.querySelector('.rcv-pos')),
      tagText: sec?.querySelector('.rcv-tag')?.textContent || ''
    };
  });
  assert.equal(s07State.hasSecH, true, 'S-07: pending section heading wrapped in .rcv-sec-h');
  assert.equal(s07State.hasCount, true, 'S-07: pending section has .rcv-count badge');
  assert.equal(s07State.hasPosGrid, true, 'S-07: pending cards wrapped in .rcv-pos grid');
  assert.equal(s07State.tagText, 'مسودة · يحتاج استكمال', 'S-07: pending card shows مسودة · يحتاج استكمال');
  await page.screenshot({ path: `${OUT_DIR}/13-receive-pending-section-390x844.png` });

  // S-04 link click: clicking [data-rcv="history"] in استلام switches to سجل الفواتير tab
  await frame.locator('[data-rcv="history"]').click();
  await page.waitForFunction(() => document.getElementById('tabHistory').getAttribute('aria-selected') === 'true');
  await page.locator('.pur-hist-card').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT_DIR}/14-history-tab-390x844.png` });

  // S-07 in سجل الفواتير detail sheet: pending receipt shows مسودة · يحتاج استكمال
  await page.locator('[data-pur-hist-id="RCV-PEND-1"]').click();
  await page.locator('#purHistoryDetailOverlay .pur-hist-dlg').waitFor({ state: 'visible' });
  const detailStatus = await page.locator('#purHistoryDetailOverlay .pur-hist-summary-bar .st').innerText();
  assert.equal(detailStatus.trim(), 'مسودة · يحتاج استكمال', 'S-07: history detail sheet shows مسودة · يحتاج استكمال for pending receipt');
  await page.screenshot({ path: `${OUT_DIR}/15-history-pending-detail-390x844.png` });
  await page.locator('#purHistoryDetailOverlay [data-pur-hist-close]').first().click();

  // Desktop 1280x800 verification & screenshot
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#tabNeeds').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/16-needs-desktop-1280x800.png` });
  await page.locator('#tabReceive').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/17-receive-desktop-1280x800.png` });

  assert.deepEqual(errors, [], 'zero pageerror events');
  console.log('PASS PUR-08 browser: B-01..B-03, S-02..S-07, P-01..P-05 verified at 390x844 and 1280x800 with screenshots');
} finally {
  await browser.close();
  if (localServer) await new Promise(r => localServer.close(r));
}
