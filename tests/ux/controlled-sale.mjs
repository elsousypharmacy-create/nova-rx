// #82 at sale (queue 10, rcv24): the REAL checkout in app/120 (ensureControlledCapture → novaControlled.capture before the sale is saved,
// novaControlled.record after it is saved). No mocks of novaControlled / novaSales.
//  1) a normal sale completes with zero extra prompts (no controlled dialog, no native dialog) and is stamped with the signed-in seller (#90);
//  2) a controlled item cannot be sold without the register entry: cancel and an invalid national ID both leave no sale and no register row;
//  3) offline (network cut after load): the controlled sale completes and one register row is linked to the saved sale id.
// Usage: node tests/ux/controlled-sale.mjs   (own static server; CHROME_PATH optional)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  let nativeDialogs = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { nativeDialogs++; d.dismiss().catch(() => {}); });
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');
  await page.evaluate(async () => {
    await window.novaAuth.createAccount({ name: 'سارة', role: 'owner', password: 'owner-pass-1' });
    await window.novaAuth.signIn('سارة', 'owner-pass-1');
  });
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!window.novaControlled);

  const sales = () => page.evaluate(() => window.novaSales.list().length);
  const reg = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nova-rx-controlled-log-v1') || '[]'); } catch { return null; } });
  async function addProduct() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
  }
  async function openPay() {
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#checkoutModal [data-skip-customer], #btnCheckoutSkipCustomer').first().click({ timeout: 800 }).catch(() => {});
  }
  const key = await page.evaluate(() => { const r = window.novaSearch.search('بانادول', 1); return window.novaStock.keyOf(r[0]); });

  // 1) normal sale: zero extra prompts, seller stamped
  await addProduct(); await openPay();
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  assert.equal(await page.locator('.nova-ctrl-field').count(), 0, 'no controlled dialog for a normal item');
  assert.equal(nativeDialogs, 0, 'no native prompt/confirm for a normal sale');
  assert.equal((await reg()).length, 0, 'normal sale writes no register row');
  const s1 = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s1.cashier, 'سارة', '#90: sale carries the signed-in seller name');
  assert.ok(/^acc-/.test(s1.cashierId || ''), '#90: sale carries the seller account id');
  await page.locator('#btnReceiptNewSale').click();

  // 2) controlled: cancel → no sale; invalid national ID → still no sale, no register row
  await page.evaluate(k => window.novaControlled.setControlled(k, true, 'test'), key);
  await addProduct(); await openPay();
  await page.locator('#btnConfirmPayment').click();
  await page.locator('[data-action="cancel"]').waitFor();
  await page.locator('[data-action="cancel"]').click();
  await page.waitForTimeout(400);
  assert.equal(await sales(), 1, 'cancelled register entry: no sale');
  assert.equal((await reg()).length, 0, 'cancelled: no register row');
  assert.ok(await page.locator('#checkoutModal.active').count(), 'checkout stays open after cancel');

  await page.locator('#btnConfirmPayment').click();
  await page.locator('form input[name="patientName"]').fill('مريض تجريبي');
  await page.locator('form input[name="nationalId"]').fill('١٢٣');
  await page.locator('form input[name="doctor"]').fill('د. تجربة');
  await page.locator('[data-action="save"]').click();
  await page.waitForTimeout(400);
  assert.equal(await sales(), 1, 'invalid national ID: no sale');
  assert.equal((await reg()).length, 0, 'invalid national ID: no register row');
  assert.ok(await page.locator('form input[name="nationalId"]').count(), 'register form stays open on invalid ID');

  // 3) offline: fix the ID and save with the network cut → sale + one linked register row
  await ctx.setOffline(true);
  await page.locator('form input[name="nationalId"]').fill('29001011234567');
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2, null, { timeout: 8000 });
  const rows = await reg();
  const saleId = await page.evaluate(() => window.novaSales.list()[0].id);
  assert.equal(rows.length, 1, 'offline: exactly one register row');
  assert.equal(rows[0].patientName, 'مريض تجريبي');
  assert.equal(rows[0].saleId, saleId, 'register row linked to the saved sale');
  await ctx.setOffline(false);
  assert.equal(nativeDialogs, 0, 'no native dialogs at all');
  assert.deepEqual(errors, []);
  console.log('controlled-sale passed');
} finally { await browser.close(); server.close(); }
