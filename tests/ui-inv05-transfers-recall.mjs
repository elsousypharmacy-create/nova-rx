// N33 / INV-05: branch transfers (request/send/receive, in-transit, quantity difference) and lot recall (blocks sale, lists notifiable customers from local records).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
let n = 0;
const t = async (name, fn) => {
  try { await fn(); }
  catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); }
  n++; console.log('  ok', name);
};

const isoDaysFromNow = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const EXP_DATE = isoDaysFromNow(-15);
const NEAR_DATE = isoDaysFromNow(45);
const FAR_DATE = isoDaysFromNow(200);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
await ctx.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: '' }));
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      sessionStorage.setItem('seeded', '1');
    }
    localStorage.setItem('nova-rx-language', 'ar');
    localStorage.removeItem('nova.activePage');
  } catch {}
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaStock && typeof window.novaStock.fefoPick === 'function', null, { timeout: 8000 });

const K = '6281001234567', FAR = isoDaysFromNow(300);
const ev = (fn, arg) => page.evaluate(fn, arg);
const sale = (id, number, customer, lots) => ev(x => window.novaSales.add({ id: x.id, number: x.number, at: new Date().toISOString(), customer: x.customer, payment: 'cash', lines: [{ name: 'Concor', barcode: x.k, unit: 'box', unitFactor: 1, price: 10, qty: 1, discount: 0, lot: x.lots[0].lot, lots: x.lots }], subtotal: 10, discount: 0, vat: 0, total: 10, received: 10, change: 0, source: 'DEMO' }), { id, number, customer, lots, k: K });
const cust = await ev(() => window.NOVA_DEMO.customers[0]);

await t('transfer out: request, send moves stock to in-transit, expired/recalled lots never ship', async () => {
  await ev(a => { window.novaStock.addLot({ barcode: a.k, lot: 'EXP', expiry: a.e, qty: 3 }); window.novaStock.addLot({ barcode: a.k, lot: 'L1', expiry: a.f, qty: 10 }); }, { k: K, e: isoDaysFromNow(-5), f: FAR });
  assert.equal((await ev(k => window.novaTransfers.request({ direction: 'out', branch: '', key: k, qty: 2 }), K)).ok, false);
  const r = await ev(k => window.novaTransfers.request({ direction: 'out', branch: 'B2', key: k, qty: 4 }), K);
  assert.equal(r.ok, true);
  assert.equal((await ev(id => window.novaTransfers.receive(id, 4), r.transfer.id)).error, 'bad-status', 'cannot receive before send');
  assert.equal((await ev(k => window.novaTransfers.request({ direction: 'out', branch: 'B2', key: k, qty: 11 }), K)).ok, true);
  const big = await ev(() => window.novaTransfers.list()[0]);
  assert.equal((await ev(id => window.novaTransfers.send(id), big.id)).ok, false, 'only 10 valid units, expired excluded');
  assert.equal((await ev(id => window.novaTransfers.send(id), r.transfer.id)).ok, true);
  assert.equal(await ev(k => window.novaStock.available(k), K), 6);
  assert.equal(await ev(k => window.novaTransfers.inTransit(k), K), 4);
  assert.equal((await ev(id => window.novaTransfers.send(id), r.transfer.id)).error, 'bad-status', 'no double send');
  const done = await ev(id => window.novaTransfers.receive(id, 3), r.transfer.id);
  assert.equal(done.transfer.status, 'received-diff'); assert.equal(done.transfer.diff, 1);
  assert.equal(await ev(k => window.novaTransfers.inTransit(k), K), 0);
  assert.equal(await ev(() => window.novaTransfers.differences().length), 1);
  assert.equal(await ev(k => window.novaStock.available(k), K), 6, 'sender stock not restored by a shortfall');
});

await t('transfer in: received quantity becomes a lot; difference recorded; state survives reload', async () => {
  const r = await ev(() => window.novaTransfers.request({ direction: 'in', branch: 'B3', key: '6281001234568', qty: 5 }));
  await ev(id => window.novaTransfers.send(id, { qty: 5 }), r.transfer.id);
  assert.equal(await ev(() => window.novaTransfers.inTransit('6281001234568')), 5);
  assert.equal((await ev(id => window.novaTransfers.receive(id, 4), r.transfer.id)).error, 'invalid' , 'lot and expiry required');
  const done = await ev(a => window.novaTransfers.receive(a.id, 4, { lot: 'T1', expiry: a.f }), { id: r.transfer.id, f: FAR });
  assert.equal(done.transfer.diff, 1);
  assert.equal(await ev(() => window.novaStock.available('6281001234568')), 4);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.novaTransfers);
  assert.equal(await ev(() => window.novaTransfers.list().length), 3);
});

await t('recall blocks sale of the lot and lists only customers reachable from local records', async () => {
  await sale('s1', 'R1', cust.name, [{ lot: 'L1', qty: 1 }]);
  await sale('s2', 'R2', 'عميل بدون سجل', [{ lot: 'L1', qty: 1 }]);
  await sale('s3', 'R3', '', [{ lot: 'L1', qty: 1 }]);
  await sale('s4', 'R4', cust.name, [{ lot: 'OTHER', qty: 1 }]);
  assert.equal((await ev(k => window.novaStock.recallLot(k, 'NOPE'), K)).ok, false);
  const before = await ev(k => window.novaStock.fefoPick(k, 1).ok, K);
  assert.equal(before, true);
  const r = await ev(k => window.novaStock.recallLot(k, 'L1', 'test'), K);
  assert.equal(r.ok, true);
  assert.deepEqual(r.customers, [{ name: cust.name, phone: cust.phone, invoices: ['R1'] }]);
  assert.deepEqual(r.unreachable, { walkIn: 1, noPhone: 1 });
  const p = await ev(k => window.novaStock.fefoPick(k, 1), K);
  assert.equal(p.ok, false); assert.equal(p.reason, 'recalled');
  assert.equal(await ev(k => window.novaStock.available(k), K), 0);
  assert.equal((await ev(k => window.novaTransfers.request({ direction: 'out', branch: 'B2', key: k, qty: 1 }), K)).ok, true);
  const t2 = await ev(() => window.novaTransfers.list()[0]);
  assert.equal((await ev(id => window.novaTransfers.send(id), t2.id)).ok, false, 'recalled lot cannot be transferred out');
  assert.equal((await ev(k => window.novaStock.unrecallLot(k, 'L1'), K)).ok, true);
  assert.equal(await ev(k => window.novaStock.fefoPick(k, 1).ok, K), true);
});

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log(n + ' passed');
