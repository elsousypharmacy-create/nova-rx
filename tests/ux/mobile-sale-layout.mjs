// UX10: mobile sale layout at 390x844 — no overlap of toast/FAB/discount/totals/checkout, no clipped table, suggestion tappable.
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
const box = async sel => { const l = page.locator(sel).first(); if (!(await l.count())) return null; return l.boundingBox(); };
const hit = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// customer suggestion tappable (customer gate is first)
const search = page.locator('#mainSearchInput');
await search.fill('a');
const sug = page.locator('.suggestion-item').first();
if (await sug.count()) { await sug.click({ timeout: 3000 }); } else { await search.press('Enter'); }
// add an item
await search.fill('30');
await page.locator('.suggestion-item').first().waitFor({ timeout: 5000 });
await page.locator('.suggestion-item').first().click({ timeout: 3000 });
await page.locator('table.invoice-table tbody tr[data-id]').first().waitFor();
// trigger a toast
await page.evaluate(() => { try { showToast('تم إضافة الصنف', 'info'); } catch (e) {} });
await page.locator('.toast').first().waitFor({ timeout: 2000 }).catch(() => {});

const rects = {
  toast: await box('.toast'), fab: await box('#novaAiLaunch'), disc: await box('#inputPercentDiscount'),
  total: await box('#displayGrandTotal'), pay: await box('#btnCheckout'),
};
const fabVisible = await page.locator('#novaAiLaunch').isVisible();
const names = Object.keys(rects).filter(k => rects[k] && !(k === 'fab' && !fabVisible));
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
  assert.ok(!hit(rects[names[i]], rects[names[j]]), `${names[i]} overlaps ${names[j]}: ${JSON.stringify(rects[names[i]])} ${JSON.stringify(rects[names[j]])}`);

// no table element clipped past the viewport horizontally
const clipped = await page.evaluate(() => [...document.querySelectorAll('table.invoice-table *')].filter(e => {
  const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
  return r.left < -0.5 || r.right > innerWidth + 0.5;
}).map(e => e.tagName + '.' + e.className));
assert.deepEqual(clipped, [], 'clipped elements');
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page horizontal overflow');
assert.deepEqual(errors, []);
console.log('  ok mobile-sale-layout');
await browser.close();
