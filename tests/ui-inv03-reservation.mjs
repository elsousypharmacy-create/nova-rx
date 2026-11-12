// N24 / INV-03: the last unit cannot sell twice (two tabs, same device). Reservation with expiry + idempotent commit.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
await ctx.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: '' })); // demo products (numeric stock) stay
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { if (!localStorage.getItem('n24-seeded')) { localStorage.clear(); localStorage.setItem('n24-seeded', '1'); } sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
const open = async () => { const p = await ctx.newPage(); p.on('pageerror', e => { console.log('  pageerror', e.message); }); await p.goto(BASE, { waitUntil: 'load' }); await p.waitForFunction(() => window.novaStock, null, { timeout: 8000 }); return p; };
const A = await open(), B = await open();
const BARCODE = '6281001234578'; // demo Otrivin, stock set to 1 below
for (const p of [A, B]) await p.evaluate(b => { window.NOVA_DEMO.products.find(x => x.barcode === b).stock = 1; }, BARCODE);
const addItem = async p => { const i = p.locator('#mainSearchInput'); await i.fill(''); await i.fill(BARCODE); await p.waitForTimeout(250); await p.locator('#suggestionsBox .suggestion-item').first().click(); };
const skipGate = async p => { const s = p.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip'); if (await s.count() && await s.first().isVisible()) await s.first().click(); };
const sales = p => p.evaluate(() => window.novaSales.list().length);
const holds = p => p.evaluate(() => window.novaStock.holds().length);
const modalOpen = p => p.locator('#checkoutModal.active, .modal-overlay.active#checkoutModal').count();
await t('two tabs press Checkout on the last unit at once: only one payment window opens, the other is told why', async () => {
  await addItem(A); await addItem(B);
  await Promise.all([A.locator('#btnCheckout').click(), B.locator('#btnCheckout').click()]);
  await A.waitForTimeout(500);
  for (const p of [A, B]) await skipGate(p);
  await A.waitForTimeout(500);
  const open_ = (await modalOpen(A)) + (await modalOpen(B));
  assert.equal(open_, 1, 'exactly one tab holds the unit');
  assert.equal(await holds(A), 1);
  globalThis.winner = (await modalOpen(A)) ? A : B; globalThis.loser = winner === A ? B : A;
  assert.ok((await loser.locator('body').innerText()).includes('المخزون لا يكفي'));
});
await t('the hold expires: after expiry the other tab can take the unit', async () => {
  await A.evaluate(() => { const h = window.novaStock.holds().map(x => ({ ...x, exp: Date.now() - 1 })); localStorage.setItem('nova-rx-holds-v1', JSON.stringify(h)); });
  assert.equal(await holds(A), 0);
  assert.equal(await A.evaluate(b => window.novaStock.available(b, 'someone'), BARCODE), 1);
});
await t('both tabs confirm payment at the same moment with no hold left: exactly one sale is saved', async () => {
  // winner still has the payment window open; the loser gets one by taking the (expired) hold, then holds are wiped = worst case
  await loser.locator('#btnCheckout').click(); await loser.waitForTimeout(500); await skipGate(loser); await loser.waitForTimeout(300);
  assert.equal(await modalOpen(loser), 1);
  await A.evaluate(() => localStorage.setItem('nova-rx-holds-v1', '[]'));
  await Promise.all([A, B].map(p => p.locator('#btnConfirmPayment').click()));
  await A.waitForTimeout(600);
  assert.equal(await sales(A), 1, 'one sale in the ledger');
  assert.equal(await A.evaluate(b => window.novaStock.available(b, 'x'), BARCODE), 0);
  assert.ok(((await A.locator('body').innerText()) + (await B.locator('body').innerText())).includes('المخزون لا يكفي'));
  assert.equal(await holds(A), 0, 'no hold left behind');
});
await t('a later attempt on the sold-out unit is refused', async () => {
  await A.locator('.nova-tab[data-page=sale]').click().catch(() => {});
  await addItem(A); await A.locator('#btnCheckout').click(); await A.waitForTimeout(500); await skipGate(A); await A.waitForTimeout(300);
  assert.equal(await modalOpen(A), 0); assert.equal(await sales(A), 1);
});
await t('idempotency: the same sale key committed twice leaves one invoice', async () => {
  const r = await A.evaluate(() => { const s = window.novaSales.list()[0]; const copy = JSON.parse(JSON.stringify(s)); copy.number = 'DUP'; window.novaSales.add(copy); window.novaSales.add(copy); return window.novaSales.list().length; });
  assert.equal(r, 1);
});
await t('API: holds are per owner, expire by time, and untracked (stock null) products are never blocked', async () => {
  const r = await A.evaluate(() => {
    const S = window.novaStock, line = { barcode: 'x-untracked', name: 'untracked', qty: 99 };
    const untracked = S.reserve('o1', [line]).ok;
    window.NOVA_DEMO.products.find(x => x.barcode === '6281001234577').stock = 2; const l = { barcode: '6281001234577', name: 'v', qty: 2 };
    const a = S.reserve('o1', [l], 60).ok, b = S.reserve('o2', [{ ...l, qty: 1 }]).ok, own = S.reserve('o1', [l], 60).ok;
    return new Promise(res => setTimeout(() => res({ untracked, a, b, own, afterExpiry: S.reserve('o2', [l]).ok }), 150));
  });
  assert.deepEqual(r, { untracked: true, a: true, b: false, own: true, afterExpiry: true });
});
await browser.close();
console.log(n + ' tests passed');
