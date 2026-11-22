// UX66: undo for delete-line, clear-invoice (F4) and held-invoice delete.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_UX_URL || 'http://127.0.0.1:8766/';
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  const page = await ctx.newPage(), errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('s')) { localStorage.clear(); sessionStorage.setItem('s', '1'); } localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source && window.NOVA_DEMO && window.NOVA_DEMO.products.length);
  const prods = await page.evaluate(() => window.NOVA_DEMO.products.filter(p => p && p.barcode && p.price > 0).slice(0, 2).map(p => p.barcode));
  const search = page.locator('#mainSearchInput');
  const add = async (code, extra = '') => { await search.fill(code + extra); await page.keyboard.press('Enter'); };
  const rows = () => page.locator('#invoiceTableBody tr').count();
  const qtys = () => page.evaluate(() => [...document.querySelectorAll('#invoiceTableBody .qty-input')].map(i => i.value));
  await add(prods[0]); await add(prods[1]);
  await page.locator('#invoiceTableBody [data-act="inc"]').first().click();
  assert.equal(await rows(), 2);
  const before = await qtys();
  // F4 clear -> in-app dialog (AUDIT-02) -> undo button
  const clearDlg = () => page.locator('#novaInvoiceActionDialog button[data-action="clear"]').click();
  await search.press('F4'); await clearDlg();
  assert.equal(await rows(), 0);
  await page.locator('#btnUndoToast').click();
  assert.equal(await rows(), 2);
  assert.deepEqual(await qtys(), before);
  // delete one line, Ctrl+Z
  await page.locator('#invoiceTableBody [data-act="del"]').first().click();
  assert.equal(await rows(), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await rows(), 2);
  assert.deepEqual(await qtys(), before);
  // expires after 7s
  await search.press('F4'); await clearDlg();
  assert.equal(await rows(), 0);
  await page.waitForTimeout(7000);
  assert.equal(await page.locator('#btnUndoToast').count(), 0, 'undo button gone');
  await page.keyboard.press('Control+z');
  assert.equal(await rows(), 0, 'Ctrl+Z after expiry does nothing');
  // held invoice delete: no native dialog, undo restores
  await add(prods[0]);
  await page.locator('#holdCurrentInvoice').click();
  // UI-BATCH1: on desktop (1280) the sale rail is the one held list; its «حذف» delegates to the app's delete (same undo)
  const railDel = page.locator('.nova-rail-held [data-rail-delete]');
  assert.equal(await railDel.count(), 1);
  await railDel.click();
  assert.equal(await page.locator('[data-held-delete]').count(), 0);
  assert.equal(await railDel.count(), 0);
  await page.locator('#btnUndoToast').click();
  assert.equal(await page.locator('[data-held-delete]').count(), 1, 'held invoice restored');
  assert.equal(await railDel.count(), 1, 'held invoice restored in the rail');
  assert.equal(dialogs.length, 0, 'no native dialogs: F4 asks in-app (AUDIT-02); line/held deletions do not ask');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.deepEqual(errors, []);
  console.log('undo-cart passed');
} finally { await browser.close(); }
