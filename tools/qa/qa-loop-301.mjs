// QA loop 301 (inventory, expiry & shortages). Local only; non-GET and external requests blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tools/qa/qa-loop-301.mjs  (needs playwright-core or @playwright/test resolvable)
import { writeFileSync } from 'node:fs';
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', OUT = '.nova/qa/qa-loop-301';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const raw = {};
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
  const pages = ['sale', 'invoices', 'products', 'customers', 'reports', 'settings'];
  for (const pg of pages) {
    const t0 = Date.now();
    await p.locator(`[data-page="${pg}"]`).first().click();
    await p.waitForFunction(() => true); const ms = Date.now() - t0; await p.waitForTimeout(500);
    const info = await p.evaluate(() => ({ hs: document.documentElement.scrollWidth > innerWidth + 1, len: document.body.innerText.length, nf: /not found|404/i.test(document.body.innerText), small: [...document.querySelectorAll('button,a,input,select')].filter(e => e.offsetParent && (e.getBoundingClientRect().width < 36 || e.getBoundingClientRect().height < 36)).slice(0, 8).map(e => (e.id || e.className || e.tagName).toString().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)) }));
    res.pages[pg] = { ms, ...info };
    if (['products', 'sale', 'reports'].includes(pg) || vp.n === 'd') await p.screenshot({ path: `${OUT}/${vp.n}-${pg}.png` });
  }
  // purchases + WA
  const r = await p.goto(new URL('purchases', BASE).href).catch(e => ({ status: () => 'ERR ' + e.message })); await p.waitForTimeout(800);
  res.purchases = { status: r && r.status && r.status(), len: await p.evaluate(() => document.body.innerText.length) };
  await p.screenshot({ path: `${OUT}/${vp.n}-purchases.png` });
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('#novaWaBtn').click(); await p.waitForTimeout(500);
  res.wa = await p.evaluate(() => ({ view: !!document.querySelector('#novaInboxView') && document.querySelector('#novaInboxView').offsetParent !== null, len: document.body.innerText.length }));
  // inventory focus
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="products"]').first().click(); await p.waitForTimeout(600);
  res.inv = await p.evaluate(() => {
    const vis = e => e.offsetParent;
    return {
      text: document.body.innerText.slice(0, 1800),
      controls: [...document.querySelectorAll('#page-products button,#page-products select,#page-products input,[data-page-panel=products] button')].filter(vis).map(e => (e.id || '') + '|' + (e.textContent || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '|' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0, 40),
      rows: document.querySelectorAll('tbody tr, .product-row, .nova-cards tr').length,
      badges: [...document.querySelectorAll('[class*=expir],[class*=short],[class*=low],[class*=stock]')].filter(vis).slice(0, 15).map(e => e.className.toString().slice(0, 40) + ':' + e.textContent.trim().slice(0, 30)),
    };
  });
  await p.screenshot({ path: `${OUT}/${vp.n}-inventory.png` });
  res.cls = await p.evaluate(() => window.__cls); res.longtasks = await p.evaluate(() => window.__lt);
  res.errors = [...new Set(errs)]; res.bad = [...new Set(bad)]; res.blocked = blocked;
  await ctx.close();
}
writeFileSync('.nova/qa/qa-loop-301-raw.json', JSON.stringify(raw, null, 1));
await b.close(); console.log('done');
