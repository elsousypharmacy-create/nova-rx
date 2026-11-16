// UX438: reports periods — yesterday, since last close (across midnight), custom range. Fake data, non-GET blocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const now = Date.now();
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const M = midnight.getTime();
const mk = (i, at, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at, total, vat: 0, payment: 'cash', customer: '', lines: [{ name: 'X', price: total, qty: 1, discount: 0 }] });
// closing at 18:00 yesterday; night shift sales 20:00 yesterday (before-midnight) and 02:00 today (after)
const closeAt = M - 6 * 36e5;
const sales = [mk(1, M - 4 * 36e5, 100), mk(2, Math.min(M + 2 * 36e5, now - 1000), 50), mk(3, closeAt - 36e5, 7000)];
const closings = [{ id: 'SC1', at: closeAt, period: 'day', periodLabel: 'x', float: 0, expected: 0, counted: 0, diff: 0 }];
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
let passed = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  let nonGet = 0;
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET') { nonGet++; return r.abort(); } return q.url().startsWith(BASE) ? r.continue() : r.abort(); });
  await ctx.addInitScript(([s, c]) => { localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); localStorage.setItem('nova-rx-shift-closings-v1', JSON.stringify(c)); }, [sales, closings]);
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(400);
  const kpis = async () => (await p.locator('.nova-kpi').first().innerText()).replace(/\s+/g, ' ');
  const inv = async () => (await p.locator('.nova-kpi').nth(3).innerText()).replace(/\s+/g, ' ');
  // since last close: sums both sides of midnight (invoices = 2, not the 7000 one before the close)
  await p.locator('[data-rep-period="sinceclose"]').click(); await p.waitForTimeout(250);
  assert.match(await inv(), /2/, 'since close invoices ' + await inv());
  assert.match(await kpis(), /150/, 'since close sales ' + await kpis());
  assert.doesNotMatch(await kpis(), /7[,٬.]?150|7000/);
  assert.equal(await p.locator('[data-rep-period="sinceclose"]').getAttribute('aria-pressed'), 'true');
  // yesterday: only the 20:00 sale (100) and the 7000 one
  await p.locator('[data-rep-period="yesterday"]').click(); await p.waitForTimeout(250);
  assert.match(await inv(), /2/); assert.match(await kpis(), /7[,٬]?100/);
  // custom range: yesterday only -> 2 invoices; today only -> 1 if sale 2 exists today
  await p.locator('[data-rep-period="custom"]').click(); await p.waitForTimeout(250);
  const y = new Date(M - 1);
  await p.locator('#novaRepFrom').fill(ymd(y)); await p.waitForTimeout(250);
  await p.locator('#novaRepTo').fill(ymd(y)); await p.waitForTimeout(250);
  assert.match(await inv(), /2/, 'custom y..y');
  await p.locator('#novaRepTo').fill(ymd(new Date())); await p.waitForTimeout(250);
  assert.match(await inv(), /3/, 'custom y..today');
  // default stays today
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(300);
  assert.equal(await p.locator('[data-rep-period="day"]').getAttribute('aria-pressed'), 'true');
  assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'no h-overflow');
  console.log('  non-GET aborted:', nonGet);
  passed++; console.log('  ok viewport', vp.width);
  await ctx.close();
}
await browser.close();
console.log('passed', passed);
