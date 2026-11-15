// UX318: customers page — no "few customers" nag card with >=1 customer; empty card only at 0 customers.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux318-customers-nag.mjs
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const { chromium } = pw;
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin; const blocked = [];
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.method() + ' ' + u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1000);
  const open = async list => {
    await p.evaluate(l => { window.NOVA_DEMO = window.NOVA_DEMO || { products: [], customers: [] }; window.NOVA_DEMO.customers = l; }, list);
    await p.locator('[data-page="sale"]').first().click(); await p.waitForTimeout(200);
    await p.locator('[data-page="customers"]').first().click(); await p.waitForTimeout(400);
  };
  const fake = n => Array.from({ length: n }, (_, i) => ({ id: 'F' + i, name: 'عميل تجريبي ' + (i + 1), phone: '0100000000' + i, tier: 'standard', visits: i, points: i * 10 }));
  for (const n of [1, 4, 7]) {
    await open(fake(n));
    assert.equal(await p.locator('#novaCustEmpty').count(), 0, `no nag card with ${n} customers @${vp.width}`);
    assert.ok(!(await p.locator('body').innerText()).includes('عدد العملاء قليل'), 'nag text gone');
    const add = p.locator('.nova-page-header #novaCustAdd');
    assert.equal(await add.count(), 1, 'header add button');
    assert.ok((await add.boundingBox()).height >= 40, 'tap target');
    // UX317 put the debtor filter chips (#novaCustChips) between the KPIs and the table: measure from the last row above the table.
    const above = (await p.locator('.nova-kpis + #novaCustChips').count()) ? '#novaCustChips' : '.nova-kpis';
    const kpiB = await p.locator(above).boundingBox(), tblB = await p.locator(above + ' + .nova-panel').boundingBox();
    assert.ok(tblB.y - (kpiB.y + kpiB.height) < 40, `table right after KPIs (gap ${tblB.y - kpiB.y - kpiB.height})`);
    assert.equal(await p.locator('html').evaluate(e => getComputedStyle(e).direction === 'rtl' || document.dir === 'rtl' || e.dir === 'rtl'), true, 'RTL kept');
  }
  await open([]);
  assert.equal(await p.locator('#novaCustEmpty').count(), 1, 'empty card at 0 customers');
  assert.equal(await p.locator('.nova-page-header #novaCustAdd').count(), 0, 'no duplicate header button at 0');
  assert.ok((await p.locator('#novaCustEmpty').innerText()).includes('لا يوجد عملاء بعد'));
  console.log('  ok viewport', vp.width);
  await ctx.close();
}
assert.equal(blocked.length, 0, 'no non-GET attempted: ' + blocked.join(','));
await b.close(); console.log('UX318 PASS');
