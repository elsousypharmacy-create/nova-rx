// UX441: tab switch click-to-paint stays fast, no long tasks, CLS ~0. Fake sales in localStorage, non-GET blocked.
const { chromium } = await import(process.env.PW_PATH || '@playwright/test');
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const sales = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total: 40 + i, vat: 0, payment: ['cash', 'card', 'credit'][i % 3], customer: '', lines: [{ name: 'بنادول', price: 40 + i, qty: 1, discount: 0 }] }));
const PAINT_MAX = Number(process.env.UX441_PAINT_MAX || 250); // measured ~25-45ms locally (was 80-270); generous CI margin
const LT_MAX = Number(process.env.UX441_LT_MAX || 120);       // measured: no long tasks (was 60-170ms)
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : {});
let n = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return q.url().startsWith(BASE.slice(0, -1)) ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => { localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); window.__lt = []; window.__cls = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch (e) {} new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); }, sales);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1500);
  for (const pg of ['reports', 'settings', 'invoices', 'reports', 'settings', 'invoices']) {
    await p.evaluate(() => { window.__lt.length = 0; });
    const r = await p.evaluate(pg => new Promise(res => {
      const t = document.querySelector('[data-page="' + pg + '"]'); const t0 = performance.now(); t.click();
      const pressed = t.classList.contains('active');
      requestAnimationFrame(() => requestAnimationFrame(() => res({ pressed, paint: performance.now() - t0 })));
    }), pg);
    await p.waitForTimeout(800);
    const lt = await p.evaluate(() => window.__lt);
    assert.ok(r.pressed, pg + ' tab pressed instantly');
    assert.ok(r.paint < PAINT_MAX, `${vp.width} ${pg} paint ${r.paint.toFixed(0)}ms`);
    assert.ok(lt.every(d => d < LT_MAX), `${vp.width} ${pg} long tasks ${lt}`);
    await p.evaluate(() => document.querySelector('[data-page="sale"]').click()); await p.waitForTimeout(150);
  }
  assert.ok(await p.evaluate(() => window.__cls) < 0.01, 'CLS');
  assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
  n++; await ctx.close();
}
await b.close(); console.log('ux441 passed viewports:', n);
