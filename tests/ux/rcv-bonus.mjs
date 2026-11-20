// RCV-BONUS (#78): supplier bonus on receiving — 10 + 1 at 10 → stock +11, invoice total 100, unit cost 9.0909.
// Lines without bonus keep today's shape. Fake/local data; non-GET and external requests blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(BASE) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  let confirmMsg = ''; page.on('dialog', d => { confirmMsg = d.message(); d.accept(); });
  await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  const pickQuery = () => page.evaluate(() => { for (const q of ['6281001234567', 'panadol', 'بانادول', 'a', 'ا']) { const p = window.novaSearch.search(q, 1)[0]; if (p && p.barcode && window.novaSearch.search(p.barcode, 1)[0]) return p.barcode; } return null; });
  const Q = await pickQuery(); assert.ok(Q, 'a searchable product with a barcode');
  await page.evaluate(() => { location.hash = '#receiving'; });
  await page.locator('[data-rcv=new]:visible').click();
  await page.locator('#rcvSup').selectOption({ index: 1 });
  await page.locator('#rcvInv').fill('BON-1');
  const pickItem = async row => {
    await row.locator('[data-f=q]').fill(Q);
    const p = row.locator('[data-pick]').first(); await p.waitFor({ timeout: 5000 }); await p.click();
  };
  const row = page.locator('.rcv-line').nth(0);
  await pickItem(row);
  const key = await page.evaluate(Q => {
    const p = window.novaSearch.search(Q, 1)[0]; return window.novaStock.keyOf(p);
  }, Q);
  const onHand = () => page.evaluate(k => window.novaStock.lots(k).reduce((s, l) => s + l.onHand, 0), key);
  const before = await onHand();
  await row.locator('[data-f=qty]').fill('10');
  await row.locator('[data-f=bonus]').fill('1');
  await row.locator('[data-f=cost]').fill('10');
  await row.locator('[data-f=exp]').fill('11/35');
  assert.match(await row.locator('[data-lt]').textContent(), /100\.00/, 'line total = paid × price');
  const sumText = await page.locator('#rcvSum').textContent();
  assert.match(sumText, /11 علبة/); assert.match(sumText, /100\.00/);
  // invalid bonus blocks the confirm button
  await row.locator('[data-f=bonus]').fill('101');
  assert.ok(await page.locator('#rcvOk').isDisabled(), 'bonus > 10 × qty is rejected');
  assert.match(await page.locator('#rcvMissing').textContent(), /البونص/);
  await row.locator('[data-f=bonus]').fill('1');
  // second line without bonus keeps today's line shape
  await page.locator('[data-rcv-add]').click();
  const row2 = page.locator('.rcv-line').nth(1);
  await pickItem(row2);
  await row2.locator('[data-f=qty]').fill('2'); await row2.locator('[data-f=cost]').fill('5'); await row2.locator('[data-f=exp]').fill('12/35'); await row2.locator('[data-f=lot]').fill('L2');
  await page.locator('#rcvOk').click();
  await page.locator('#rcvForm').waitFor({ state: 'detached' });
  assert.match(confirmMsg, /12 \+ 1 بونص = 13 علبة/, confirmMsg);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-receipts-v1')).find(r => r.invoice === 'BON-1'));
  assert.equal(rec.pending, false);
  const [l1, l2] = rec.lines;
  assert.equal(l1.qty, 11); assert.equal(l1.paidQty, 10); assert.equal(l1.bonus, 1); assert.equal(l1.invoiceCost, 10); assert.equal(l1.cost, 9.0909);
  assert.deepEqual(Object.keys(l2).sort(), ['autoLot', 'code', 'cost', 'expiry', 'key', 'lot', 'name', 'qty'], 'no-bonus line unchanged');
  assert.equal(await onHand(), before + 13, 'stock +11 (bonus line) +2');
  const hist = page.locator('#rcv-' + rec.id);
  assert.match(await hist.locator('summary').textContent(), /110\.00/, 'receipt total 100 + 10, bonus is free');
  await hist.locator('summary').click();
  assert.match(await hist.locator('.rcv-lines').textContent(), /10 \+ 1 بونص/);
  assert.deepEqual(errors, [], 'no page errors');
  console.log('rcv-bonus PASS');
} finally { await browser.close(); }
