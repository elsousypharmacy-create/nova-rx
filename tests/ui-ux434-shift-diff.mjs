// UX434: shift-close difference states (over/short/match), negative rejection, note required. Fake data, non-GET blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux434-shift-diff.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', origin = new URL(BASE).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const now = Date.now();
const sales = [{ id: 'S1', number: '2026-00001', at: now - 6e4, total: 100, vat: 13.04, payment: 'cash', customer: '', lines: [{ name: 'بنادول', price: 100, qty: 1, discount: 0 }] }];
let fails = 0, writes = 0;
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
for (const vp of [{ width: 1366, height: 768, n: 'desktop' }, { width: 390, height: 844, n: 'mobile' }]) {
  const touch = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: touch, isMobile: touch });
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD') { writes++; return r.abort(); } return q.url().startsWith(origin) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  await ctx.addInitScript(s => { localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); window.__printed = 0; window.print = () => { window.__printed++; }; }, sales);
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(500);
  const exp = Number(await p.locator('#novaShiftExpected').getAttribute('data-amount'));
  const diff = p.locator('#novaShiftDiff'), cnt = p.locator('#novaShiftCount'), bg = 'rgb(23, 26, 31)';
  const t = async (name, fn) => { try { await fn(); console.log('  ok  ', vp.n, name); } catch (e) { fails++; console.log('  FAIL', vp.n, name, String(e.message).split('\n')[0]); } };
  await t('over: text + amber + AA', async () => {
    await cnt.fill(String(exp + 2.25)); const tx = await diff.innerText();
    assert.match(tx, /زيادة/); assert.match(tx, /\+2\.25/); assert.equal(await diff.getAttribute('data-state'), 'over');
    const c = await diff.evaluate(e => getComputedStyle(e).color); assert.equal(c, 'rgb(255, 176, 32)'); assert.ok(cr(c, bg) >= 4.5);
  });
  await t('short: text + red + AA, within threshold no note needed', async () => {
    await cnt.fill(String(exp - 7.75)); const tx = await diff.innerText();
    assert.match(tx, /عجز/); assert.match(tx, /−7\.75/); assert.equal(await diff.getAttribute('data-state'), 'short');
    const c = await diff.evaluate(e => getComputedStyle(e).color); assert.equal(c, 'rgb(255, 107, 107)'); assert.ok(cr(c, bg) >= 4.5);
    await p.locator('#novaShiftPrint').click(); assert.equal(await p.evaluate(() => window.__printed), 1);
  });
  await t('match: text + green', async () => {
    await cnt.fill(String(exp)); assert.match(await diff.innerText(), /مطابق/); assert.equal(await diff.getAttribute('data-state'), 'match');
    assert.ok(cr(await diff.evaluate(e => getComputedStyle(e).color), bg) >= 4.5);
  });
  for (const v of ['-5', '1e3']) await t('reject ' + v + ' inline with aria-invalid', async () => {
    await cnt.fill(v); assert.equal(await cnt.getAttribute('aria-invalid'), 'true');
    const er = p.locator('#novaShiftCountErr'); assert.ok(await er.isVisible()); assert.ok((await er.innerText()).length > 5);
    assert.equal(await diff.getAttribute('data-diff'), ''); assert.equal(await p.evaluate(() => window.__novaRepData.counted), null);
    if (v === '-5') assert.match(await er.innerText(), /سالبًا/);
  });
  await t('valid input clears error', async () => { await cnt.fill(String(exp)); assert.equal(await cnt.getAttribute('aria-invalid'), null); assert.ok(!(await p.locator('#novaShiftCountErr').isVisible())); });
  await t('large diff requires note before closing', async () => {
    const before = await p.evaluate(() => window.__printed);
    await cnt.fill(String(exp - 50)); const note = p.locator('#novaShiftNote');
    assert.equal(await note.getAttribute('aria-invalid'), 'true'); assert.ok(await p.locator('#novaShiftNoteErr').isVisible());
    await p.locator('#novaShiftPrint').click(); assert.equal(await p.evaluate(() => window.__printed), before);
    await note.fill('عجز من خطأ في الفكة'); assert.equal(await note.getAttribute('aria-invalid'), null);
    await p.locator('#novaShiftPrint').click(); assert.equal(await p.evaluate(() => window.__printed), before + 1);
  });
  await t('no horizontal overflow', async () => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1));
  await ctx.close();
}
await browser.close();
console.log('writes blocked:', writes, 'fails:', fails);
process.exit(fails ? 1 : 0);
