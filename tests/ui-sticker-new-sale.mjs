// Regression (#77, safety): after a completed sale, a NEW sale must never show the previous invoice's medicines in the sticker screen.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!document.getElementById('mainSearchInput') && !!window.NOVA_DEMO, null, { timeout: 10000 });
await page.waitForTimeout(300);
const add = name => page.evaluate(n => {
  const i = document.getElementById('mainSearchInput'); i.value = n;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return document.querySelectorAll('#invoiceTableBody tr').length;
}, name);
const click = id => page.evaluate(i => document.getElementById(i).click(), id);
const cards = () => page.evaluate(() => [...document.querySelectorAll('#nlMedicineList .med-card .med-sum')].map(e => e.innerText).join(' | '));
const openStickers = async () => { await click('novaAiLaunch'); await page.waitForTimeout(600); };
const PREV = /Augmentin|أوجمنتين/, NEXT = /Concor|كونكور/;

await t('sale 1: Augmentin sold, receipt shown', async () => {
  assert.equal(await add('Augmentin'), 1);
  await click('btnCheckout'); await page.waitForTimeout(300);
  await click('btnConfirmPayment'); await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => document.getElementById('receiptModal').classList.contains('active')));
});
await t('stickers of the finished sale do show Augmentin (control: the screen is populated)', async () => {
  await openStickers();
  assert.match(await cards(), PREV);
});
await page.evaluate(() => document.getElementById('novaLabelsPanel').classList.remove('open'));
await click('btnReceiptNewSale'); await page.waitForTimeout(300);
// NOTE: opening stickers in a new sale with an EMPTY cart is not asserted: #77 covers a new cart with items.
await t('new sale with Concor: stickers show only Concor, never Augmentin', async () => {
  assert.equal(await add('Concor'), 1);
  await openStickers();
  const c = await cards();
  assert.match(c, NEXT); assert.doesNotMatch(c, PREV);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#nlMedicineList .med-card').length), 1);
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log(`PASS ${n} checks`);
await browser.close();
