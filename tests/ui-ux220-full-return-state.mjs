// UX220: fully returned / cancelled invoices show a badge, a disabled row button, and a dialog with nothing actionable.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let n = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  await page.evaluate(() => {
    for (const id of ['n', 'p', 'f', 'x']) window.novaSales.add({ id, number: 'S-' + id, at: new Date().toISOString(), customer: '', payment: 'cash', lines: [{ name: 'A', barcode: 'A1', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0 });
    const g = id => window.novaSales.list().find(x => x.id === id);
    window.novaSales.addReturn(g('p'), { 0: 1 }, 'partial');
    window.novaSales.addReturn(g('f'), { 0: 3 }, 'full');
    window.novaSales.cancelSale(g('x'), { reason: 'r', by: 'a', role: 'manager', approvedBy: 'b' });
  });
  await page.locator('.nova-tab[data-page=invoices]').click();
  const row = id => page.locator('tr', { has: page.locator(`[data-return="${id}"], [data-return-done="${id}"]`) });
  const status = async id => row(id).locator('[data-ret-status]').getAttribute('data-ret-status').catch(() => null);
  assert.equal(await row('n').locator('[data-ret-status]').count(), 0); assert.ok(await row('n').locator('[data-return="n"]:not([disabled])').count()); n++; console.log('  ok untouched: no badge, active button');
  assert.equal(await status('p'), 'partial'); assert.ok(await row('p').locator('[data-return="p"]:not([disabled])').count()); n++; console.log('  ok partial: badge + active button');
  for (const [id, st] of [['f', 'full'], ['x', 'cancelled']]) {
    assert.equal(await status(id), st);
    assert.equal(await page.locator(`[data-return="${id}"]`).count(), 0, id + ' no actionable button');
    const b = page.locator(`[data-return-done="${id}"]`);
    assert.equal(await b.getAttribute('aria-disabled'), 'true'); assert.ok(await b.isDisabled()); assert.ok(await b.getAttribute('title')); assert.match(await b.innerText(), /تم الإرجاع بالكامل/);
    n++; console.log('  ok ' + st + ': badge + disabled button');
  }
  // dialog defensive state: row is rendered (button active), then returnedQty is stubbed so nothing is returnable at click time
  await page.evaluate(() => { window.__c = window.novaSales.returnedQty; });
  // direct dialog check: stub after render so button exists, then click
  await page.evaluate(() => { const c = window.__c; window.novaSales.returnedQty = id => id === 'n' ? { 0: 3 } : c.call(window.novaSales, id); });
  await page.locator('[data-return="n"]').click();
  assert.ok(await page.locator('#novaRetNone').count(), 'inline notice');
  assert.ok(await page.locator('#novaRetOk').isDisabled()); assert.ok(await page.locator('#novaRetAll').isDisabled());
  assert.equal(await page.locator('#novaRetOk').getAttribute('aria-disabled'), 'true');
  n++; console.log('  ok dialog: notice + Return-all/Confirm disabled when nothing returnable');
  await page.evaluate(() => { document.querySelector('.nova-return-overlay')?.remove(); });
  await page.evaluate(() => { window.novaSales.returnedQty = window.__c; });
  await page.locator('.nova-tab[data-page=pos]').first().click({ timeout: 3000 }).catch(() => {});
  await page.locator('.nova-tab[data-page=invoices]').click();
  await page.locator('[data-return="p"]').click();
  assert.equal(await page.locator('#novaRetNone').count(), 0); assert.ok(await page.locator('#novaRetOk').isEnabled()); assert.ok(await page.locator('#novaRetAll').isEnabled());
  n++; console.log('  ok dialog: partial sale keeps actions enabled, no notice');
  assert.deepEqual(errors, []);
  console.log('ui-ux220: ' + n + ' passed');
} catch (e) { console.log('  FAIL', e.message); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
