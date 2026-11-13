// POS-02: tenders (cash/card/credit/mixed), change, idempotent mock card, unique numbers, cancelled log. Local only, snapshot price list.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 3).join('\n')); process.exit(1); } console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage();
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });
const P = (total, t, c) => page.evaluate(([a, b, c2]) => window.novaPay.plan(a, b, c2), [total, t, c]);

await t('plan: cash change, short, exact card/credit, mixed, over-allocation, credit needs customer', async () => {
  let r = await P(100, { cash: 150 }, false); assert.ok(r.ok); assert.equal(r.change, 50); assert.equal(r.payment, 'cash'); assert.equal(r.collected, 100);
  assert.equal((await P(100, { cash: 99.99 }, false)).error, 'short');
  r = await P(100, { cash: 40, card: 30, credit: 30 }, true); assert.ok(r.ok); assert.equal(r.payment, 'mixed'); assert.equal(r.change, 0); assert.equal(r.collected, 70); assert.equal(r.credit, 30);
  r = await P(100, { cash: 100, card: 30 }, false); assert.equal(r.change, 30); assert.equal(r.tenders.find(x => x.method === 'cash').amount, 70);
  assert.equal((await P(100, { card: 60, credit: 50 }, true)).error, 'over-allocated');
  assert.equal((await P(100, { credit: 10, cash: 90 }, false)).error, 'credit-needs-customer');
  assert.equal((await P(100, { cash: -5 }, false)).error, 'invalid');
  r = await P(0.3, { cash: 0.1 + 0.2 }, false); assert.ok(r.ok); // float-safe
});
await t('card charge is idempotent per key; decline writes nothing; changed amount re-authorises; void', async () => {
  const r = await page.evaluate(() => {
    const p = window.novaPay, o = {};
    o.a = p.chargeCard('K1', 50); o.b = p.chargeCard('K1', 50);
    p._declineNext = true; o.d = p.chargeCard('K2', 10); o.none = p.cardAuth('K2');
    o.c = p.chargeCard('K1', 60); p.captureCard('K1'); o.cap = p.cardAuth('K1').state;
    o.again = p.chargeCard('K1', 60); p.voidCard('K3'); return o;
  });
  assert.equal(r.a.replay, false); assert.equal(r.b.replay, true); assert.equal(r.a.auth.id, r.b.auth.id);
  assert.equal(r.d.error, 'declined'); assert.equal(r.none, null);
  assert.notEqual(r.c.auth.id, r.a.auth.id); assert.equal(r.cap, 'captured'); assert.equal(r.again.replay, true);
});
const addAndOpen = async (q) => {
  const i = page.locator('#mainSearchInput'); await i.fill(''); await i.fill(q); await page.waitForTimeout(250);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.locator('#btnCheckout').click(); await page.waitForTimeout(200);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip'); if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
  await page.waitForTimeout(200);
};
await t('mixed cash+card sale saved with tenders, change and one card authorisation', async () => {
  await addAndOpen('جافيسكون');
  await page.locator('.pay-method-btn[data-method=split]').click();
  const total = Number(await page.evaluate(() => window.__t = (document.getElementById('modalAmountDue').textContent.match(/[0-9]+(\.[0-9]+)?/) || [0])[0]));
  await page.locator('#inputCardAmount').fill('1'); await page.locator('#inputCashReceived').fill(String(total + 20));
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(300);
  const s = (await page.evaluate(() => window.novaSales.list()))[0];
  assert.equal(s.status, 'final'); assert.equal(s.payment, 'mixed'); assert.equal(s.tenders.length, 2);
  assert.ok(Math.abs(s.change - 21) < 0.011, 'change ' + s.change); assert.equal(s.collected, s.total); assert.ok(s.cardAuth);
  await page.locator('#btnCloseReceipt').click();
});
await t('save failure keeps the invoice, retry does not charge the card twice', async () => {
  await addAndOpen('gaviscon');
  await page.locator('.pay-method-btn[data-method=card]').click();
  await page.evaluate(() => { window.__orig = window.novaSales.add; window.novaSales.add = () => false; });
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ n: window.novaSales.list().length, auths: Object.values(JSON.parse(localStorage.getItem('nova-rx-card-auth-v1') || '{}')).filter(a => a.state === 'authorized').length, lines: document.querySelectorAll('#invoiceTableBody tr').length }));
  assert.equal(before.auths, 1); assert.ok(before.lines >= 1); assert.ok(await page.locator('#checkoutModal.active').count());
  await page.evaluate(() => { window.novaSales.add = window.__orig; });
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ list: window.novaSales.list(), auths: Object.values(JSON.parse(localStorage.getItem('nova-rx-card-auth-v1') || '{}')) }));
  const mine = after.auths.filter(a => a.state === 'captured');
  assert.equal(after.list.length, before.n + 1); assert.equal(after.list[0].payment, 'card'); assert.equal(after.auths.filter(a => a.state === 'authorized').length, 0);
  assert.equal(after.list[0].cardAuth, mine.find(a => a.id === after.list[0].cardAuth).id);
  await page.locator('#btnCloseReceipt').click();
});
await t('card decline saves nothing', async () => {
  await addAndOpen('جافيسكون');
  await page.locator('.pay-method-btn[data-method=card]').click();
  const n = await page.evaluate(() => { window.novaPay._declineNext = true; return window.novaSales.list().length; });
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.novaSales.list().length), n);
  assert.ok(await page.locator('#checkoutModal.active').count());
  await page.locator('#btnCloseCheckout').click();
});
await t('credit without a customer is refused; invoice numbers stay unique', async () => {
  await addAndOpen('جافيسكون');
  await page.locator('.pay-method-btn[data-method=credit]').click();
  const n = await page.evaluate(() => window.novaSales.list().length);
  // UX32: confirm is disabled up-front for credit with a walk-in customer (no post-Enter rejection)
  assert.ok(await page.locator('#btnConfirmPayment').isDisabled());
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.novaSales.list().length), n);
  await page.locator('#btnCloseCheckout').click();
  const nums = await page.evaluate(() => { const used = window.novaSales.list()[0].number; localStorage.setItem('nova-rx-sale-sequence-v1', '0'); return { used, next: window.novaPay.numberTaken(used) }; });
  assert.ok(nums.next);
  const all = await page.evaluate(() => window.novaSales.list().map(s => s.number)); assert.equal(new Set(all).size, all.length);
});
await t('cancelled log records a discarded parked invoice and reserves its number', async () => {
  const r = await page.evaluate(() => { window.novaPay.cancel({ saleNumber: 'S-999999', total: 5, lines: [1] }, 'parked-deleted'); return { c: window.novaPay.cancelled(), taken: window.novaPay.numberTaken('S-999999') }; });
  assert.equal(r.c[0].status, 'cancelled'); assert.ok(r.taken);
});
await browser.close(); console.log('POS-02 OK');
