// UX228: per-invoice return history (date/items/qty/amount/method/reason) + reasons breakdown in Reports; XSS-safe; empty state.
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
await page.evaluate(() => {
  const mk = (id, pay) => ({ id, number: 'S-' + id, at: new Date().toISOString(), customer: 'x', payment: pay, lines: [{ name: 'A', barcode: '', price: 100, qty: 5, discount: 0 }, { name: '<img src=x onerror=window.__xss=1>', barcode: '', price: 50, qty: 2, discount: 0 }], subtotal: 600, discount: 0, vat: 0, total: 600, received: 600, change: 0, source: 'STOCK LIVE' });
  window.novaSales.add(mk('s1', 'cash')); window.novaSales.add(mk('s2', 'card'));
});
await t('empty state: no return history and reasons panel says none', async () => {
  await page.locator('.nova-tab[data-page=invoices]').click();
  assert.equal(await page.locator('[data-ret-history]').count(), 0);
  await page.locator('.nova-tab[data-page=reports]').click();
  assert.equal(await page.locator('#novaRetReasons [data-ret-reasons-empty]').count(), 1);
});
await t('seed returns (incl. XSS reason) via the real ledger', async () => {
  const r = await page.evaluate(() => { const s = id => window.novaSales.list().find(x => x.id === id);
    return [window.novaSales.addReturn(s('s1'), { 0: 1 }, 'عيب/تالف').ok, window.novaSales.addReturn(s('s1'), { 0: 1, 1: 1 }, 'خطأ في الصرف').ok,
      window.novaSales.addReturn(s('s2'), { 0: 2 }, '<img src=x onerror=window.__xss=1>').ok, window.novaSales.addReturn(s('s2'), { 1: 1 }, 'عيب/تالف').ok]; });
  assert.deepEqual(r, [true, true, true, true]);
});
await t('Invoices: expandable per-invoice history shows items, qty, amount, method, reason', async () => {
  await page.locator('.nova-tab[data-page=invoices]').click();
  const d1 = page.locator('[data-ret-history="s1"]'); assert.equal(await d1.count(), 1);
  assert.equal(await d1.locator('[data-ret-entry]').count(), 2);
  await d1.locator('summary').click();
  const txt = await d1.innerText();
  for (const w of ['عيب/تالف', 'خطأ في الصرف', 'A ×1', '100.00', 'نقدي']) assert.ok(txt.includes(w), 'missing ' + w);
  assert.equal(await d1.locator('[data-ret-method]').first().innerText(), 'نقدي');
  assert.equal(await page.locator('[data-ret-history="s2"] [data-ret-method]').first().evaluate(e => e.textContent), 'بطاقة');
  assert.ok(/[0-9]/.test(await d1.locator('[data-ret-entry] span[dir=ltr]').first().innerText()), 'date shown');
});
await t('XSS-safe: hostile item name and reason render as text, no script ran, no injected nodes', async () => {
  assert.equal(await page.locator('[data-ret-history] img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  const txt = await page.locator('[data-ret-history="s2"]').evaluate(e => e.textContent);
  assert.ok(txt.includes('<img src=x onerror=window.__xss=1>'));
});
await t('Reports: reasons breakdown with counts/amounts; unknown reason grouped as other', async () => {
  await page.locator('.nova-tab[data-page=reports]').click();
  const row = k => page.locator('#novaRetReasons [data-ret-reason-row="' + k + '"]');
  assert.equal(await row('عيب/تالف').getAttribute('data-count'), '2');
  assert.equal(await row('عيب/تالف').getAttribute('data-amount'), '150.00'); // 100 + 50
  assert.equal(await row('خطأ في الصرف').getAttribute('data-count'), '1');
  assert.equal(await row('other').getAttribute('data-count'), '1');
  assert.equal(await page.locator('#novaRetReasons img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});
assert.deepEqual(errors, []);
console.log('PASS ' + n + ' checks'); await browser.close();
