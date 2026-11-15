// QA loop 314 (customers, debts & chronic refill + all screens). Local only; non-GET and external requests blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tools/qa/qa-loop-314.mjs
import { writeFileSync } from 'node:fs';
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', OUT = '.nova/qa/qa-loop-314';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const raw = {};
const STANDALONE = ['purchases.html', 'sticker-studio.html', 'emergency-sales.html', 'supplier-compare.html'];
for (const vp of [{ n: 'd', width: 1366, height: 768 }, { n: 'm', width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.n === 'm' });
  const origin = new URL(BASE).origin, blocked = [];
  await ctx.route('**/*', r => { const q = r.request(), u = q.url(); if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.method() + ' ' + u); return r.abort(); } return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  p.on('response', r => r.status() >= 400 && bad.push(r.status() + ' ' + r.url()));
  await p.addInitScript(() => { window.__cls = 0; window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch {} });
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  const res = raw[vp.n] = { pages: {} };
  const small = () => p.evaluate(() => [...document.querySelectorAll('button,a,input,select')].filter(e => e.offsetParent && (e.getBoundingClientRect().width < 36 || e.getBoundingClientRect().height < 36)).slice(0, 10).map(e => (e.id || e.className || e.tagName).toString().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
  for (const pg of ['sale', 'invoices', 'products', 'customers', 'reports', 'settings']) {
    const t0 = Date.now();
    await p.locator(`[data-page="${pg}"]`).first().click();
    const ms = Date.now() - t0; await p.waitForTimeout(500);
    const info = await p.evaluate(() => ({ hs: document.documentElement.scrollWidth > innerWidth + 1, len: document.body.innerText.length, nf: /not found|404/i.test(document.body.innerText) }));
    res.pages[pg] = { ms, ...info, small: await small() };
    await p.screenshot({ path: `${OUT}/${vp.n}-${pg}.png` });
  }
  // header buttons
  res.header = await p.evaluate(() => [...document.querySelectorAll('header button, .nova-header button, #novaWaBtn, [class*=topbar] button')].filter(e => e.offsetParent).map(e => (e.id || '') + '|' + (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 25) + '|' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
  // customers focus
  await p.locator('[data-page="customers"]').first().click(); await p.waitForTimeout(600);
  res.cust = await p.evaluate(() => {
    const vis = e => e.offsetParent;
    const root = document.querySelector('#page-customers') || document.querySelector('[data-page-panel=customers]') || document.body;
    return {
      rootId: root.id,
      text: root.innerText.slice(0, 2500),
      controls: [...root.querySelectorAll('button,select,input,a')].filter(vis).map(e => (e.id || '') + '|' + (e.textContent || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '|' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + (e.getAttribute('aria-label') ? '' : '|NOLABEL')).slice(0, 60),
      rows: root.querySelectorAll('tbody tr, .customer-row, .cust-row, [class*=card]').length,
    };
  });
  await p.screenshot({ path: `${OUT}/${vp.n}-customers-focus.png`, fullPage: true });
  // click first customer row if any
  const row = p.locator('#page-customers tbody tr, #page-customers .customer-row, #page-customers [data-customer]').first();
  if (await row.count()) { const t0 = Date.now(); await row.click().catch(() => {}); await p.waitForTimeout(500); res.custRowClick = { ms: Date.now() - t0, text: (await p.evaluate(() => document.body.innerText)).slice(0, 1500) }; await p.screenshot({ path: `${OUT}/${vp.n}-customer-open.png` }); }
  // standalone pages
  res.standalone = {};
  for (const f of ['purchases', ...STANDALONE.slice(1)]) {
    const url = new URL(f === 'purchases' ? 'purchases.html' : f, BASE).href;
    const r = await p.goto(url).catch(e => ({ status: () => 'ERR ' + e.message })); await p.waitForTimeout(900);
    res.standalone[f] = { status: r && r.status && r.status(), len: await p.evaluate(() => document.body.innerText.length), hs: await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), small: await small(), text: (await p.evaluate(() => document.body.innerText)).slice(0, 500) };
    await p.screenshot({ path: `${OUT}/${vp.n}-${f.replace('.html', '')}.png` });
  }
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('#novaWaBtn').click(); await p.waitForTimeout(500);
  res.wa = await p.evaluate(() => ({ view: !!document.querySelector('#novaInboxView') && document.querySelector('#novaInboxView').offsetParent !== null, len: document.body.innerText.length }));
  await p.screenshot({ path: `${OUT}/${vp.n}-wa.png` });
  res.cls = await p.evaluate(() => window.__cls); res.longtasks = await p.evaluate(() => window.__lt);
  res.errors = [...new Set(errs)]; res.bad = [...new Set(bad)]; res.blocked = blocked;
  await ctx.close();
}
writeFileSync('.nova/qa/qa-loop-314-raw.json', JSON.stringify(raw, null, 1));
await b.close(); console.log('done');
