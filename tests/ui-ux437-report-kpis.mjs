// UX437: reports KPIs split into period group (4 cards) + quiet totals strip, no duplicate values, delta vs previous period. Fake data, non-GET blocked.
const { chromium } = await import(process.env.PW_PATH || '@playwright/test');
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const mk = (i, pay, total, daysAgo = 0) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - daysAgo * 864e5 - i * 6e4, total, vat: 0, payment: pay, customer: '', lines: [{ name: 'بنادول', price: total, qty: 1, discount: 0 }] });
// today 100+50, yesterday 100, 3 days ago 200 (so all-time differs from period)
const sales = [mk(1, 'cash', 100), mk(2, 'card', 50), mk(3, 'cash', 100, 1), mk(4, 'cash', 200, 3)];
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
  await p.locator('#novaKpiPeriod').waitFor();
  const r = await p.evaluate(() => {
    const vals = [...document.querySelectorAll('#novaKpiPeriod .nova-kpi strong, #novaKpiTotals .nova-kpi strong')].map(e => e.innerText.trim());
    return {
      period: document.querySelectorAll('#novaKpiPeriod .nova-kpi').length,
      totals: document.querySelectorAll('#novaKpiTotals .nova-kpi').length,
      titles: [...document.querySelectorAll('.nova-kpi-group-title')].map(e => e.innerText),
      vals, deltas: [...document.querySelectorAll('#novaKpiPeriod [data-delta]')].map(e => e.dataset.delta + ':' + e.dataset.dir + ':' + e.innerText),
      periodFs: parseFloat(getComputedStyle(document.querySelector('#novaKpiPeriod strong')).fontSize),
      totalFs: parseFloat(getComputedStyle(document.querySelector('#novaKpiTotals strong') || document.body).fontSize),
      hs: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  assert.equal(r.period, 4, 'period cards');
  assert.ok(r.totals >= 1 && r.totals <= 4, 'totals cards ' + r.totals);
  assert.ok(r.titles.some(t => t.includes('الفترة')) && r.titles.some(t => t.includes('الإجمالي على هذا الجهاز')), 'titles ' + r.titles);
  // zero returns card is allowed in the period group but values among totals must not duplicate anything shown
  const totalsVals = await p.locator('#novaKpiTotals .nova-kpi strong').allInnerTexts();
  const periodVals = await p.locator('#novaKpiPeriod .nova-kpi strong').allInnerTexts();
  assert.equal(new Set(totalsVals).size, totalsVals.length, 'dup in totals');
  assert.deepEqual(totalsVals.filter(v => periodVals.includes(v)), [], 'totals repeat period values');
  assert.ok(r.deltas.some(d => d.startsWith('sales:up:') && d.includes('50%')), 'sales delta +50% vs yesterday: ' + r.deltas);
  assert.ok(r.periodFs > r.totalFs, 'period primary size');
  assert.equal(r.hs, false, 'no h-scroll');
  assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
  n++; await ctx.close();
}
await b.close(); console.log('ux437 passed viewports:', n);
