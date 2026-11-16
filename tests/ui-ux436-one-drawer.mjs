// UX436: one authoritative expected-in-drawer figure with formula breakdown.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const now = Date.now();
const mk = (i, pay, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total, vat: +(total * 0.15 / 1.15).toFixed(2), payment: pay, customer: '', lines: [{ name: 'بنادول 500', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 45.5), mk(2, 'card', 120), mk(3, 'cash', 22.25)];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
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
    const fl = p.locator('#novaShiftFloat');
    await fl.fill('100'); await fl.dispatchEvent('change');
    const read = () => p.evaluate(() => ({ exp: Number(document.getElementById('novaShiftExpected').dataset.amount), f: document.getElementById('novaShiftFormula').dataset.formula.split('|').map(Number), n: document.querySelectorAll('#novaPayBreakdown [data-pay-row="drawer"]').length, txt: document.querySelector('#novaPayBreakdown').innerText }));
    const v = await read();
    assert.equal(v.n, 0, 'no second drawer row');
    assert.ok(!v.txt.includes('المتوقع'), 'no expected label in payment breakdown');
    assert.equal(v.f.length, 4);
    assert.ok(Math.abs(v.f.reduce((a, c) => a + c, 0) - v.exp) < 0.011, 'formula sum equals expected');
    assert.equal(v.exp, 167.75);
    assert.deepEqual(blocked.filter(m => m !== 'HEAD'), []); assert.deepEqual(errs, []);
    await ctx.close();
  }
  console.log('ux436 passed');
} finally { await b.close(); }
