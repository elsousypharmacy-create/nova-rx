// UX417: the «تسجيل عميل» button on the sale screen is a filled primary button (it was a dashed outline that looked like an empty placeholder).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux417-register-customer-button.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const origin = new URL(BASE).origin;
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [theme, lang] of [['dark', 'ar'], ['light', 'ar'], ['dark', 'en']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ar-EG', serviceWorkers: 'block' });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('nova-theme', t); localStorage.setItem('nova-rx-language', l); } catch (e) {} }, [theme, lang]);
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }); return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + 'index.html#sale', { waitUntil: 'load' }); await page.locator('#btnAddLoyalty').waitFor(); await page.waitForTimeout(700);
  const b = await page.locator('#btnAddLoyalty').evaluate((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(), sub = e.querySelector('.nx-rail-sub'), key = e.querySelector('.nx-k'); return { bg: c.backgroundColor, fg: c.color, border: c.borderStyle, w: r.width, h: r.height, fs: parseFloat(c.fontSize), text: e.innerText.replace(/\s+/g, ' ').trim(), subColor: sub && getComputedStyle(sub).color, keyColor: key && getComputedStyle(key).color, vis: r.width > 0 && r.height > 0 }; });
  assert.ok(b.vis && b.h >= 64 && b.w >= 200, 'big enough: ' + b.w + 'x' + b.h);
  assert.notEqual(b.bg, 'rgba(0, 0, 0, 0)', 'filled, not transparent'); assert.equal(b.border, 'solid', 'solid border, not dashed'); assert.ok(b.fs >= 16, 'text at least 16px: ' + b.fs);
  assert.ok(ratio(b.fg, b.bg) >= 4.5, 'label contrast ' + ratio(b.fg, b.bg).toFixed(2)); assert.ok(ratio(b.subColor, b.bg) >= 4.5, 'sub text contrast'); assert.ok(ratio(b.keyColor, b.bg) >= 4.5, 'F3 hint contrast');
  assert.match(b.text, lang === 'en' ? /Register customer/ : /تسجيل عميل/); assert.match(b.text, /F3/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux417-${theme}-${lang}.png`, clip: { x: 1010, y: 48, width: 270, height: 200 } });
  // it still does its job: click -> customer search mode (the search box asks for a customer)
  await page.locator('#btnAddLoyalty').click(); await page.waitForTimeout(300);
  const ph = await page.locator('#mainSearchInput').getAttribute('placeholder'); assert.match(ph, lang === 'en' ? /customer/i : /العميل/, 'click switches the search to customers: ' + ph);
  assert.deepEqual(errors, []); await ctx.close(); ok(`${theme}/${lang}: filled primary button, big, readable (label, sub text, F3), still opens customer search`);
}
await browser.close();
console.log(`PASS ux417 register-customer button: ${n} groups`);
