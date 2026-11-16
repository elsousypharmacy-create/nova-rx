// UX442: end-of-day printed report has header + signatures and is cleaned up (afterprint + timeout fallback).
// Fake data only (localStorage), non-GET blocked, window.print stubbed. Usage: node tests/ui-ux442-day-report-print.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const { chromium } = await import(process.env.PW_PATH || 'playwright-core').catch(() => import('/tmp/pw/node_modules/playwright-core/index.mjs'));
const ROOT = process.cwd(), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const srv = createServer((q, r) => { let f = join(ROOT, normalize(q.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '')); if (f.endsWith('/') || f === ROOT) f = join(ROOT, 'index.html'); if (!existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f)); });
await new Promise(o => srv.listen(0, '127.0.0.1', o));
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const now = Date.now();
const mk = (i, pay, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total, vat: +(total * 0.15 / 1.15).toFixed(2), payment: pay, customer: '', lines: [{ name: 'بنادول 500', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 45.5), mk(2, 'card', 120), mk(3, 'cash', 22.25)];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const vp of [{ n: 'desktop', width: 1366, height: 768 }, { n: 'mobile', width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return q.url().startsWith(BASE) ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => {
    if (!localStorage.getItem('nova-rx-sales-v1')) localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s));
    window.__snap = []; window.__novaPrintFallbackMs = 400;
    window.print = () => { const e = document.getElementById('novaDayReport'); window.__snap.push({ html: e ? e.innerText : null, cls: document.body.classList.contains('nova-printing-report') }); };
  }, sales);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(500);
  await p.locator('#novaShiftFloat').fill('100'); await p.locator('#novaShiftFloat').dispatchEvent('change'); await p.waitForTimeout(300);
  await p.locator('#novaShiftCount').fill('160');
  // run 1: afterprint cleanup
  await p.locator('#novaPrintDay').click();
  const s1 = await p.evaluate(() => window.__snap[0]);
  ok(s1 && s1.cls, `${vp.n}: print stub saw printing class`);
  ok(s1 && /صيدلية السوسي/.test(s1.html), `${vp.n}: pharmacy name`);
  ok(s1 && /الفرع/.test(s1.html) && /الكاشير/.test(s1.html) && /وقت الإغلاق/.test(s1.html), `${vp.n}: branch/cashier/closing time`);
  ok(s1 && /توقيع الكاشير/.test(s1.html) && /توقيع المراجع/.test(s1.html), `${vp.n}: signature lines`);
  ok(s1 && /النقدي المعدود/.test(s1.html) && /الفرق/.test(s1.html), `${vp.n}: shift-close figures when counted`);
  ok(await p.locator('#novaDayReport .nova-dr-sigs i').count() === 2, `${vp.n}: 2 signature rules in DOM`);
  ok(await p.locator('#novaDayReport').count() === 1, `${vp.n}: element present before afterprint`);
  await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  ok(await p.locator('#novaDayReport').count() === 0 && await p.evaluate(() => !document.body.classList.contains('nova-printing-report')), `${vp.n}: removed after afterprint`);
  // run 2: timeout fallback (no afterprint)
  await p.locator('#novaPrintDay').click();
  ok(await p.locator('#novaDayReport').count() === 1, `${vp.n}: re-created on second print`);
  await p.waitForTimeout(900);
  ok(await p.locator('#novaDayReport').count() === 0 && await p.evaluate(() => !document.body.classList.contains('nova-printing-report')), `${vp.n}: removed by timeout fallback`);
  // print CSS present
  await p.emulateMedia({ media: 'print' });
  ok(await p.evaluate(() => getComputedStyle(document.body).display !== undefined), `${vp.n}: print media emulation ok`);
  ok(errs.length === 0, `${vp.n}: no page errors ${errs.join('|')}`);
  ok(!blocked.some(m => m !== 'HEAD'), `${vp.n}: no write requests reached network (blocked: ${blocked.join(',')||'none'})`);
  await ctx.close();
}
await b.close(); srv.close();
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
