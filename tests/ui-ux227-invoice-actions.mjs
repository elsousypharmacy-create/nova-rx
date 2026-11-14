// UX227: invoice row actions are two distinct, enabled-looking styles; 36px desktop / 44px touch; focus ring; contrast >= 4.5; screenshots.
import { chromium } from '@playwright/test';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:' + srv.address().port + '/';
const OUT = process.env.SHOT_DIR || '/tmp/ux227'; fs.mkdirSync(OUT, { recursive: true });
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined, args: ['--no-sandbox'] });
let n = 0; const ok = m => { n++; console.log('  ok', m); };
try {
  for (const [name, vp, touch] of [['desktop', { width: 1366, height: 768 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', isMobile: touch, hasTouch: touch });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); localStorage.setItem('nova-rx-sales-v1', JSON.stringify([{ id: 'sale-0', number: 'S-0', at: new Date().toISOString(), customer: '', payment: 'cash', lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0, source: 'STOCK LIVE' }])); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(400);
    const g = page.locator('[data-reprint="sale-0"]'), r = page.locator('[data-return="sale-0"]');
    const info = async l => l.evaluate(e => { const c = getComputedStyle(e); const bb = e.getBoundingClientRect(); let bg = [0, 0, 0, 0], p = e.parentElement; while (p) { const b = getComputedStyle(p).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } p = p.parentElement; } return { color: c.color, bg: c.backgroundColor, border: c.borderTopColor, h: bb.height, w: bb.width, top: bb.top, disabled: e.disabled, svg: !!e.querySelector('svg'), under: bg }; });
    const a = await info(g), b = await info(r);
    assert.ok(!a.disabled && !b.disabled); ok(name + ': both enabled');
    assert.ok(a.svg && b.svg); ok(name + ': both have icons');
    assert.notEqual(a.border, b.border); assert.notEqual(a.color, b.color); assert.notEqual(a.bg, b.bg); ok(name + ': distinct styles');
    assert.ok(!/rgb\(107, 107, 107\)/.test(a.bg + b.bg)); ok(name + ': not flat grey');
    const want = touch ? 44 : 36; for (const x of [a, b]) assert.ok(Math.abs(x.h - want) <= 1, name + ' height ' + x.h); ok(name + ': height ' + want);
    for (const x of [a, b]) { const under = rgb(x.under), bg = rgb(x.bg); const base = under.length ? under.slice(0, 3) : [20, 24, 29]; const eff = bg.length === 4 && bg[3] < 1 ? base.map((v, i) => v * (1 - bg[3]) + bg[i] * bg[3]) : (bg[3] === 0 ? base : bg.slice(0, 3)); const cr = ratio(rgb(x.color).slice(0, 3), eff); assert.ok(cr >= 4.5, name + ' contrast ' + cr.toFixed(2)); console.log('    contrast', cr.toFixed(2)); }
    ok(name + ': contrast >= 4.5');
    if (touch) { assert.ok(Math.abs(a.top - b.top) < 2 && a.w > 40 && b.w > 40); ok('mobile: side by side'); }
    await r.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const ol = await r.evaluate(e => { const c = getComputedStyle(e); return [c.outlineStyle, c.outlineWidth]; });
    assert.equal(ol[0], 'solid'); assert.ok(parseFloat(ol[1]) >= 2); ok(name + ': focus ring visible');
    await page.locator('table.nova-data-table').first().screenshot({ path: path.join(OUT, name + '-invoices-actions.png') }).catch(() => page.screenshot({ path: path.join(OUT, name + '.png') }));
    ok(name + ': screenshot ' + OUT);
    await ctx.close();
  }
  console.log('PASS ' + n);
} catch (e) { console.log('FAIL', e.message); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
