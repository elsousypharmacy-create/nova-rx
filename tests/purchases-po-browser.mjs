// N29: local PO + receiving UI. No network (all requests aborted except the local server).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_PO_URL || 'http://127.0.0.1:8766/';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const external = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(BASE) || u.startsWith('data:')) return r.continue(); if (!/fonts\.g/.test(u)) external.push(u); return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
  let confirms = 0; page.on('dialog', d => { confirms++; d.accept(); });
  await page.goto(BASE + 'purchases.html'); await page.locator('#openPo').click();
  await page.fill('#poSupplier', 'MOCK'); await page.fill('#poLines', 'A1,10,20,Panadol');
  await page.locator('#poCreate').click();
  assert.equal(await page.locator('[data-po=PO-1]').getAttribute('data-state'), 'draft');
  await page.locator('[data-po=PO-1] button', { hasText: 'إرسال' }).click();
  assert.equal(await page.locator('[data-po=PO-1]').getAttribute('data-state'), 'sent');
  assert.equal(await page.evaluate(() => window.novaPurchaseOrders.ledger.movements().length), 0);
  await page.locator('[data-po=PO-1] button', { hasText: 'قبول' }).click();
  await page.fill('#grnPo', 'PO-1'); await page.fill('#grnRef', 'G1'); await page.fill('#grnLines', 'A1,LOT9,2028-05-31,4,25');
  await page.fill('#grnInvoice', 'A1,4'); await page.locator('#grnSave').click();
  assert.equal(await page.locator('[data-po=PO-1]').getAttribute('data-state'), 'partial');
  assert.ok((await page.locator('[data-po=PO-1]').innerText()).includes('التكلفة تختلف'));
  const m = await page.evaluate(() => window.novaPurchaseOrders.ledger.lots('A1')[0]);
  assert.deepEqual([m.lot, m.expiry, m.cost, m.qty], ['LOT9', '2028-05-31', 25, 4]);
  assert.ok(confirms >= 3, 'every state change asked for confirmation');
  await page.fill('#grnRef', 'G2'); await page.fill('#grnLines', 'A1,LOT9,bad-date,6,20'); await page.locator('#grnSave').click();
  assert.ok((await page.locator('#poStatus').innerText()).includes('تاريخ الصلاحية'));
  assert.equal(await page.evaluate(() => window.novaPurchaseOrders.ledger.onHand('A1')), 4);
  assert.deepEqual(errors, []); assert.deepEqual(external, [], 'no external request');
  console.log('purchases-po-browser: all checks passed');
} finally { await browser.close(); }
