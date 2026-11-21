// #77 step 1: a received lot keeps its own sale price (lots[].price); a lot without one has no price field.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const URL = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { localStorage.clear(); sessionStorage.setItem('s', '1'); } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaStock && window.novaStock.addLot);
  const r = await page.evaluate(() => {
    const S = window.novaStock;
    const a = S.addLot({ key: 'LP-1', lot: 'OLD', expiry: '2030-01-31', qty: 3, cost: 10 });
    const b = S.addLot({ key: 'LP-1', lot: 'NEW', expiry: '2030-06-30', qty: 2, cost: 12, price: 25.456 });
    const bad = S.addLot({ key: 'LP-1', lot: 'NEG', expiry: '2030-07-31', qty: 1, price: -4 });
    return { ok: a.ok && b.ok && bad.ok, lots: S.lots('LP-1').map(l => ({ lot: l.lot, price: l.price })) };
  });
  assert.ok(r.ok, 'lots saved');
  assert.deepEqual(r.lots, [{ lot: 'OLD', price: undefined }, { lot: 'NEW', price: 25.46 }, { lot: 'NEG', price: undefined }]);
  console.log('PASS lot price kept and rounded; missing/negative price ignored');
} finally { await browser.close(); }
