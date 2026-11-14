// UX225: return dialog confirm/close always visible without scrolling (1366x768, 390x844) with cancel box open; chips never orphaned.
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
  for (const [name, vp] of [['desktop 1366x768', { width: 1366, height: 768 }], ['mobile 390x844', { width: 390, height: 844 }]]) {
    const mobile = vp.width < 600;
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', isMobile: mobile, hasTouch: mobile });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => {
      try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {}
      try { if (!localStorage.getItem('nova-rx-sales-v1')) { const now = new Date().toISOString(); localStorage.setItem('nova-rx-sales-v1', JSON.stringify([0, 1].map(i => ({ id: 'sale-' + i, number: 'S-' + i, at: now, customer: '', payment: 'cash', lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0, source: 'STOCK LIVE' })))); } } catch {}
    });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    await page.locator('.nova-tab[data-page=invoices]').click();
    await page.locator('[data-return="sale-0"]').click();
    const vis = async (sel) => page.evaluate(([sel, h]) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.top >= 0 && r.bottom <= h && r.height > 0; }, [sel, vp.height]);
    for (const open of [false, true]) {
      if (open) await page.locator('#novaCancelBox summary').click();
      await page.locator('#novaRetReason').fill('x'); // error-free state; also checks nothing hides footer
      assert.ok(await vis('#novaRetOk'), `${name} cancelBox=${open}: confirm visible`);
      assert.ok(await vis('#novaRetCancel'), `${name} cancelBox=${open}: close visible`);
      assert.ok(await vis('#novaRetMsg'), `${name} cancelBox=${open}: msg visible`);
    }
    const chips = await page.$$eval('#novaRetChips .nova-chip', e => e.map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.width)]; }));
    assert.equal(chips.length, 4);
    const rows = new Set(chips.map(c => c[0]));
    if (mobile) { assert.equal(rows.size, 2, 'chips 2x2'); for (const t of rows) assert.equal(chips.filter(c => c[0] === t).length, 2, 'no orphan row'); }
    else assert.ok(rows.size <= 2 && (rows.size === 1 || chips.filter(c => c[0] === [...rows][1]).length >= 2), 'desktop chips not orphaned');
    const ok = await page.locator('#novaRetOk').boundingBox(), cl = await page.locator('#novaRetCancel').boundingBox();
    assert.ok(ok.width >= cl.width, 'primary dominant');
    if (mobile) assert.ok(ok.width > vp.width * 0.8, 'primary full-width on mobile');
    // body scrolls inside, footer stays
    const sc = await page.$eval('.nova-ret-body', e => getComputedStyle(e).overflowY);
    assert.equal(sc, 'auto');
    n++; console.log('  ok', name);
    await ctx.close();
  }
  console.log('ui-ux225: ' + n + ' passed');
} catch (e) { console.log('  FAIL', e.message); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
