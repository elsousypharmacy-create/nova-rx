// UX42: Settings layout — equal-height cards per row, merged About card, styled VAT input.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaAuthUI && window.novaVat, null, { timeout: 8000 });
  await page.locator('.nova-tab[data-page=settings]').click();
  await page.waitForSelector('#novaVatRate');
  const txt = await page.locator('.nova-settings-grid').innerText();
  assert.ok(txt.includes('عن النظام'));
  for (const t of ['المظهر', 'النسخة', 'بيانات النظام']) assert.equal(await page.locator('.nova-setting-card h3', { hasText: new RegExp('^' + t + '$') }).count(), 0, 'separate card ' + t);
  const cards = await page.$$eval('.nova-setting-card', els => els.map(e => { const r = e.getBoundingClientRect(); const kids = [...e.children].filter(c => c.getBoundingClientRect().height); const last = kids.length ? Math.max(...kids.map(c => c.getBoundingClientRect().bottom)) : r.top; const cs = getComputedStyle(e); return { top: Math.round(r.top), h: r.height, w: r.width, empty: (r.bottom - parseFloat(cs.paddingBottom) - last) / r.height, vis: r.height > 0 }; }));
  const rows = new Map();
  for (const c of cards.filter(c => c.vis)) { const k = Math.round(c.top / 4); const key = [...rows.keys()].find(x => Math.abs(x - k) <= 1) ?? k; (rows.get(key) || rows.set(key, []).get(key)).push(c); }
  for (const [, row] of rows) { const hs = row.map(c => c.h); assert.ok(Math.max(...hs) - Math.min(...hs) <= 2, 'unequal heights ' + hs); }
  const worst = Math.max(...cards.filter(c => c.vis).map(c => c.empty));
  assert.ok(worst <= 0.4, 'card empty area ' + worst.toFixed(2) + ' ' + JSON.stringify(cards.map(c => [c.top, Math.round(c.h), +c.empty.toFixed(2)])));
  const v = await page.locator('#novaVatRate').evaluate(e => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, bg: getComputedStyle(e).backgroundColor }; });
  assert.ok(v.h >= 44 && v.w >= 96, JSON.stringify(v));
  assert.notEqual(v.bg, 'rgb(59, 59, 59)'); assert.notEqual(v.bg, 'rgb(255, 255, 255)');
  assert.ok((await page.locator('.nova-vat-row').innerText()).includes('%'));
  console.log('PASS settings-layout', JSON.stringify(v), 'maxEmpty=' + worst.toFixed(2));
} finally { await browser.close(); }
