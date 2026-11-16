// UX435: report panels have consistent inner padding/gap; labels/rows never touch panel edges; no duplicate float row. Fake data, non-GET blocked.
const { chromium } = await import(process.env.PW_PATH || '@playwright/test');
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const mk = (i, pay, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total, vat: 0, payment: pay, customer: '', lines: [{ name: 'بنادول', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 50), mk(2, 'card', 70), mk(3, 'credit', 30)];
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : {});
let n = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return q.url().startsWith(BASE.slice(0, -1)) ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => { if (!localStorage.getItem('nova-rx-sales-v1')) localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); }, sales);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="reports"]').first().click();
  await p.locator('#novaShiftClose').waitFor();
  const r = await p.evaluate(() => {
    const ids = ['novaPayBreakdown', 'novaShiftClose', 'novaTopSellers'];
    const px = v => parseFloat(v);
    const panels = ids.map(id => document.getElementById(id));
    const gaps = [], bad = [];
    panels.forEach((pn, i) => {
      const pr = pn.getBoundingClientRect();
      const next = document.getElementById(['novaPayBreakdown', 'novaRetReasons', 'novaShiftClose', 'novaTopSellers'][i + 1 === 1 ? 2 : i + 1]);
      pn.querySelectorAll(':scope > :not(.nova-panel-title)').forEach(el => {
        let rr; if (el.matches('label,input,button')) rr = el.getBoundingClientRect(); else { const g = document.createRange(); g.selectNodeContents(el); rr = g.getBoundingClientRect(); }
        const lead = Math.min(rr.left - pr.left, pr.right - rr.right);
        if (lead < 15.5) bad.push(pn.id + ':' + (el.id || el.getAttribute('data-pay-row') || el.getAttribute('data-shift-row') || el.tagName) + ':' + lead);
      });
    });
    const order = [...document.querySelectorAll('.nova-panel')];
    for (let i = 0; i < Math.min(order.length, 4) - 1; i++) gaps.push(order[i + 1].getBoundingClientRect().top - order[i].getBoundingClientRect().bottom);
    return { bad, gaps, rows: document.querySelectorAll('#novaShiftClose [data-shift-row="float"]').length, labels: [...document.querySelectorAll('#novaShiftClose label')].length };
  });
  assert.deepEqual(r.bad, [], 'items touch panel edge');
  assert.ok(r.gaps.length === 3 && r.gaps.every(g => g >= 12 && g <= 20), 'gaps ' + r.gaps);
  assert.equal(r.rows, 0, 'duplicate float row removed');
  const pad = await p.evaluate(() => getComputedStyle(document.querySelector('#novaShiftClose [data-shift-row="cash"]')).paddingInlineStart);
  assert.equal(pad, '16px');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no h-scroll');
  assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
  n++; await ctx.close();
}
await b.close(); console.log('ux435 passed viewports:', n);
