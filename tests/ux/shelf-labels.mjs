// tests/ux/shelf-labels.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nsl_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nsl_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const apiCheck = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const prodA = {
      id: 'sl-a',
      name: 'كريم مرطب اختبار',
      nameEn: 'Moisturizing Cream',
      barcode: '622999111001',
      price: 85.5
    };
    const prodXss = {
      id: 'sl-xss',
      name: 'صنف <b>x</b> اختبار',
      barcode: '622999111002',
      price: 40
    };
    window.NOVA_DEMO.products.push(prodA, prodXss);

    const keyA = window.novaStock ? window.novaStock.keyOf(prodA) : prodA.barcode;
    const keyXss = window.novaStock ? window.novaStock.keyOf(prodXss) : prodXss.barcode;

    let expectedShelf = '';
    if (window.novaItemLimits && typeof window.novaItemLimits.set === 'function') {
      window.novaItemLimits.set(keyA, { min: 1, max: 10, shelf: 'رف ٢ – أ' });
    }
    if (window.novaItemLimits && typeof window.novaItemLimits.shelfOf === 'function') {
      expectedShelf = String(window.novaItemLimits.shelfOf(keyA) || '');
    }

    const L = window.novaShelfLabels;

    // 1. Add item with copies 3 -> 3 labels with name, price, shelf, barcode
    const added3 = L.addItem(keyA, 3);
    const html3 = L.html();
    const doc3 = new DOMParser().parseFromString(html3, 'text/html');
    const labels3 = doc3.querySelectorAll('.nsl-label');

    // 2. Copies 0 and 51 refused; '٢' accepted
    const ref0 = L.addItem(keyA, 0);
    const ref51 = L.addItem(keyA, 51);
    const afterRef = L.queue().find((x) => x.key === keyA).copies;
    const accAr = L.addItem(keyA, '٢');
    const afterAr = L.queue().find((x) => x.key === keyA).copies;

    // 3. setSize('a4') adds grid class
    const badSize = L.setSize('huge');
    const okA4 = L.setSize('a4');
    const htmlA4 = L.html();
    const docA4 = new DOMParser().parseFromString(htmlA4, 'text/html');
    const hasGridClass = !!docA4.querySelector('.nsl-grid');

    // 4. XSS check: <b>x</b> appears as text, never as an element
    L.addItem(keyXss, 1);
    const htmlXss = L.html();
    const docXss = new DOMParser().parseFromString(htmlXss, 'text/html');
    const bCount = docXss.querySelectorAll('b').length;
    const xssTextPresent = docXss.body.textContent.includes('<b>x</b>');

    // 5. remove (including whitespace-padded key) and clear
    const removed = L.remove(' ' + keyXss + ' ');
    const countAfterRemove = L.queue().length;
    L.clear();
    const countAfterClear = L.queue().length;

    // Re-add one item so we can verify reload persistence and UI rendering
    L.addItem(keyA, 2);

    return {
      keyA,
      expectedShelf,
      added3: !!added3,
      labelCount3: labels3.length,
      firstLabelText: labels3[0] ? labels3[0].textContent : '',
      ref0,
      ref51,
      afterRef,
      accAr: !!accAr,
      afterAr,
      badSize,
      okA4,
      hasGridClass,
      bCount,
      xssTextPresent,
      removed,
      countAfterRemove,
      countAfterClear
    };
  });

  assert.equal(apiCheck.added3, true);
  assert.equal(apiCheck.labelCount3, 3, 'html() has 3 labels for copies=3');
  assert.ok(apiCheck.firstLabelText.includes('كريم مرطب اختبار'), 'label includes Arabic name');
  assert.ok(apiCheck.firstLabelText.includes('Moisturizing Cream'), 'label includes English name');
  assert.ok(apiCheck.firstLabelText.includes('85.50') && apiCheck.firstLabelText.includes('ج.م'), 'label includes price and ج.م');
  assert.ok(apiCheck.firstLabelText.includes('622999111001'), 'label includes barcode digits');
  if (apiCheck.expectedShelf) {
    assert.ok(apiCheck.firstLabelText.includes(apiCheck.expectedShelf), 'label includes shelf location from novaItemLimits.shelfOf');
  }
  assert.equal(apiCheck.ref0, false, 'copies 0 refused');
  assert.equal(apiCheck.ref51, false, 'copies 51 refused');
  assert.equal(apiCheck.afterRef, 3, 'refused copies did not mutate queue');
  assert.equal(apiCheck.accAr, true, 'Arabic-Indic digit ٢ accepted');
  assert.equal(apiCheck.afterAr, 2, 'copies updated to 2');
  assert.equal(apiCheck.badSize, false, 'invalid size refused');
  assert.equal(apiCheck.okA4, 'a4');
  assert.equal(apiCheck.hasGridClass, true, 'setSize(a4) adds grid class');
  assert.equal(apiCheck.bCount, 0, '<b>x</b> is never rendered as an HTML element');
  assert.equal(apiCheck.xssTextPresent, true, '<b>x</b> appears as plain text');
  assert.equal(apiCheck.removed, true);
  assert.equal(apiCheck.countAfterRemove, 1);
  assert.equal(apiCheck.countAfterClear, 0);

  // Verify persistence across reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  const persisted = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    const q = window.novaShelfLabels.queue();
    const doc = new DOMParser().parseFromString(window.novaShelfLabels.html(), 'text/html');
    return { len: q.length, copies: q[0] && q[0].copies, hasGrid: !!doc.querySelector('.nsl-grid') };
  });
  assert.equal(persisted.len, 1, 'queue persists across reload');
  assert.equal(persisted.copies, 2);
  assert.equal(persisted.hasGrid, true, 'chosen size persists across reload');

  // Navigate to products page and verify card + 390px layout
  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="products"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaShelfLabels'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaShelfLabels', { timeout: 5000 });
  assert.equal(await page.locator('#novaShelfLabels').count(), 1, 'mounted once');

  const layout = await page.evaluate(() => {
    const c = document.getElementById('novaShelfLabels');
    const small = [...c.querySelectorAll('button,input')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(layout.sw <= layout.cw, 'no horizontal overflow at 390px: ' + layout.sw + '>' + layout.cw);
  assert.equal(layout.small, 0, 'controls are at least 44px high');
  assert.ok(layout.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background: ' + layout.bg);

  // Corrupt storage resilience + English labels
  await page.evaluate(() => {
    localStorage.setItem('nova-rx-shelf-labels-v1', '{bad-json');
    localStorage.setItem('nova-rx-language', 'en');
    document.getElementById('novaShelfLabels').remove();
  });
  await page.waitForSelector('#novaShelfLabels');
  const enText = await page.locator('#novaShelfLabels').textContent();
  assert.ok(enText && enText.includes('Shelf Price Labels'), 'English labels rendered');
  assert.equal(await page.evaluate(() => window.novaShelfLabels.queue().length), 0, 'corrupt JSON handled safely');

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  console.log('shelf-labels PASS');
} finally {
  await browser.close();
  server.close();
}