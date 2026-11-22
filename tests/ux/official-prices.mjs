// tests/ux/official-prices.mjs
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
const baseUrl = 'http://127.0.0.1:' + port + '/';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nop_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nop_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const csvSample = [
    'باركود,الاسم,السعر الجديد',
    '٦٢٢٨٨٨٠٠٠٠٠١,دواء خفض سعر,٤٥٫٥٠',
    '622888000002,دواء رفع سعر,٣٥',
    '622888000003,دواء نفس السعر,٢٠',
    '622888000099,صنف غير موجود,١٢٫٥',
    '622888000004,سعر غلط,-٥'
  ].join('\n');

  const apiRes = await page.evaluate(async (csv) => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const pLow = { id: 'op-1', name: 'دواء خفض سعر', barcode: '622888000001', price: 50 };
    const pHigh = { id: 'op-2', name: 'دواء رفع سعر', barcode: '622888000002', price: 30 };
    const pSame = { id: 'op-3', name: 'دواء نفس السعر', barcode: '622888000003', price: 20 };
    window.NOVA_DEMO.products.push(pLow, pHigh, pSame);

    const parsed = window.novaOfficialPrices.parse(csv);
    const compared = window.novaOfficialPrices.compare(parsed.rows);

    const origPerms = window.novaPerms;
    window.novaItemCard = window.novaItemCard || {};
    const origSetter = window.novaItemCard.setPrice;

    // 1. Real app (app/554-item-card.js) has no price setter -> must refuse even when permitted
    window.novaPerms = { require: (perm) => perm === 'prices.edit' };
    const noSetter = window.novaOfficialPrices.apply(compared.changed, 'تحديث شهري');

    // Attach setter so permission & reason refusals are genuinely tested (not masked by missing setter)
    window.novaItemCard.setPrice = (key, newPrice) => {
      const target = window.NOVA_DEMO.products.find((x) => {
        const k = window.novaStock && window.novaStock.keyOf ? String(window.novaStock.keyOf(x)) : String(x.barcode || x.id);
        return k === key;
      });
      if (!target) return false;
      target.price = newPrice;
      return true;
    };

    // 2. Permission false / throw / missing -> must refuse (fail closed)
    window.novaPerms = { require: () => false };
    const permFalse = window.novaOfficialPrices.apply(compared.changed, 'تحديث شهري');
    window.novaPerms = { require: () => { throw new Error('perm-err'); } };
    const permThrow = window.novaOfficialPrices.apply(compared.changed, 'تحديث شهري');
    window.novaPerms = undefined;
    const permMissing = window.novaOfficialPrices.apply(compared.changed, 'تحديث شهري');

    // 3. Missing reason -> must refuse even when permitted and setter exists
    window.novaPerms = { require: (perm) => perm === 'prices.edit' };
    const noReason = window.novaOfficialPrices.apply(compared.changed, '   ');
    const priceBeforeApply = pLow.price;
    const histBeforeApply = window.novaOfficialPrices.history().length;

    // 4. Successful apply updates product price & appends immutable history
    const applied = window.novaOfficialPrices.apply([compared.changed[0]], 'قائمة هيئة الدواء');
    const updatedProduct = window.NOVA_DEMO.products.find((x) => x.barcode === '622888000001');
    const updatedPrice = updatedProduct ? updatedProduct.price : null;

    // 5. Idempotency: re-applying the same change does not duplicate history
    const appliedAgain = window.novaOfficialPrices.apply([compared.changed[0]], 'قائمة هيئة الدواء');

    // 6. History cannot be edited
    const hist1 = window.novaOfficialPrices.history();
    if (hist1.length) {
      hist1[0].reason = 'MUTATED';
      hist1.push({ fake: true });
    }
    const hist2 = window.novaOfficialPrices.history();

    window.novaPerms = origPerms;
    if (origSetter === undefined) delete window.novaItemCard.setPrice;
    else window.novaItemCard.setPrice = origSetter;

    return {
      parsed,
      compared,
      noSetter,
      permFalse,
      permThrow,
      permMissing,
      noReason,
      priceBeforeApply,
      histBeforeApply,
      applied,
      appliedAgain,
      updatedPrice,
      hist2
    };
  }, csvSample);

  assert.equal(apiRes.parsed.rows.length, 4, '4 valid rows parsed');
  assert.equal(apiRes.parsed.errors.length, 1, '1 bad price row reported in errors');
  assert.equal(apiRes.parsed.rows[0].priceBaisa, 4550, 'Arabic-Indic price parsed to integer piasters');

  assert.equal(apiRes.compared.changed.length, 2);
  assert.equal(apiRes.compared.same.length, 1);
  assert.equal(apiRes.compared.notFound.length, 1);
  assert.equal(apiRes.compared.changed[0].flag, 'لازم تنزّل');
  assert.equal(apiRes.compared.changed[0].severity, 'red');
  assert.equal(apiRes.compared.changed[0].diffBaisa, -450);
  assert.equal(apiRes.compared.changed[0].pct, -9);
  assert.equal(apiRes.compared.changed[1].flag, 'يتحدّث');
  assert.equal(apiRes.compared.changed[1].severity, 'amber');

  assert.equal(apiRes.noSetter.ok, false);
  assert.ok(apiRes.noSetter.error.includes('التسعير مش متاح من هنا'));
  assert.equal(apiRes.permFalse.ok, false);
  assert.equal(apiRes.permThrow.ok, false);
  assert.equal(apiRes.permMissing.ok, false, 'missing novaPerms must fail closed');
  assert.equal(apiRes.noReason.ok, false);
  assert.equal(apiRes.priceBeforeApply, 50, 'refused calls must not mutate price');
  assert.equal(apiRes.histBeforeApply, 0, 'refused calls must not append history');

  assert.equal(apiRes.applied.ok, true);
  assert.equal(apiRes.updatedPrice, 45.5);
  assert.equal(apiRes.appliedAgain.ok, true);
  assert.equal(apiRes.appliedAgain.applied.length, 0, 're-apply is idempotent');
  assert.equal(apiRes.hist2.length, 1, 'history has exactly 1 entry');
  assert.equal(apiRes.hist2[0].reason, 'قائمة هيئة الدواء', 'history cannot be edited');
  assert.equal(apiRes.hist2[0].old, 5000);
  assert.equal(apiRes.hist2[0].new, 4550);

  // Card visible on products page, shows unavailable notice, populates table, 390px no overflow
  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="products"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaOfficialPrices'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaOfficialPrices', { timeout: 5000 });
  assert.equal(await page.locator('#novaOfficialPrices').count(), 1);
  const cardText = await page.locator('#novaOfficialPrices').textContent();
  assert.ok(cardText && cardText.includes('التسعير مش متاح من هنا'));

  // Populate comparison table in UI (pHigh is still changed, pLow was updated to 45.5)
  await page.fill('#nopInput', csvSample);
  await page.click('#nopAnalyzeBtn');
  await page.waitForSelector('#nopDiffWrap .nop-table', { timeout: 5000 });

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaOfficialPrices');
    const small = [...c.querySelectorAll('button')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'buttons at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark theme background');
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));

  console.log('official-prices PASS');
} finally {
  await browser.close();
  server.close();
}