// UX84: suggestions must not render "null"/"منخفض" when stock is unknown; numeric stock < 30 keeps low badge.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage();
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: 'offline' }));
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.NOVA_DEMO && window.novaSearch);
await page.evaluate(() => {
  const mk = (id, bc, name, stock) => ({ id, barcode: bc, name, generic: 'x', strength: '1 مجم', pack: '1', form: '1', price: 10, stock, category: 'T' });
  window.NOVA_DEMO.products.push(
    mk('U1', '9990000000011', 'زيدكسنول نولستوك', null),
    mk('U2', '9990000000012', 'زيدكسنول أندفايند', undefined),
    mk('U3', '9990000000013', 'زيدكسنول نان', NaN),
    mk('U4', '9990000000014', 'زيدكسنول لو', 5),
    mk('U5', '9990000000015', 'زيدكسنول هاي', 500));
  window.novaSearch.rebuild();
});
await page.locator('#mainSearchInput').fill('زيدكسنول');
await page.waitForFunction(() => document.querySelectorAll('#suggestionsBox .su').length >= 5, null, { timeout: 5000 });
const rows = await page.$$eval('#suggestionsBox .suggestion-item', els => els.map(e => ({ t: e.innerText, su: e.querySelector('.su') ? e.querySelector('.su').innerText : '' })));
const byName = n => rows.find(r => r.t.includes(n));
for (const n of ['نولستوك', 'أندفايند', 'نان']) {
  const r = byName(n); assert.ok(r, n);
  assert.ok(!/null|undefined|NaN/.test(r.t), `${n} has null text: ${r.t}`);
  assert.ok(!r.t.includes('منخفض'), `${n} shows low`);
}
assert.ok(byName('لو').su.includes('منخفض'), 'numeric 5 keeps low badge');
assert.ok(byName('لو').su.includes('5'));
assert.ok(!byName('هاي').su.includes('منخفض'), '500 not low');
console.log('ok ui-ux84-unknown-stock');
await browser.close();
