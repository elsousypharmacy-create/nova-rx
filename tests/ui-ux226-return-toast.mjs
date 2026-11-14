// UX226: visible confirmation after a return (role=status with amount + refund method), row highlight, 10s undo.
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
await page.evaluate(() => { const mk = (id, pay) => ({ id, number: 'S-' + id, at: new Date().toISOString(), customer: 'x', payment: pay, lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0 });
  window.novaSales.add(mk('c1', 'cash')); window.novaSales.add(mk('k1', 'card')); });
const doReturn = async (id, qty) => { await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator(`[data-return="${id}"]`).click();
  await page.locator('[data-ret-idx="0"]').fill(String(qty)); await page.locator('#novaRetReason').fill('طلب العميل'); await page.locator('#novaRetOk').click(); };
await t('cash return: role=status toast has amount + cash method, row highlighted', async () => {
  await doReturn('c1', 1);
  const st = page.locator('#novaRetToast[role=status]'); await st.waitFor({ timeout: 2000 });
  const txt = await st.innerText(); assert.ok(txt.includes('تم تسجيل مرتجع بقيمة') && txt.includes('100.00') && txt.includes('نقدًا'), txt);
  assert.equal(await page.locator('tr[data-ret-flash]').count(), 1);
});
await t('card return toast names the card method', async () => {
  await doReturn('k1', 1);
  const txt = await page.locator('#novaRetToast[role=status]').innerText(); assert.ok(txt.includes('100.00') && txt.includes('البطاقة'), txt);
});
await t('undo removes only the just-saved return from the ledger', async () => {
  assert.equal(await page.evaluate(() => window.novaSales.returns().length), 2);
  await page.locator('[data-ret-undo]').click();
  const r = await page.evaluate(() => window.novaSales.returns().map(x => x.saleId)); assert.deepEqual(r, ['c1']);
  assert.ok((await page.locator('#novaRetToast').innerText()).includes('تم التراجع'));
});
await t('reduced motion: highlight is static (no animation), still marked', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await doReturn('c1', 1);
  assert.equal(await page.locator('tr[data-ret-flash]').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('tr[data-ret-flash]').getAnimations().length), 0);
});
await t('toast disappears after 10s', async () => { await page.waitForTimeout(10300); assert.equal(await page.locator('#novaRetToast').count(), 0); });
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui ux226:', n, 'cases'); await browser.close();
