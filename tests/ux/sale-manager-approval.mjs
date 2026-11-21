// Task 4 (#100): with accounts on the device a cashier needs a manager's approval (password) to delete an item or to
// finish a sale with a discount above the limit; a manager/owner is exempt. Usage: node tests/ux/sale-manager-approval.mjs
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
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');

  const signIn = (name, role, pw, create = true) => page.evaluate(async ([n, r, p, c]) => { const A = window.novaAuth; if (c) await A.createAccount({ name: n, role: r, password: p }); await A.signIn(n, p); }, [name, role, pw, create]);
  await signIn('مالك تجربة', 'owner', 'owner-pass-1');
  await page.evaluate(async () => { await window.novaAuth.createAccount({ name: 'مدير تجربة', role: 'manager', password: 'mgr-pass-1' }); await window.novaAuth.createAccount({ name: 'كاشير تجربة', role: 'cashier', password: 'cash-pass-1' }); });
  await signIn('كاشير تجربة', 'cashier', 'cash-pass-1', false);

  const lines = () => page.evaluate(() => document.querySelectorAll('#invoiceTableBody tr [data-act="del"]').length);
  async function addProduct() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
  }
  async function approve(name, pw) { await page.locator('#novaSaleApproval').waitFor(); await page.locator('#novaSaUser').fill(name); await page.locator('#novaSaPw').fill(pw); await page.locator('[data-sa-ok]').click(); }

  // 1) cashier deletes a line: dialog; cancel keeps it; wrong role refused; manager approves => deleted + logged
  await addProduct();
  assert.equal(await lines(), 1);
  await page.locator('[data-act="del"]').first().click();
  await page.locator('#novaSaleApproval').waitFor();
  await page.locator('[data-sa-cancel]').click();
  await page.waitForTimeout(300);
  assert.equal(await lines(), 1, 'cancel keeps the line');
  await page.locator('[data-act="del"]').first().click();
  await approve('كاشير تجربة', 'cash-pass-1');
  await page.waitForSelector('#novaSaleApproval [data-sa-err]:not(:empty)');
  assert.equal(await lines(), 1, 'a cashier cannot approve');
  await page.locator('#novaSaPw').fill('mgr-pass-1'); await page.locator('#novaSaUser').fill('مدير تجربة'); await page.locator('[data-sa-ok]').click();
  await page.waitForFunction(() => !document.querySelector('#novaSaleApproval') && !document.querySelector('#invoiceTableBody [data-act="del"]'));
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-sale-approvals-v1') || '[]'));
  assert.equal(log[0].type, 'line-delete'); assert.equal(log[0].approvedBy, 'مدير تجربة');

  // 2) big discount at payment: dialog; approve => sale carries discountApproval
  await addProduct();
  await page.evaluate(() => { const i = document.getElementById('inputPercentDiscount'); i.value = '50'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#btnCheckout').click();
  await page.locator('#checkoutModal.active').waitFor();
  await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
  await page.locator('#btnConfirmPayment').click();
  await page.locator('#novaSaleApproval').waitFor();
  assert.match(await page.locator('#novaSaleApproval').innerText(), /خصم/);
  await page.locator('[data-sa-cancel]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.novaSales.list().length), 0, 'cancel => no sale');
  await page.locator('#btnConfirmPayment').click();
  await approve('مدير تجربة', 'mgr-pass-1');
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  const sale = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(sale.discountApproval.approvedBy, 'مدير تجربة'); assert.equal(sale.discountApproval.unverified, false); assert.ok(sale.discountApproval.pct >= 50);
  await page.locator('#btnReceiptNewSale').click();

  // 3) small discount: no dialog
  await addProduct();
  await page.evaluate(() => { const i = document.getElementById('inputPercentDiscount'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#btnCheckout').click();
  await page.locator('#checkoutModal.active').waitFor();
  await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'no dialog under the limit');
  await page.locator('#btnReceiptNewSale').click();

  // 4) manager signed in: exempt from both
  await signIn('مدير تجربة', 'manager', 'mgr-pass-1', false);
  await addProduct();
  await page.locator('[data-act="del"]').first().click();
  await page.waitForFunction(() => !document.querySelector('#invoiceTableBody [data-act="del"]'));
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'manager deletes freely');
  assert.deepEqual(errors, []);
  console.log('sale-manager-approval passed');
} finally { await browser.close(); server.close(); }
