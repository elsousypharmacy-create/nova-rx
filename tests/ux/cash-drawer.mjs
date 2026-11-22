// #97 cash drawer (block 618 in app/594-ops-screens.js, queue 11, rcv24). Draft Gemini u/1, review Gemini u/0, fixed by Claude B.
//  - manual open: real novaPerms ('sale.create'; 'drawer.open' does not exist and would refuse everyone), reason required, fail closed on deny/throw/missing;
//  - pulse bytes ESC p 0 25 250 to novaDeviceGateway.send; the printInvoice fallback is used ONLY when novaDevicePrint.hasGateway() (else it prints nothing);
//  - the card (reason + button + auto toggle + last opens) is on the reports page; the sale screen hides #novaPageView.
//  - auto-open: a REAL cash sale through the checkout ('nova:invoice-completed') logs one auto open; off = nothing; card sale = nothing; never twice per invoice.
// Usage: node tests/ux/cash-drawer.mjs   (own static server; CHROME_PATH optional)
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!window.novaCashDrawer);

  // card on the reports page (#novaPageView is hidden on the sale screen), visible, no overflow at 390px
  await page.evaluate(() => { try { sessionStorage.setItem('nova.reportsTab', 'shift'); } catch {} }); // UI-BATCH1: reports tabs
  await page.evaluate(() => { const b = document.querySelector('.nova-tab[data-page="shift"]'); if (b) b.click(); }); // the top bar is hidden at 390px; Q21-2f: the drawer is in «الوردية»
  await page.waitForSelector('#novaCashDrawerCard', { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no overflow at 390px');
  await page.evaluate(() => { const b = document.querySelector('.nova-tab[data-page="sale"]'); if (b) b.click(); });
  await page.waitForSelector('#mainSearchInput', { state: 'visible' });

  const r = await page.evaluate(() => {
    const out = {}, D = window.novaCashDrawer, realPerms = window.novaPerms;
    localStorage.setItem('nova-rx-cash-drawer-log', '{bad json');
    out.corrupt = D.log().length;
    localStorage.removeItem('nova-rx-cash-drawer-log');
    // real permissions, no accounts yet: allowed; no gateway in the app -> logged honestly as 'no-printer'
    out.noReason = D.open('   ');
    out.real = D.open('فكة');
    // real permissions with accounts: cashier may (sale.create), store role may not
    const mk = role => window.NovaPerms.create({ storage: localStorage, current: () => ({ id: 'u1', name: 'س', role }), hasAccounts: () => true });
    window.novaPerms = mk('cashier'); out.cashier = D.open('باقي');
    window.novaPerms = mk('store'); out.store = D.open('باقي');
    window.novaPerms = { require: () => false }; out.denied = D.open('فكة');
    window.novaPerms = { require: () => { throw new Error('boom'); } }; out.threw = D.open('فكة');
    window.novaPerms = undefined; out.missing = D.open('فكة');
    window.novaPerms = realPerms;
    // gateway pulse bytes
    const sent = [];
    window.novaDeviceGateway = { send: req => { sent.push(req); return { ok: true }; } };
    out.gw = D.open('إعطاء باقي للعميل'); out.bytes = sent[0] ? sent[0].bytes : null;
    // gateway refuses, device print has no gateway/printer -> must NOT claim a receipt
    const printed = [];
    const realDP = window.novaDevicePrint;
    window.novaDeviceGateway = { send: () => ({ ok: false }) };
    window.novaDevicePrint = { hasGateway: () => false, printInvoice: s => { printed.push(s); return { ok: true }; } };
    out.noPrinter = D.open('جرد'); out.printedNoGw = printed.length;
    window.novaDevicePrint = { hasGateway: () => true, printInvoice: s => { printed.push(s); return Promise.resolve({ ok: true }); } };
    out.fallback = D.open('جرد'); out.printedGw = printed.length;
    window.novaDevicePrint = realDP; delete window.novaDeviceGateway;
    out.count = D.log().length;
    out.last = D.log()[D.log().length - 1];
    return out;
  });
  assert.equal(r.corrupt, 0, 'corrupt log -> []');
  assert.equal(r.noReason.error, 'reason-required');
  assert.equal(r.real.ok, true, 'real novaPerms (no accounts) allows a manual open');
  assert.equal(r.real.method, 'no-printer', 'no gateway in the app -> honest no-printer');
  assert.equal(r.cashier.ok, true, 'cashier (sale.create) may open');
  assert.equal(r.store.error, 'forbidden', 'store role refused');
  assert.equal(r.denied.error, 'forbidden'); assert.equal(r.threw.error, 'forbidden'); assert.equal(r.missing.error, 'forbidden');
  assert.equal(r.gw.method, 'gateway-raw');
  assert.deepEqual(r.bytes, [27, 112, 0, 25, 250], 'ESC p 0 25 250');
  assert.equal(r.noPrinter.method, 'no-printer'); assert.equal(r.printedNoGw, 0, 'printInvoice not used without a gateway');
  assert.equal(r.fallback.method, 'fallback-receipt'); assert.equal(r.printedGw, 1);
  assert.equal(r.count, 5, 'every successful open logged (real, cashier, gw, noPrinter, fallback)');
  assert.ok(r.last.at && r.last.reason === 'جرد' && r.last.mode === 'manual', 'who/when/reason logged');

  // auto-open on a REAL cash sale
  async function cashSale() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#checkoutModal [data-skip-customer], #btnCheckoutSkipCustomer').first().click({ timeout: 800 }).catch(() => {});
    const n = await page.evaluate(() => window.novaSales.list().length);
    await page.locator('#btnConfirmPayment').click();
    await page.waitForFunction(k => window.novaSales.list().length === k + 1, n);
    await page.locator('#btnReceiptNewSale').click().catch(() => {});
  }
  const autoCount = () => page.evaluate(() => window.novaCashDrawer.log().filter(e => e.mode === 'auto').length);
  await page.evaluate(() => window.novaCashDrawer.setAutoEnabled(false));
  await cashSale();
  assert.equal(await autoCount(), 0, 'auto off -> no open after a cash sale');
  await page.evaluate(() => window.novaCashDrawer.setAutoEnabled(true));
  await cashSale();
  const s = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s.payment, 'cash', 'the real sale is cash');
  assert.equal(await autoCount(), 1, 'auto on -> one open after a real cash sale');
  const linked = await page.evaluate(n => window.novaCashDrawer.log().filter(e => e.sale === n).length, String(s.number));
  assert.equal(linked, 1, 'auto open linked to the invoice number');
  // same invoice again -> no second open; a card sale -> no open
  await page.evaluate(n => {
    window.dispatchEvent(new CustomEvent('nova:invoice-completed', { detail: { id: n } }));
    window.novaSales.add({ id: 'CARD-1', number: '990001', lines: [], payment: 'card', tenders: [{ method: 'card', amount: 10 }] });
    window.dispatchEvent(new CustomEvent('nova:invoice-completed', { detail: { id: '990001' } }));
  }, String(s.number));
  assert.equal(await autoCount(), 1, 'no duplicate per invoice, no open for card');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('cash-drawer PASS');
} finally {
  await browser.close();
  server.close();
}
