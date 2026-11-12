// N05: Products tab shows validated packaging (read-only) from the catalog packaging link; missing/invalid -> a dash. Isolated: endpoint answered by the test.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snap = JSON.parse(readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8'));
const items = snap.items.slice(0, 120).map(r => ({ ...r }));
items[0].packaging = { unitsPerStrip: 10, stripsPerBox: 3 };
items[1].packaging = { unitsPerBox: 24 };
items[2].packaging = { unitsPerStrip: 10, stripsPerBox: 3, unitsPerBox: 99 }; // inconsistent
items[3].packaging = { unitsPerBox: -4 };                                   // invalid
items[4].packaging = { unitsPerBox: '<img src=x onerror=window.__xss=1>' }; // hostile
const names = items.slice(0, 6).map(r => r.namear || r.name || r.nameen);
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
const cells = () => page.locator('#novaRows tr').evaluateAll(trs => trs.slice(0, 6).map(tr => tr.querySelector('td[data-pack]').innerText));
await t('packaging column header is present', async () => assert.ok((await page.locator('.nova-data-table th').allInnerTexts()).includes('العبوة')));
await t('strip x strips and unitsPerBox are shown', async () => {
  const c = await cells();
  assert.ok(c[0].includes('العلبة 30') && c[0].includes('الشريط 10'), c[0]);
  assert.ok(c[1].includes('العلبة 24'), c[1]);
});
await t('inconsistent, invalid, hostile and missing packaging fall back to a dash', async () => {
  const c = await cells();
  for (const i of [2, 3, 4, 5]) assert.equal(c[i], '—', `row ${i}: ${c[i]}`);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});
await t('no page errors', async () => assert.deepEqual(errors, []));
await browser.close(); console.log(`${n} checks passed`);
