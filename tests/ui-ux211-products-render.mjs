// UX211: products tab renders first 40 rows synchronously, fills the rest (up to 300) in idle chunks.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); });
  // synchronous part: time click -> first paint of table
  const first = await page.evaluate(() => new Promise(res => {
    const t0 = performance.now();
    document.querySelector('.nova-tab[data-page="products"]').click();
    const n = document.querySelectorAll('#novaRows tr').length;
    requestAnimationFrame(() => res({ sync: n, ms: performance.now() - t0 }));
  }));
  console.log('  tab switch ms', first.ms.toFixed(1), 'sync rows', first.sync);
  assert.ok(first.sync <= 40 && first.sync > 0, 'sync rows ' + first.sync);
  assert.ok(first.ms < 100, 'tab switch ' + first.ms);
  await page.waitForSelector('#novaRows[data-rows-complete="1"]', { timeout: 5000 });
  assert.equal(await page.locator('#novaRows tr').count(), 300, 'all 300 rows');
  const lt = await page.evaluate(() => window.__lt);
  console.log('  long tasks', JSON.stringify(lt.map(x => Math.round(x))));
  // 50ms is the browser's long-task threshold, so any entry means >50ms
  assert.equal(lt.length, 0, 'no long task >50ms');
  // search: results unchanged, stale fill cancelled
  const q = await page.evaluate(() => { const p = window.NOVA_DEMO.products; return String(p[5].name).split(' ')[0]; });
  await page.fill('#novaFilter', q);
  await page.waitForTimeout(600);
  const cnt = await page.locator('#novaRows tr').count();
  const kpi = await page.evaluate(() => [...document.querySelectorAll('.nova-kpi')].find(k => k.textContent.includes('نتيجة البحث')).querySelector('strong').textContent);
  assert.equal(cnt, Math.min(300, Number(kpi)), 'rows match result count');
  assert.deepEqual(errors, []);
  console.log('ui-ux211-products-render: all ok');
} finally { await browser.close(); }
