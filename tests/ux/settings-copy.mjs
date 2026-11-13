// UX35: Settings copy — Arabic role/permission labels, matrix collapsed by default, one register, language switch still 3 clicks.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage();
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaAuth && window.novaAuthUI && window.novaPerms, null, { timeout: 8000 });
await page.evaluate(async () => { await novaAuth.createAccount({ name: 'Ahmed', password: 'secret1' }); await novaAuth.signIn('Ahmed', 'secret1'); });
let clicks = 0;
await page.locator('.nova-tab[data-page=settings]').click(); clicks++;
await page.waitForSelector('#novaPermMatrix', { state: 'attached' });
// matrix collapsed by default
assert.equal(await page.locator('#novaPermDetails').evaluate(d => d.open), false, 'matrix must be collapsed by default');
assert.equal(await page.locator('#novaPermMatrix').isVisible(), false);
const summary = await page.locator('#novaPermDetails > summary').innerText();
assert.match(summary, /مصفوفة الصلاحيات \(للمدير\)/);
// copy
const view = page.locator('.nova-page-view:visible').first();
let text = await view.evaluate(el => el.textContent);
assert.ok(text.includes('المظهر: Black Edition، خط Cairo، مناسب للتابلت'));
assert.ok(!text.includes('اختار'), 'one register: no colloquial «اختار»');
// Arabic role + permission labels, no dotted keys anywhere in settings text (matrix expanded too)
await page.locator('#novaPermDetails > summary').click();
text = await page.locator('#novaAuthCard').evaluate(el => el.textContent);
const full = await view.evaluate(el => el.textContent);
for (const t of [text, full]) assert.ok(!/[a-z]+\.[a-z]+/.test(t), 'permission key leaked: ' + (t.match(/[a-z]+\.[a-z]+/) || [])[0]);
for (const w of ['المالك', 'المدير', 'الصيدلي', 'الكاشير', 'المخزن', 'المحاسب', 'المندوب', 'إنشاء بيع']) assert.ok(text.includes(w), 'missing ' + w);
// language switch journey: tab -> English click -> Arabic click = still 3 clicks round trip
await page.locator('.nova-lang-btn[data-lang=en]').click(); clicks++;
assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
await page.locator('.nova-lang-btn[data-lang=ar]').click(); clicks++;
assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
assert.equal(clicks, 3);
await browser.close();
console.log('PASS settings-copy');
