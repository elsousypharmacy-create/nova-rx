// UX44: mobile sale totals at 390x844 — no overlap, no clipped text, collapsible discount, sticky >=48px pay button.
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
const s0 = page.locator('.suggestion-item').first();
if (await s0.count()) await s0.click({ timeout: 3000 }).catch(() => {}); else await search.press('Enter');
const rows = page.locator('table.invoice-table tbody tr[data-id]');
for (const q of ['30', '20', '10', '40', '50', '60', '15']) {
  if (await rows.count() >= 2) break;
  await search.fill(q);
  const s = page.locator('.suggestion-item').first();
  await s.waitFor({ timeout: 3000 }).catch(() => {});
  if (await s.count()) await s.click({ timeout: 3000 }).catch(() => {});
}
assert.ok(await rows.count() >= 2, 'need 2 cart lines');

// discount inputs live in a collapsible row inside the totals block
const toggle = page.locator('.totals-breakdown .discount-toggle');
assert.equal(await toggle.count(), 1, 'discount toggle inside totals block');
assert.ok(await page.evaluate(() => !!document.querySelector('.totals-breakdown #inputPercentDiscount')), 'discount inputs inside totals block');
assert.equal(await page.locator('#inputPercentDiscount').isVisible(), false, 'discount collapsed by default');
const tb = await toggle.boundingBox(); assert.ok(tb.height >= 44, 'toggle height ' + tb.height);
await toggle.click();
assert.equal(await page.locator('#inputPercentDiscount').isVisible(), true, 'discount expands');
await toggle.click();
assert.equal(await page.locator('#inputPercentDiscount').isVisible(), false, 'discount collapses');

async function checkTotals(label) {
  const res = await page.evaluate(() => {
    const root = document.querySelector('.totals-breakdown');
    const els = [...root.querySelectorAll('.tot-row, .tot-row > span, .discount-toggle, .discount-inputs, #discountHint')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const rect = e => e.getBoundingClientRect();
    const leaves = els.filter(e => !els.some(o => o !== e && e.contains(o) && !o.contains(e) && false));
    const overlaps = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
      const x = rect(a), y = rect(b);
      if (x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5) overlaps.push((a.id || a.className) + ' x ' + (b.id || b.className));
    }
    const clipped = [...root.querySelectorAll('*')].filter(e => { const r = rect(e); return r.width > 0 && (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' || r.left < -0.5 || r.right > innerWidth + 0.5); }).map(e => e.id || e.className);
    const pay = rect(document.querySelector('#btnCheckout'));
    const rr = root.getBoundingClientRect(); const vat = document.querySelector('#displayVat').getBoundingClientRect();
    return { overlaps, clipped, payH: pay.height, vatOk: vat.left >= 0 && vat.right <= innerWidth && vat.height > 8 };
  });
  assert.deepEqual(res.overlaps, [], label + ' overlaps');
  assert.deepEqual(res.clipped, [], label + ' clipped');
  assert.ok(res.vatOk, label + ' VAT value visible');
  assert.ok(res.payH >= 48, label + ' pay height ' + res.payH);
}
await checkTotals('collapsed');
await toggle.click(); await checkTotals('expanded'); await toggle.click();

// pay bar sticky and does not cover last cart row at scroll end
await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); document.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; }); });
await page.waitForTimeout(200);
const g = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('table.invoice-table tbody tr[data-id]')]; const last = trs[trs.length - 1].getBoundingClientRect();
  const pay = document.querySelector('#btnCheckout').getBoundingClientRect();
  return { lastBottom: last.bottom, payTop: pay.top, payBottom: pay.bottom, vh: innerHeight };
});
assert.ok(g.payBottom <= g.vh + 1, 'pay button within viewport ' + JSON.stringify(g));
assert.ok(g.lastBottom <= g.payTop + 0.5, 'pay bar covers last cart row ' + JSON.stringify(g));
assert.deepEqual(errors, []);
console.log('  ok mobile-totals');
await browser.close();
