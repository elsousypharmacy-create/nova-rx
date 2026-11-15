// UX327: customers table — Arabic primary + muted Latin line, tier badge, tabular numerals. Local, fake data, non-GET blocked.
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const chromium = pw.chromium || pw.default.chromium;
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let writes = 0;
for (const [w, h] of [[1366, 768], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { if (q.method() !== 'HEAD') writes++; return r.abort(); } return q.url().startsWith(new URL(BASE).origin) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.setItem('nova-rx-demo-mode', '1'); localStorage.setItem('nova.activePage', 'customers'); } catch {} });
  await page.goto(BASE + '#customers', { waitUntil: 'load' });
  await page.waitForSelector('[data-cust-row]');
  const r = await page.evaluate(() => {
    const row = document.querySelector('[data-cust-row="CUST001"]'), n = row.querySelector('.nova-cust-name');
    const ar = n.querySelector('.nova-cust-ar'), en = n.querySelector('.nova-cust-en');
    const a = ar.getBoundingClientRect(), e = en.getBoundingClientRect();
    return { ar: ar.textContent, en: en && en.textContent, stacked: e.top >= a.bottom - 1, arDir: ar.dir, enDir: en.dir,
      noParen: !/[()]/.test(ar.textContent), enColor: getComputedStyle(en).color, arColor: getComputedStyle(ar).color,
      badge: !!row.querySelector('.nova-tier-badge[data-tier=gold]'), tnum: getComputedStyle(row.querySelector('.nova-num')).fontVariantNumeric,
      title: document.querySelector('.nova-panel-title').textContent, chip: !!document.querySelector('.nova-panel-title .nova-demo-chip'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1, badges: document.querySelectorAll('.nova-tier-badge').length };
  });
  console.log(w, JSON.stringify(r));
  assert.equal(r.ar, 'د. طارق المنصور'); assert.equal(r.en, 'Dr. Tariq Al-Mansoor');
  assert.ok(r.stacked, 'latin below arabic'); assert.ok(r.noParen); assert.equal(r.arDir, 'rtl'); assert.equal(r.enDir, 'ltr');
  assert.notEqual(r.enColor, r.arColor); assert.ok(r.badge); assert.match(r.tnum, /tabular/); assert.ok(r.chip); assert.ok(r.badges >= 1); assert.ok(!r.overflow, 'no horizontal overflow');
  await ctx.close();
}
assert.equal(writes, 0);
await browser.close();
console.log('ok ux327');
