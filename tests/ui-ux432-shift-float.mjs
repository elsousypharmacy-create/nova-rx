// UX432: changing opening float must not re-render reports page: keeps counted cash + focus, updates expected/diff live.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const mk = (i, pay, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total, vat: +(total * 0.15 / 1.15).toFixed(2), payment: pay, customer: '', lines: [{ name: 'بنادول 500', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 45.5), mk(2, 'card', 120), mk(3, 'cash', 22.25)];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0;
try {
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
    const blocked = [];
    await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { blocked.push(q.method()); return r.abort(); } return q.url().startsWith(new URL(BASE).origin) ? r.continue() : r.abort(); });
    await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, sales);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
    await p.locator('[data-page="reports"]').first().click();
    await p.locator('#novaShiftCount').waitFor();
    assert.equal(await p.locator('#novaShiftExpected').getAttribute('data-amount'), '67.75');
    await p.locator('#novaShiftCount').fill('167.75');
    const fl = p.locator('#novaShiftFloat');
    await fl.focus(); await fl.fill('100'); await fl.dispatchEvent('change');
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'novaShiftFloat', 'focus kept');
    assert.equal(await p.locator('#novaShiftCount').inputValue(), '167.75', 'counted kept');
    assert.equal(await p.locator('#novaShiftExpected').getAttribute('data-amount'), '167.75');
    assert.equal(await p.locator('#novaShiftDiff').getAttribute('data-diff'), '0.00');
    assert.equal(await p.locator('[data-shift-row="float"]').getAttribute('data-amount'), '100.00');
    await fl.fill('110'); await fl.dispatchEvent('change');
    assert.equal(await p.locator('#novaShiftExpected').getAttribute('data-amount'), '177.75');
    assert.equal(await p.locator('#novaShiftDiff').getAttribute('data-diff'), '-10.00');
    assert.equal(await p.locator('#novaShiftCount').inputValue(), '167.75');
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-shift-v1')).float), 110);
    assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
    n++; console.log('  ok', vp.width + 'x' + vp.height);
    await ctx.close();
  }
} finally { await b.close(); }
console.log(n + ' passed');
