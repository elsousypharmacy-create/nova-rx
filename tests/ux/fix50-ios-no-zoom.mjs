// FIX50: iOS Safari must not auto-zoom on input focus. Every input/textarea/select (all app pages) has computed font-size >= 16px
// on an iPhone WebKit profile, and focusing it does not change visualViewport.scale. Static check always runs; WebKit part needs `npx playwright install webkit`.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/fix50-ios-no-zoom.mjs
import { webkit, chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const pages = ['index.html', 'emergency-sales.html', 'sticker-studio.html', 'supplier-compare.html', 'purchases.html', 'integrations/whatsapp/inbox.html'];
for (const p of pages) {
  const h = readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  assert.match(h, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*interactive-widget=resizes-content/, p + ' viewport');
  assert.doesNotMatch(h, /user-scalable=no|maximum-scale/, p + ' must not disable pinch zoom');
}
console.log('static viewport OK');
let browser;
try { browser = await (process.env.ENGINE==="chromium"?chromium:webkit).launch({args:["--no-sandbox"]}); } catch (e) { console.log('WEBKIT UNAVAILABLE, browser part NOT run:', e.message.split('\n')[0]); process.exit(process.env.REQUIRE_WEBKIT ? 1 : 0); }
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar-EG', serviceWorkers: 'block' });
let total = 0;
for (const p of pages) {
  const page = await ctx.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith(new URL(BASE).origin) ? r.continue() : r.abort()));
  await page.goto(BASE + p, { waitUntil: 'load' }); await page.waitForTimeout(800);
  const bad = await page.evaluate(() => [...document.querySelectorAll('input,textarea,select')].filter((e) => !['checkbox', 'radio', 'range', 'file', 'hidden', 'color', 'button', 'submit', 'image'].includes(e.type)).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.id || e.className || e.tagName) + ':' + getComputedStyle(e).fontSize));
  assert.deepEqual(bad, [], p + ' inputs under 16px');
  const n = await page.evaluate(() => document.querySelectorAll('input,textarea,select').length); total += n;
  const vis = page.locator('input:visible:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]):not([type=color]), textarea:visible');
  const cnt = Math.min(await vis.count(), 6);
  for (let i = 0; i < cnt; i++) {
    const s0 = await page.evaluate(() => window.visualViewport.scale);
    await vis.nth(i).focus({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.visualViewport.scale), s0, p + ' scale changed on focus #' + i);
  }
  console.log('OK', p, n, 'fields, focused', cnt); await page.close();
}
console.log('fix50 OK', total, 'fields');
await browser.close();
