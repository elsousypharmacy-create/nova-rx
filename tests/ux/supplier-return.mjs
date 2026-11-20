// SUP-RET (#79): return goods to a supplier from the receiving page — stock lot reduced, ledger adjustment,
// return record, supplier credit note against the open invoice. Fake/local data; external requests blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(BASE) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  let native = 0; page.on('dialog', d => { native++; d.dismiss(); });
  await page.addInitScript(() => { window.print = () => { window.__prints = (window.__prints || 0) + 1; window.__printClass = document.body.classList.contains('sret-printing'); setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); }; });
  await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  const seed = await page.evaluate(() => {
    const p = window.novaSearch.search('6281001234567', 1)[0];
    const key = window.novaStock.keyOf(p);
    if (!window.novaStock.addLot({ key, lot: 'L1', expiry: '2027-01-31', qty: 10, cost: 5 }).ok) throw new Error('seed lot');
    const sup = window.__novaSupplierProvider.addSupplier({ name: 'مورد المرتجع' });
    const acct = window.NovaSupplierAccounts.createSupplierAccounts(localStorage, 'nova.supplierAccounts', {});
    acct.setSupplier(String(sup.id), { name: sup.name, termDays: 45 });
    acct.addInvoice({ id: 'INV-100', supplierId: String(sup.id), amount: 100 });
    return { key, name: p.name, sid: String(sup.id), sname: sup.name };
  });
  const onHand = () => page.evaluate(k => window.novaStock.lots(k).filter(l => l.lot === 'L1').reduce((s, l) => s + l.onHand, 0), seed.key);
  assert.equal(await onHand(), 10);
  await page.evaluate(() => { location.hash = '#receiving'; });
  const open = page.locator('[data-sret-open]');
  await open.waitFor();
  assert.match(await page.locator('.sret-list-sec').innerText(), /مفيش مرتجعات/);
  await open.click();
  const dlg = page.locator('#nova-sret-backdrop [role="dialog"]');
  await dlg.waitFor();
  await page.locator('#sret-supplier').selectOption(seed.sname);
  await page.locator('#sret-reason').selectOption('تالف أو مكسور');
  await page.locator('#sret-search').fill('6281001234567');
  await page.locator('#sret-search-res [data-sret-pick="0"]').click();
  const row = page.locator('#sret-lots-box .sret-lot-row', { hasText: 'L1' });
  await row.locator('[data-sret-qty]').fill('3');
  await row.locator('[data-sret-add]').click();
  assert.match(await page.locator('#sret-total').innerText(), /15\.00/);
  await page.locator('#sret-save').click();
  await page.locator('#sret-msg .sret-msg').waitFor();
  assert.equal(await page.locator('#sret-msg .sret-msg.ok').count(), 1, 'save failed: ' + await page.locator('#sret-msg').innerText());
  assert.match(await page.locator('#sret-msg').innerText(), /خصم 15\.00/);
  const r = await page.evaluate(({ key, sid }) => {
    const acct = window.NovaSupplierAccounts.createSupplierAccounts(localStorage, 'nova.supplierAccounts', {});
    const rec = window.novaSupplierReturns.list().pop();
    const led = window.NovaStockLedger.createLedger(localStorage, 'nova.stock.ledger').movements().filter(m => m.ref.startsWith(rec.id));
    const terms = JSON.parse(localStorage.getItem('nova.supplierAccounts')).suppliers[sid].termDays;
    return { rec, led, balance: acct.balance(sid), terms };
  }, seed);
  assert.equal(await onHand(), 7, 'lot L1 10 → 7');
  assert.equal(r.rec.total, 15); assert.equal(r.rec.reason, 'تالف أو مكسور'); assert.equal(r.rec.lines[0].qty, 3);
  assert.equal(r.led.length, 1); assert.equal(r.led[0].delta, -3);
  assert.equal(r.balance, 85, 'credit note 15 against invoice 100');
  assert.equal(r.terms, 45, 'existing supplier terms untouched');
  // slip prints; the print-only class is cleared so other prints are not blanked
  await page.locator('#sret-print-btn').click();
  assert.equal(await page.evaluate(() => window.__prints), 1);
  assert.equal(await page.evaluate(() => window.__printClass), true, 'slip-only print mode while printing');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.body.classList.contains('sret-printing')), false);
  // over-return is refused, stock unchanged
  await page.locator('#sret-search').fill('6281001234567');
  await page.locator('#sret-search-res [data-sret-pick="0"]').click();
  await row.locator('[data-sret-qty]').fill('8');
  await row.locator('[data-sret-add]').click();
  assert.match(await page.locator('#sret-msg').innerText(), /بين 1 و 7/);
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  assert.match(await page.locator('.sret-list-sec').innerText(), /مورد المرتجع/);
  // unknown supplier: return saved, no account credit
  const res2 = await page.evaluate(async k => (await window.novaSupplierReturns.save({ supplier: 'مورد مش متسجل', reason: 'منتهي الصلاحية', lines: [{ key: k, code: k, name: 'x', lot: 'L1', expiry: '2027-01-31', qty: 1, cost: 5 }] })).creditStatus, seed.key);
  assert.equal(res2, 'unmatched-supplier');
  assert.equal(await onHand(), 6);
  // the page stays responsive (no observer loop) after re-renders
  await page.evaluate(() => { location.hash = '#sale'; }); await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = '#receiving'; }); await page.locator('[data-sret-open]').waitFor();
  assert.equal(await page.locator('[data-sret-open]').count(), 1);
  assert.equal(await page.evaluate(() => 1 + 1), 2);
  assert.equal(native, 0, 'no native dialogs');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('supplier-return PASS');
} finally { await browser.close(); }
