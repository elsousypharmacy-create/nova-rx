// tests/ux/expiry-clearance.mjs
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
  if ((full !== ROOT && !full.startsWith(ROOT + path.sep)) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
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
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 }
  });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nec_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nec_cleared__', '1');
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
    const dayMs = 86400000;
    const now = Date.now();
    const fmt = (offset) => {
      const d = new Date(now + offset * dayMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const p10 = { id: 'ec-10', name: 'دواء عشرة أيام', barcode: '622888000010', price: 100 };
    const p45 = { id: 'ec-45', name: 'دواء خمسة وأربعون', barcode: '622888000045', price: 100 };
    const p100 = { id: 'ec-100', name: 'دواء مائة يوم', barcode: '622888000100', price: 100 };
    const pExp = { id: 'ec-exp', name: 'دواء منتهي', barcode: '622888000005', price: 100 };
    window.NOVA_DEMO.products.push(p10, p45, p100, pExp);

    const k10 = window.novaStock.keyOf(p10);
    const k45 = window.novaStock.keyOf(p45);
    const k100 = window.novaStock.keyOf(p100);
    const kExp = window.novaStock.keyOf(pExp);

    window.novaStock.addLot({ key: k10, lot: 'L10', expiry: fmt(10), qty: 5, cost: 50 });
    window.novaStock.addLot({ key: k45, lot: 'L45', expiry: fmt(45), qty: 4, cost: 50 });
    window.novaStock.addLot({ key: k100, lot: 'L100', expiry: fmt(100), qty: 6, cost: 50 });
    window.novaStock.addLot({ key: kExp, lot: 'LEXP', expiry: fmt(-5), qty: 3, cost: 40 });

    const EC = window.novaExpiryClearance;

    // Corrupt storage must not crash
    localStorage.setItem('nova-rx-expiry-plans-v1', '{broken-json');
    const plansAfterCorrupt = EC.plans();
    localStorage.removeItem('nova-rx-expiry-plans-v1');

    const near90 = EC.nearExpiry(90, now);
    const r10 = near90.find((r) => r.lotKey === 'L10');
    const r45 = near90.find((r) => r.lotKey === 'L45');
    const rExp = near90.find((r) => r.lotKey === 'LEXP');
    const r100 = near90.find((r) => r.lotKey === 'L100');

    const sug10 = EC.suggest(r10);
    const sug45 = EC.suggest(r45);
    const sugExp = EC.suggest(rExp);
    const sugCapped = EC.suggest({ daysLeft: 10, price: 100, cost: 85 });
    const sugExact = EC.suggest({ daysLeft: 10, price: 30, cost: 21 });
    const sugFloatEdge = EC.suggest({ daysLeft: 10, price: 100, cost: 93 });

    window.novaPerms = { require: () => true };
    const keepPerms = window.novaPerms;
    window.novaPerms = undefined;
    const permMissing = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 25 });
    window.novaPerms = { require: () => false };
    const permFalse = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 25 });
    window.novaPerms = { require: () => { throw new Error('denied'); } };
    const permThrows = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 25 });
    window.novaPerms = keepPerms;

    const badPct95 = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 95 });
    const badPct0 = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 0 });
    const badUntil = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: 20, until: 'not-a-date' });
    const saved = EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: '٢٥' });
    const fetched = EC.planFor(k10, 'L10');

    // Verify clear works and then restore plan for UI check
    const cleared = EC.clear(k10, 'L10');
    const afterClear = EC.planFor(k10, 'L10');
    EC.setPlan({ itemKey: k10, lotKey: 'L10', percent: '٢٥' });

    return {
      plansAfterCorruptLen: plansAfterCorrupt.length,
      count90: near90.length,
      has10: !!r10,
      has45: !!r45,
      hasExp: !!rExp,
      has100: !!r100,
      sug10,
      sug45,
      sugExp,
      sugCapped,
      sugExact,
      sugFloatEdge,
      permMissing,
      permFalse,
      permThrows,
      badPct95,
      badPct0,
      badUntil,
      saved,
      fetched,
      cleared,
      afterClear
    };
  });

  assert.equal(apiRes.plansAfterCorruptLen, 0, 'corrupt storage returns empty array');
  assert.equal(apiRes.count90, 3, 'nearExpiry(90) returns 3 lots');
  assert.equal(apiRes.has10, true);
  assert.equal(apiRes.has45, true);
  assert.equal(apiRes.hasExp, true);
  assert.equal(apiRes.has100, false, '100-day lot excluded from 90-day window');
  assert.equal(apiRes.sug10.percent, 30);
  assert.equal(apiRes.sug45.percent, 20);
  assert.equal(apiRes.sugExp.percent, 0);
  assert.equal(apiRes.sugExp.expired, true);
  assert.equal(apiRes.sugCapped.capped, true, 'cost floor sets capped true');
  assert.equal(apiRes.sugCapped.percent, 15, '100 * (1 - 0.15) = 85 >= cost 85');
  assert.equal(apiRes.sugExact.capped, false, '30 * (1 - 0.30) = 21 == cost 21 is not capped');
  assert.equal(apiRes.sugExact.percent, 30);
  assert.equal(apiRes.sugFloatEdge.capped, true);
  assert.equal(apiRes.sugFloatEdge.percent, 7, '100 * (1 - 0.07) = 93 >= cost 93');
  assert.equal(apiRes.permMissing, false, 'missing novaPerms fails closed');
  assert.equal(apiRes.permFalse, false);
  assert.equal(apiRes.permThrows, false);
  assert.equal(apiRes.badPct95, false);
  assert.equal(apiRes.badPct0, false);
  assert.equal(apiRes.badUntil, false);
  assert.equal(apiRes.fetched && apiRes.fetched.percent, 25);
  assert.equal(apiRes.cleared, true);
  assert.equal(apiRes.afterClear, null);

  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (tab) tab.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaExpiryClearance'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaExpiryClearance', { timeout: 5000 });
  assert.equal(await page.locator('#novaExpiryClearance').count(), 1);

  const cardText = await page.locator('#novaExpiryClearance').textContent();
  assert.ok(cardText.includes('دواء عشرة أيام'));
  assert.ok(cardText.includes('محضر إعدام'));

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaExpiryClearance');
    const small = [...c.querySelectorAll('button,input')].filter(
      (x) => x.offsetParent && x.getBoundingClientRect().height < 43
    ).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'all visible controls >= 44px');
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));

  console.log('expiry-clearance PASS');
} finally {
  await browser.close();
  server.close();
}