// tests/ux/internal-barcodes.mjs
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
    if (!sessionStorage.getItem('__nib_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nib_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const apiRes = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    window.novaPerms = { require: () => true };
    const B = window.novaInternalBarcodes;
    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const prod1 = { id: 'loose-1', name: 'تركيبة <b>x</b> اختبار', price: 45 };
    const prod2 = { id: 'loose-2', name: 'كريم مركب اختبار', price: 60 };
    const prodReal = { id: 'real-1', name: 'صنف بباركود حقيقي', barcode: '6291041500213', price: 25 };
    window.NOVA_DEMO.products.push(prod1, prod2, prodReal);

    const keyOf = (p) => (window.novaStock && window.novaStock.keyOf ? String(window.novaStock.keyOf(p)) : String(p.barcode || p.id || p.name));
    const k1 = keyOf(prod1);
    const k2 = keyOf(prod2);
    const kReal = keyOf(prodReal);

    const validKnown = B.check('6291041500213');
    const validArabic = B.check('\u0666\u0662\u0669\u0661\u0660\u0664\u0661\u0665\u0660\u0660\u0662\u0661\u0663');
    const invalidKnown = B.check('6291041500214');

    const c1a = B.assign(k1);
    const c1b = B.assign(k1);
    const c2 = B.assign(k2);
    const got1 = B.get(k1);
    const found1 = B.findByCode(c1a);
    const found2 = B.findByCode(c2);
    const listLen = B.list().length;

    const refusedReal = B.assign(kReal);
    const gotReal = B.get(kReal);

    const origPerms = window.novaPerms;
    window.novaPerms = { require: () => false };
    const refusedFalse = B.assign('perm-test-1');
    const htmlWithoutPerm = B.html([k1], 'medium');
    window.novaPerms = { require: () => { throw new Error('denied'); } };
    const refusedThrow = B.assign('perm-test-2');
    window.novaPerms = null;
    const refusedMissing = B.assign('perm-test-3');
    window.novaPerms = origPerms;

    const stored = JSON.parse(localStorage.getItem('nova-rx-internal-barcodes-v1') || '{}');

    const labelHtml = B.html([k1], 'small');
    const host = document.createElement('div');
    host.innerHTML = labelHtml;
    const svg = host.querySelector('svg');
    const boldEl = host.querySelector('b');
    const nameEl = host.querySelector('.nib-label-name');

    return {
      validKnown,
      validArabic,
      invalidKnown,
      c1a,
      c1b,
      c2,
      got1,
      c1Valid: B.check(c1a),
      c2Valid: B.check(c2),
      found1,
      found2,
      listLen,
      k1,
      k2,
      refusedReal,
      gotReal,
      refusedFalse,
      refusedThrow,
      refusedMissing,
      permTest1Stored: B.get('perm-test-1'),
      permTest2Stored: B.get('perm-test-2'),
      permTest3Stored: B.get('perm-test-3'),
      storedCounter: stored.counter,
      htmlWithoutPermHasSvg: htmlWithoutPerm.includes('<svg'),
      hasSvg: !!svg,
      svgViewBox: svg ? svg.getAttribute('viewBox') : '',
      svgRects: svg ? svg.querySelectorAll('rect').length : 0,
      hasDigits: labelHtml.includes(c1a),
      hasBoldTag: !!boldEl,
      nameText: nameEl ? nameEl.textContent : ''
    };
  });

  assert.equal(apiRes.validKnown, true, 'known valid EAN-13 passes check()');
  assert.equal(apiRes.validArabic, true, 'Arabic-Indic EAN-13 passes check()');
  assert.equal(apiRes.invalidKnown, false, 'mutated check digit fails check()');
  assert.equal(apiRes.c1a, apiRes.c1b, 'assign is idempotent for same item');
  assert.equal(apiRes.got1, apiRes.c1a, 'get() returns assigned code');
  assert.ok(apiRes.c1a.startsWith('299') && apiRes.c1a.length === 13 && apiRes.c1Valid, 'valid 13-digit 299 internal code');
  assert.notEqual(apiRes.c1a, apiRes.c2, 'two items get different codes');
  assert.ok(Number(apiRes.c2.slice(3, 12)) > Number(apiRes.c1a.slice(3, 12)), 'sequence increases');
  assert.equal(apiRes.storedCounter, 2, 'persisted counter increments only on new assignments');
  assert.equal(apiRes.listLen, 2, 'list() contains both assigned items');
  assert.equal(apiRes.found1, apiRes.k1, 'findByCode finds first item');
  assert.equal(apiRes.found2, apiRes.k2, 'findByCode finds second item');
  assert.equal(apiRes.refusedReal, false, 'item with real barcode is refused');
  assert.equal(apiRes.gotReal, null, 'refused real-barcode item is not stored');
  assert.equal(apiRes.refusedFalse, false, 'permission returning false is refused');
  assert.equal(apiRes.refusedThrow, false, 'permission throwing is refused');
  assert.equal(apiRes.refusedMissing, false, 'missing novaPerms fails closed');
  assert.equal(apiRes.permTest1Stored, null, 'permission-false item is not stored');
  assert.equal(apiRes.permTest2Stored, null, 'permission-throw item is not stored');
  assert.equal(apiRes.permTest3Stored, null, 'missing-perms item is not stored');
  assert.equal(apiRes.htmlWithoutPermHasSvg, true, 'html() does not require edit permission');
  assert.equal(apiRes.hasSvg, true, 'html() contains an <svg>');
  assert.equal(apiRes.svgViewBox, '0 0 95 40', 'svg has 95 module-width bars area: ' + apiRes.svgViewBox);
  assert.ok(apiRes.svgRects > 10, 'svg draws barcode bars');
  assert.equal(apiRes.hasDigits, true, 'html() contains the 13 digits');
  assert.equal(apiRes.hasBoldTag, false, '<b>x</b> is not interpreted as HTML');
  assert.ok(apiRes.nameText.includes('<b>x</b>'), '<b>x</b> is preserved as plain text');

  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="products"]');
    if (tab) tab.click();
  });
  await page.waitForSelector('#novaInternalBarcodes', { state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('#novaInternalBarcodes').count(), 1, 'card mounted once on products page');
  assert.equal(await page.locator('#novaInternalBarcodes').isVisible(), true, 'card is visible on products page');

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaInternalBarcodes');
    const small = [...c.querySelectorAll('button,input,select')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'all visible controls are at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background: ' + lay.bg);

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  console.log('internal-barcodes PASS');
} finally {
  await browser.close();
  server.close();
}