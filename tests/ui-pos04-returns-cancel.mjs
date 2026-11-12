// N37 POS-04: return reverses tender (card mocked), lot and cost; cancellation needs reason + permission + a second approver.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
const seed = (id, payment) => page.evaluate(([id, payment]) => window.novaSales.add({ id, number: 'S-' + id, at: new Date().toISOString(), customer: '', payment,
  lines: [{ name: 'A', barcode: 'A1', price: 100, qty: 4, discount: 0, unitFactor: 1, lots: [{ lot: 'L1', expiry: '2027-01-01', qty: 1, cost: 10 }, { lot: 'L2', expiry: '2028-01-01', qty: 3, cost: 20 }] }],
  subtotal: 400, discount: 0, vat: 0, total: 400, received: 400, change: 0 }), [id, payment]);
const sale = id => page.evaluate(id => window.novaSales.list().find(x => x.id === id), id);
await seed('c1', 'card'); await seed('k1', 'cash');
await t('return references the original invoice and cannot exceed sold qty', async () => {
  const e = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id === 'c1'); return window.novaSales.addReturn(s, { 0: 5 }, 'x').error; });
  assert.equal(e, 'too-many');
});
await t('card return: mock tender reversal, tail lot restored, cost reversed', async () => {
  const r = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id === 'c1'); const x = window.novaSales.addReturn(s, { 0: 2 }, 'طلب العميل'); return x.ret || x; });
  assert.equal(r.saleId, 'c1'); assert.equal(r.number, 'S-c1');
  assert.deepEqual(r.tender, { method: 'card', amount: 200, direction: 'refund', mock: true, ref: r.tender.ref }); assert.match(r.tender.ref, /^MOCK-/);
  assert.deepEqual(r.lotsRestored, [{ idx: 0, lot: 'L2', expiry: '2028-01-01', qty: 2 }]); assert.equal(r.costReversed, 40);
});
await t('second return spans lots (lot L2 last unit, then L1) and cost adds up', async () => {
  const r = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id === 'c1'); return window.novaSales.addReturn(s, { 0: 2 }, 'y').ret; });
  assert.deepEqual(r.lotsRestored.map(l => [l.lot, l.qty]), [['L1', 1], ['L2', 1]]); assert.equal(r.costReversed, 30);
});
await t('cash return: no mock ref', async () => {
  const r = await page.evaluate(() => window.novaSales.addReturn(window.novaSales.list().find(x => x.id === 'k1'), { 0: 1 }, 'z').ret);
  assert.equal(r.tender.mock, false); assert.equal(r.tender.ref, null); assert.equal(r.tender.method, 'cash');
});
const cx = o => page.evaluate(o => window.novaSales.cancelSale(window.novaSales.list().find(x => x.id === 'k1'), o), o);
await t('cancellation refused without reason, without permission, without or with self approval', async () => {
  assert.equal((await cx({ reason: ' ', by: 'a', role: 'manager', approvedBy: 'b' })).error, 'reason');
  assert.equal((await cx({ reason: 'r', by: 'a', role: 'cashier', approvedBy: 'b' })).error, 'permission');
  assert.equal((await cx({ reason: 'r', by: 'a', role: 'manager', approvedBy: '' })).error, 'approval');
  assert.equal((await cx({ reason: 'r', by: 'Sam', role: 'manager', approvedBy: ' sam ' })).error, 'self-approval');
  assert.equal(await page.evaluate(() => window.novaSales.isCancelled('k1')), false);
});
await t('approved cancellation returns the remainder, records who approved, blocks further returns', async () => {
  const r = await cx({ reason: 'خطأ في الفاتورة', by: 'Ali', role: 'manager', approvedBy: 'Dr Ahmed' });
  assert.ok(r.ok); assert.equal(r.ret.kind, 'cancel'); assert.equal(r.ret.amount, 300); assert.equal(r.ret.approvedBy, 'Dr Ahmed');
  assert.equal(await page.evaluate(() => window.novaSales.returnedAmount('k1')), 400);
  assert.equal((await cx({ reason: 'r', by: 'a', role: 'manager', approvedBy: 'b' })).error, 'already-cancelled');
  assert.equal(await page.evaluate(() => window.novaSales.addReturn(window.novaSales.list().find(x => x.id === 'k1'), { 0: 1 }, 'q').error), 'already-cancelled');
});
await t('UI: cancel box refuses a cashier, accepts manager + other approver, row shows cancelled', async () => {
  await seed('u1', 'cash');
  await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator('[data-return="u1"]').click();
  await page.locator('#novaRetReason').fill('خطأ'); await page.locator('#novaCancelBox summary').click();
  await page.locator('#novaCxBy').fill('Ali'); await page.locator('#novaCxApprover').fill('Dr Ahmed'); await page.locator('#novaCxOk').click();
  assert.ok((await page.locator('#novaRetMsg').innerText()).includes('صلاحية'));
  await page.locator('#novaCxRole').selectOption('manager'); await page.locator('#novaCxOk').click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.nova-return-overlay').count(), 0);
  assert.equal(await page.evaluate(() => window.novaSales.isCancelled('u1')), true);
  assert.ok((await page.locator('body').innerText()).includes('ملغاة'));
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS pos04 returns/cancel:', n, 'cases'); await browser.close();
