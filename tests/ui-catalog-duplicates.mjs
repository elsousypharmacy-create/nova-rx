// N21 CAT-01: Products tab flags likely duplicates (same barcode, or same normalized name+pack) for review; no merge. Isolated: endpoint answered by the test.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snap = JSON.parse(readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8'));
const items = snap.items.slice(0, 120).map((r, i) => ({ ...r, code: String(900000 + i), gtin: String(7000000000000 + i), namear: 'صنف فريد رقم ' + i, nameen: '', packaging: undefined }));
items[1].gtin = items[0].gtin;                                         // same barcode
items[11] = { ...items[11], namear: 'Panadol 500 mg tablets', packaging: { unitsPerBox: 24 } };
items[12] = { ...items[12], namear: 'PANADOL  500mg Tablets', packaging: { unitsPerBox: 24 } }; // same name+pack
items[13] = { ...items[13], namear: 'Panadol 500 mg tablets', packaging: { unitsPerBox: 48 } }; // other pack: not a duplicate
items[14] = { ...items[14], namear: 'Panadol 250 mg tablets', packaging: { unitsPerBox: 24 } }; // other strength: not a duplicate
items[20] = { ...items[20], namear: '<img src=x onerror=window.__xss=1>' }; items[21] = { ...items[20], code: '900999', gtin: '7000000000999' };
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exportedAt: snap.exportedAt, items }) }));
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
await page.locator('.nova-tab[data-page=products]').click();
await t('exactly the 3 expected groups are flagged (barcode, name+pack, hostile name)', async () => {
  const g = await page.evaluate(() => window.novaDuplicates(window.NOVA_DEMO.products).map(x => x.reason + ':' + x.items.length));
  assert.deepEqual(g.sort(), ['barcode:2', 'name:2', 'name:2']);
});
await t('review panel lists the groups and says nothing is merged', async () => {
  assert.equal(await page.locator('#novaDupes [data-dupe-group]').count(), 3);
  assert.ok((await page.locator('#novaDupes').textContent()).includes('لا يتم دمج'));
});
await t('hostile name is escaped and nothing is merged or removed', async () => {
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.evaluate(() => window.NOVA_DEMO.products.length), items.length);
});
await t('no duplicates, no panel', async () => {
  const c = await page.evaluate(() => window.novaDuplicates([{ name: 'A', barcode: '1', pack: '' }, { name: 'B', barcode: '', pack: '' }, { name: 'C', barcode: '', pack: '' }]).length);
  assert.equal(c, 0);
});
await t('no page errors', async () => assert.deepEqual(errors, []));
await browser.close(); console.log(`${n} checks passed`);
