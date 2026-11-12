// N10: export/import of the on-device sales ledger. Round trip, validation, confirmation, never overwrites.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'nova-backup-'));
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', acceptDownloads: true });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaSales, null, { timeout: 8000 });
const mk = (id, total, at) => ({ id, number: 'S-' + id, at, customer: 'c' + id, payment: 'cash', lines: [{ name: 'item ' + id, price: total, qty: 1, discount: 0 }], subtotal: total, discount: 0, vat: 0, total, received: total, change: 0 });
const A = mk('a1', 10, '2026-11-10T10:00:00.000Z'), B = mk('b2', 25.5, '2026-11-11T10:00:00.000Z');
const state = () => page.evaluate(() => ({ s: localStorage.getItem('nova-rx-sales-v1'), r: localStorage.getItem('nova-rx-returns-v1') }));
const openInvoices = async () => { await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(150); };
const importText = async (text, accept = true) => {
  const f = join(dir, 'in-' + Math.random().toString(36).slice(2) + '.json'); writeFileSync(f, text);
  let asked = 0; const h = async d => { asked++; await (accept ? d.accept() : d.dismiss()); }; page.on('dialog', h);
  await page.locator('#novaSalesImportFile').setInputFiles(f); await page.waitForTimeout(400); page.off('dialog', h);
  return { asked, msg: await page.locator('#novaBackupMsg').innerText().catch(() => '') };
};
await t('seed two sales and a return; Export downloads a JSON file with them', async () => {
  await page.evaluate(([a, b]) => { window.novaSales.add(a); window.novaSales.add(b); const s = window.novaSales.list().find(x => x.id === 'a1'); window.novaSales.addReturn(s, { 0: 1 }, 'test'); }, [A, B]);
  await openInvoices();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#novaSalesExport').click()]);
  assert.match(dl.suggestedFilename(), /^nova-rx-sales-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(dir, 'export.json'); await dl.saveAs(file);
  const d = JSON.parse(readFileSync(file, 'utf8')); assert.equal(d.format, 'nova-rx-sales-backup'); assert.equal(d.sales.length, 2); assert.equal(d.returns.length, 1);
  globalThis.exported = readFileSync(file, 'utf8'); globalThis.before = await state();
});
await t('round trip: wipe, import the export, ledger is identical', async () => {
  await page.evaluate(() => { localStorage.removeItem('nova-rx-sales-v1'); localStorage.removeItem('nova-rx-returns-v1'); });
  await openInvoices();
  const r = await importText(globalThis.exported); assert.equal(r.asked, 1);
  const after = await state();
  assert.deepEqual(JSON.parse(after.s), JSON.parse(globalThis.before.s)); assert.deepEqual(JSON.parse(after.r), JSON.parse(globalThis.before.r));
  assert.ok((await page.locator('body').innerText()).includes('S-b2'));
});
await t('importing the same file again changes nothing and does not even ask', async () => {
  const b = await state(); const r = await importText(globalThis.exported); assert.equal(r.asked, 0); assert.deepEqual(await state(), b);
});
await t('declining the confirmation changes nothing', async () => {
  await page.evaluate(() => { localStorage.removeItem('nova-rx-sales-v1'); localStorage.removeItem('nova-rx-returns-v1'); }); await openInvoices();
  const b = await state(); const r = await importText(globalThis.exported, false); assert.equal(r.asked, 1); assert.deepEqual(await state(), b); assert.equal(await page.evaluate(() => window.novaSales.list().length), 0);
});
await t('an existing sale with the same id is never overwritten', async () => {
  await page.evaluate(a => window.novaSales.add({ ...a, total: 999, customer: 'LOCAL' }), A);
  await importText(globalThis.exported);
  const l = await page.evaluate(() => window.novaSales.list()); assert.equal(l.length, 2); const a = l.find(x => x.id === 'a1'); assert.equal(a.total, 999); assert.equal(a.customer, 'LOCAL');
});
await t('invalid files are rejected with nothing changed: not JSON, wrong format, bad sale, orphan return', async () => {
  const good = JSON.parse(globalThis.exported); const b = await state();
  const bad = [
    'not json', JSON.stringify({ hello: 1 }),
    JSON.stringify({ ...good, sales: [{ ...mk('z9', 5, '2026-11-11T10:00:00.000Z'), total: 'lots' }] }),
    JSON.stringify({ ...good, sales: [{ ...mk('z9', 5, '2026-11-11T10:00:00.000Z'), lines: [{ name: 'x', price: 1, qty: -2 }] }] }),
    JSON.stringify({ ...good, sales: [mk('z9', 5, '2026-11-11T10:00:00.000Z')], returns: [{ ...good.returns[0], id: 'rr', saleId: 'nope' }] }),
    JSON.stringify({ ...good, sales: [mk('z9', 5, 'garbage')] }),
  ];
  for (const text of bad) { const r = await importText(text); assert.equal(r.asked, 0, text.slice(0, 40)); assert.ok(r.msg.includes('لم يتغير شيء'), r.msg); assert.deepEqual(await state(), b); }
});
await t('a quota failure while importing leaves the old data intact', async () => {
  await page.evaluate(() => { localStorage.removeItem('nova-rx-returns-v1'); }); const b = await state();
  const ok = await page.evaluate(text => { const p = window.novaSales.parseBackup(text); const o = Storage.prototype.setItem; let n = 0; Storage.prototype.setItem = function (k, v) { if (++n === 2) throw new Error('quota'); return o.call(this, k, v); }; try { return window.novaSales.applyBackup({ ...p, newSales: [...p.newSales, { id: 'zz', number: 'S-zz', at: '2026-11-12T00:00:00.000Z', total: 1, lines: [{ name: 'q', price: 1, qty: 1 }] }] }); } finally { Storage.prototype.setItem = o; } }, globalThis.exported);
  assert.equal(ok.ok, false); assert.deepEqual(await state(), b);
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui sales backup:', n, 'cases'); await browser.close();
