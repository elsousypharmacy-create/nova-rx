// QA loop 431 focus: reports & shift close with seeded fake sales (localStorage only). Local, non-GET blocked.
import { writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs');
const BASE = 'http://127.0.0.1:8765/', OUT = '.nova/qa/qa-loop-431';
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const raw = {};
const now = Date.now();
const mk = (i, pay, total, daysAgo = 0) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - daysAgo * 864e5 - i * 6e4, total, vat: +(total * 0.15 / 1.15).toFixed(2), payment: pay, customer: '', lines: [{ name: 'بنادول 500', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 45.5), mk(2, 'card', 120), mk(3, 'credit', 80), mk(4, 'cash', 22.25), mk(5, 'cash', 300, 3), mk(6, 'card', 99, 20)];
for (const vp of [{ n: 'd', width: 1366, height: 768 }, { n: 'm', width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.n === 'm' });
  const blocked = [];
  await ctx.route('**/*', r => { const q = r.request(), u = q.url(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return u.startsWith('http://127.0.0.1:8765') ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => { if (!localStorage.getItem('nova-rx-sales-v1')) localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); window.__cls = 0; new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }, sales);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1000);
  const r = raw[vp.n] = {};
  let t0 = Date.now(); await p.locator('[data-page="reports"]').first().click(); r.switchMs = Date.now() - t0; await p.waitForTimeout(600);
  r.text = await p.evaluate(() => document.querySelector('#page-reports,main,body').innerText.slice(0, 3000));
  r.hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  r.small = await p.evaluate(() => [...document.querySelectorAll('button,input,select')].filter(e => e.offsetParent && e.closest('main,#app,body') && (e.getBoundingClientRect().height < 40)).map(e => (e.id || e.textContent.trim().slice(0, 20)) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0, 10));
  await p.screenshot({ path: `${OUT}/${vp.n}-reports-top.png` });
  await p.screenshot({ path: `${OUT}/${vp.n}-reports-full.png`, fullPage: true });
  // period toggles
  r.periods = {};
  for (const k of ['week', 'month', 'day']) { t0 = Date.now(); await p.locator(`[data-rep-period="${k}"]`).click(); const ms = Date.now() - t0; await p.waitForTimeout(250); r.periods[k] = { ms, kpi: await p.evaluate(() => [...document.querySelectorAll('.nova-kpi')].slice(0, 5).map(e => e.innerText.replace(/\s+/g, ' ')).join(' | ') ), pressed: await p.evaluate(() => [...document.querySelectorAll('[data-rep-period]')].map(e => e.getAttribute('aria-pressed')).join(',')) }; }
  // shift close
  const sc = p.locator('#novaShiftCount'); r.hasShift = await sc.count();
  if (r.hasShift) {
    await sc.scrollIntoViewIfNeeded();
    r.shift = {};
    r.shift.expected = await p.locator('#novaShiftExpected').innerText();
    await p.locator('#novaShiftFloat').fill('100'); await p.locator('#novaShiftFloat').dispatchEvent('change'); await p.waitForTimeout(400);
    r.shift.afterFloatFocusKept = await p.evaluate(() => document.activeElement && document.activeElement.id);
    r.shift.expected2 = await p.locator('#novaShiftExpected').innerText();
    r.shift.countAfterRerender = await p.locator('#novaShiftCount').inputValue();
    for (const v of ['167.75', '170', '160', '-5', '1e3']) { t0 = Date.now(); await p.locator('#novaShiftCount').fill(v); r.shift['v' + v] = { ms: Date.now() - t0, txt: await p.locator('#novaShiftDiff').innerText(), color: await p.locator('#novaShiftDiff').evaluate(e => getComputedStyle(e).color) }; }
    await p.locator('#novaShiftCount').fill('160');
    // contrast of diff text vs panel bg
    r.shift.panelBg = await p.locator('#novaShiftClose').evaluate(e => getComputedStyle(e).backgroundColor);
    await p.locator('#novaShiftClose').screenshot({ path: `${OUT}/${vp.n}-shift-close.png` });
    r.shift.hasConfirmClose = await p.evaluate(() => /تأكيد|إنهاء|إغلاق|اعتماد/.test(document.querySelector('#novaShiftClose').innerText));
    r.shift.buttons = await p.evaluate(() => [...document.querySelectorAll('#novaShiftClose button')].map(e => e.textContent.trim()));
    r.shift.persistsFloat = await p.evaluate(() => localStorage.getItem('nova-rx-shift-v1'));
    t0 = Date.now(); await p.locator('#novaShiftPrint').click(); r.shift.printMs = Date.now() - t0; await p.waitForTimeout(300);
    r.shift.printed = await p.evaluate(() => window.__printed || 0);
    r.shift.dayReportLeft = await p.evaluate(() => !!document.getElementById('novaDayReport'));
    // reload: does counted cash persist?
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700); await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(500);
    r.shift.countAfterReload = await p.locator('#novaShiftCount').inputValue().catch(() => 'n/a');
    r.shift.floatAfterReload = await p.locator('#novaShiftFloat').inputValue().catch(() => 'n/a');
    r.shift.labels = await p.evaluate(() => [...document.querySelectorAll('#novaShiftClose input')].map(e => e.id + ':' + (e.labels && e.labels.length)));
  }
  r.cls = await p.evaluate(() => window.__cls); r.errs = [...new Set(errs)]; r.blocked = blocked;
  await ctx.close();
}
writeFileSync('.nova/qa/qa-loop-431-shift-raw.json', JSON.stringify(raw, null, 1));
await b.close(); console.log('done');
