// UX33: mobile cart compact rows + nav tab strip at 390x844.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', hasTouch: true });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
const search = page.locator('#mainSearchInput');
await search.fill('a');
const sug0 = page.locator('.suggestion-item').first();
if (await sug0.count()) await sug0.click({ timeout: 3000 }); else await search.press('Enter');
for (const q of ['30', '20', '10', '40', '50', '60', '15']) {
  if (await page.locator('table.invoice-table tbody tr[data-id]').count() >= 5) break;
  await search.fill(q);
  const s = page.locator('.suggestion-item').first();
  if (await s.count() === 0) await s.waitFor({ timeout: 3000 }).catch(() => {});
  if (await s.count()) await s.click({ timeout: 3000 }).catch(() => {});
}
const rows = page.locator('table.invoice-table tbody tr[data-id]');
assert.ok(await rows.count() >= 5, 'need 5 distinct cart lines, got ' + await rows.count());
const payTop = (await page.locator('#btnCheckout').boundingBox()).y;
const info = await rows.evaluateAll(trs => trs.map(t => { const r = t.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; }));
for (const r of info) assert.ok(r.h <= 96.5, 'row height ' + r.h);
const visible = info.filter(r => r.top >= 0 && r.bottom <= payTop + 1).length;
assert.ok(visible >= 4, 'visible rows above pay bar: ' + visible + ' payTop=' + payTop);
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
// discount hidden when 0
assert.equal(await page.locator('table.invoice-table td.col-disc.no-disc').first().isVisible(), false, 'zero discount visible');
// tap targets in rows
const small = await page.locator('table.invoice-table tbody tr[data-id]').first().locator('button,select,input').evaluateAll(els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5); }).map(e => e.className + ' ' + e.getBoundingClientRect().width + 'x' + e.getBoundingClientRect().height));
assert.deepEqual(small, [], 'small tap targets');
// nav: activate the last tab, it must be fully inside the strip
const tabs = page.locator('.nova-nav .nova-tab');
const n = await tabs.count();
for (const idx of [n - 1, 0]) {
  await tabs.nth(idx).scrollIntoViewIfNeeded();
  await tabs.nth(idx).click();
  await page.waitForTimeout(400);
  const ok = await page.evaluate(() => { const nav = document.querySelector('.nova-nav'), a = nav.querySelector('.nova-tab.active'); if (!a) return 'no active'; const nr = nav.getBoundingClientRect(), r = a.getBoundingClientRect(); return r.left >= nr.left - 0.5 && r.right <= nr.right + 0.5 && r.height >= 43.5 ? true : JSON.stringify({ nr, r }); });
  assert.equal(ok, true, 'active tab not fully visible: ' + ok);
}
assert.deepEqual(errors, []);
console.log('  ok mobile-cart');
await browser.close();
