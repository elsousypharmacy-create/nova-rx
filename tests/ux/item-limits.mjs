// tests/ux/item-limits.mjs
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
    if (!sessionStorage.getItem('__nil_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nil_cleared__', '1');
    }
    const now = Date.now();
    const day = 86400000;
    const sales = [];
    for (let i = 1; i <= 10; i++) {
      sales.push({
        at: new Date(now - i * day).toISOString(),
        lines: [{ barcode: '622999000001', name: 'باراسيتامول اختبار', qty: 2, unit: 'box', unitFactor: 1 }]
      });
    }
    sales.push({
      at: new Date(now - 2 * day).toISOString(),
      lines: [{ barcode: '622999000001', name: 'باراسيتامول اختبار', qty: 2, unit: 'strip', unitFactor: 2 }]
    });
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify(sales));
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const prodA = { id: 'test-a', name: 'باراسيتامول اختبار', barcode: '622999000001', price: 20 };
    const prodB = { id: 'test-b', name: 'أموكسيسيلين اختبار', barcode: '622999000002', price: 35 };
    window.NOVA_DEMO.products.push(prodA, prodB);

    const keyA = window.novaStock.keyOf(prodA);
    const keyB = window.novaStock.keyOf(prodB);

    // lots() already subtracts the seeded sales (21 boxes), so 23 received = 2 on hand
    window.novaStock.addLot({ key: keyA, lot: 'LA1', expiry: '2030-01-31', qty: 23, cost: 10 });
    window.novaStock.addLot({ key: keyB, lot: 'LB1', expiry: '2030-01-31', qty: 50, cost: 20 });

    window.novaItemLimits.set(keyA, { min: 5, max: 15, shelf: 'رف 1' });
    window.novaItemLimits.set(keyB, { min: 1, max: 10 });

    const below = window.novaItemLimits.below();
    const above = window.novaItemLimits.above();
    const sugA = window.novaItemLimits.suggest(keyA);
    const shelfA = window.novaItemLimits.shelfOf(keyA);

    const origPerms = window.novaPerms;
    window.novaPerms = { require: () => false };
    const denied = window.novaItemLimits.set(keyA, { min: 99, max: 120, shelf: 'رف 9' });
    const afterDenied = window.novaItemLimits.get(keyA);
    window.novaPerms = origPerms;

    return { keyA, keyB, below, above, sugA, shelfA, denied, afterDenied };
  });

  assert.equal(result.below.length, 1);
  assert.equal(result.below[0].key, result.keyA);
  assert.equal(result.below[0].need, 13);
  assert.equal(result.above.length, 1);
  assert.equal(result.above[0].key, result.keyB);
  assert.deepEqual(result.sugA, { min: 5, max: 15 });
  assert.equal(result.shelfA, 'رف 1');
  assert.equal(result.denied, false);
  assert.equal(result.afterDenied.min, 5);

  await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page="products"]'); if (t) t.click(); });
  await page.waitForSelector('#novaItemLimits', { timeout: 5000 });
  const belowText = await page.locator('#nilBelowWrap').textContent();
  assert.ok(belowText && belowText.includes('باراسيتامول اختبار'), 'Expected product A row in below-minimum table');
  assert.ok(belowText.includes('13') && belowText.includes('رف 1'), 'row shows the needed quantity and the shelf');
  assert.ok((await page.locator('#nilAboveWrap').textContent()).includes('أموكسيسيلين اختبار'), 'overstock row for B');
  assert.equal(await page.locator('#novaItemLimits').count(), 1, 'mounted once (observer does not loop)');

  // 390px: no page overflow, 44px controls, dark theme
  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaItemLimits'), r = c.getBoundingClientRect();
    const small = [...c.querySelectorAll('button,input')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, right: r.right, left: r.left, small, bg: getComputedStyle(c).backgroundColor, html: c.innerHTML.length };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal page overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'controls are at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background: ' + lay.bg);

  // UI flow: search -> pick -> suggest (Arabic-Indic digits typed) -> save
  await page.fill('#novaItemLimits input[type=search]', 'باراسيتامول اختبار');
  await page.locator('.nil-result-btn').first().click();
  await page.locator('#novaItemLimits .btn-secondary', { hasText: 'اقترح من المبيعات' }).click();
  assert.equal(await page.inputValue('#nilMinInput'), '5');
  assert.equal(await page.inputValue('#nilMaxInput'), '15');
  await page.fill('#nilMinInput', '٣');
  await page.fill('#nilMaxInput', '٢٠');
  await page.fill('#nilShelfInput', 'رف ٣ – ب');
  await page.locator('#novaItemLimits .btn-primary', { hasText: 'حفظ' }).click();
  const saved = await page.evaluate((k) => window.novaItemLimits.get(k), result.keyA);
  assert.deepEqual([saved.min, saved.max, saved.shelf], [3, 20, 'رف ٣ – ب'], 'Arabic-Indic digits accepted');
  assert.equal(await page.evaluate(() => window.novaItemLimits.below().length), 1, 'A (2 on hand) is still below the new min 3');

  // validation + fail-closed (require returns false, require throws)
  const val = await page.evaluate((k) => {
    const L = window.novaItemLimits, out = {};
    out.maxLtMin = L.set(k, { min: 10, max: 5 });
    out.negative = L.set(k, { min: -1 });
    out.junk = L.set(k, { min: 'abc' });
    const keep = window.novaPerms;
    window.novaPerms = { require: () => { throw new Error('boom'); } };
    out.throws = L.set(k, { min: 1, max: 2, shelf: 'x' });
    window.novaPerms = { require: () => false };
    out.falsy = L.set(k, { min: 1, max: 2, shelf: 'x' });
    window.novaPerms = keep;
    out.after = L.get(k);
    out.noSales = L.suggest('no-such-key');
    return out;
  }, result.keyA);
  assert.equal(val.maxLtMin, false); assert.equal(val.negative, false); assert.equal(val.junk, false);
  assert.equal(val.throws, false); assert.equal(val.falsy, false);
  assert.deepEqual([val.after.min, val.after.max], [3, 20], 'refused writes changed nothing');
  assert.deepEqual(val.noSales, { min: 0, max: 0 });

  // below() uses min*2 when max is empty; strip sales count as boxes (21 above); 30-day window
  const extra = await page.evaluate((k) => {
    const L = window.novaItemLimits;
    L.set(k, { min: 4, max: null, shelf: '' });
    const b = L.below()[0];
    const old = JSON.parse(localStorage.getItem('nova-rx-sales-v1'));
    old.forEach((s) => { s.at = new Date(Date.now() - 40 * 86400000).toISOString(); });
    localStorage.setItem('nova-rx-sales-v1', JSON.stringify(old));
    return { need: b && b.need, old: L.suggest(k) };
  }, result.keyA);
  assert.equal(extra.need, 6, 'need = min*2 - onHand = 8 - 2');
  assert.deepEqual(extra.old, { min: 0, max: 0 }, 'sales older than 30 days are ignored');

  // a re-mounted card has an empty form: Save must not wipe the previous pick's limits
  await page.evaluate(() => document.getElementById('novaItemLimits').remove());
  await page.waitForSelector('#novaItemLimits');
  await page.locator('#novaItemLimits .btn-primary', { hasText: 'حفظ' }).click();
  const still = await page.evaluate((k) => window.novaItemLimits.get(k), result.keyA);
  assert.equal(still.min, 4, 'save without a picked item changed nothing');

  // English labels + no page errors
  await page.evaluate(() => localStorage.setItem('nova-rx-language', 'en'));
  await page.evaluate(() => { const c = document.getElementById('novaItemLimits'); c.remove(); });
  await page.waitForSelector('#novaItemLimits');
  assert.ok((await page.locator('#novaItemLimits').textContent()).includes('Below Minimum'));
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));

  console.log('PASS: item-limits UX test');
} finally {
  await browser.close();
  server.close();
}
