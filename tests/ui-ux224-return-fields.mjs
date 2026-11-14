// UX224: return dialog cancel-invoice fields share one style, every input has an accessible name.
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
await page.evaluate(() => window.novaSales.add({ id: 'u1', number: 'S-u1', at: new Date().toISOString(), customer: 'x', payment: 'cash', lines: [{ name: 'بنادول', barcode: '', price: 10, qty: 2, discount: 0 }, { name: 'فيتامين', barcode: '', price: 5, qty: 1, discount: 0 }], subtotal: 25, discount: 0, vat: 0, total: 25, received: 25, change: 0 }));
await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator('[data-return="u1"]').click();
await page.locator('#novaCancelBox > summary').click();
const st = id => page.locator(id).evaluate(e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderTopColor].join('|'); });
await t('cancel fields share the #novaRetReason style', async () => {
  const ref = await st('#novaRetReason');
  for (const id of ['#novaCxBy', '#novaCxRole', '#novaCxApprover', '[data-ret-idx="0"]']) assert.equal(await st(id), ref, id);
});
await t('reason label bound via for=', async () => assert.equal(await page.locator('label[for="novaRetReason"]').count(), 1));
await t('cancel inputs have real <label for>', async () => { for (const id of ['novaCxBy', 'novaCxRole', 'novaCxApprover']) assert.equal(await page.locator(`label[for="${id}"]`).count(), 1, id); });
await t('qty inputs have aria-label with product name', async () => {
  assert.ok((await page.locator('[data-ret-idx="0"]').getAttribute('aria-label')).includes('بنادول'));
  assert.ok((await page.locator('[data-ret-idx="1"]').getAttribute('aria-label')).includes('فيتامين'));
});
await t('every dialog input/select has an accessible name', async () => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('.nova-return-overlay [role=dialog] input,.nova-return-overlay [role=dialog] select')].filter(e => !(e.getAttribute('aria-label') || (e.labels && e.labels.length))).map(e => e.id || e.name));
  assert.deepEqual(bad, []);
});
await t('summary chevron rotates open vs closed', async () => {
  const tf = () => page.locator('#novaCancelBox > summary').evaluate(e => getComputedStyle(e, '::before').transform);
  const open = await tf(); await page.locator('#novaCancelBox > summary').click(); const closed = await tf(); assert.notEqual(open, closed);
  await page.locator('#novaCancelBox > summary').click();
});
await t('confirm-cancel button has danger tone', async () => {const c=await page.locator('#novaCxOk').evaluate(e => getComputedStyle(e).backgroundColor); assert.equal(c, 'rgb(58, 21, 18)', c)});
await t('cancel flow still works (rejects without approver)', async () => { await page.locator('#novaCxOk').click(); assert.ok((await page.locator('#novaRetMsg').innerText()).length > 0); });
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui ux224:', n, 'cases'); await browser.close();
