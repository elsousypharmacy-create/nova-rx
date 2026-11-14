// UX48: flag-gated local inbox tab. Off => no tab, no extra requests. On => tab, handoff persists. No non-GET requests.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
async function session(flag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  const reqs = [], attempted = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    reqs.push(u);
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { attempted.push(q.method() + ' ' + u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  if (flag) await ctx.addInitScript(() => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('nova.flags.inbox', '1'); localStorage.setItem('nova.flags.localDemo', '1'); sessionStorage.setItem('__seeded', '1'); } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { ctx, page, reqs, attempted, errors };
}
// flag OFF
const off = await session(false);
assert.equal(await off.page.locator('#novaInboxTab').count(), 0, 'no tab when off');
assert.equal(off.reqs.filter(u => /unified-inbox/.test(u)).length, 0, 'no inbox request when off');
assert.equal(await off.page.evaluate(() => localStorage.getItem('nova.inbox.v1')), null, 'no seed when off');
assert.deepEqual(off.attempted, [], 'no non-GET when off');
assert.deepEqual(off.errors, []);
await off.ctx.close();
// flag ON
const on = await session(true);
const tab = on.page.locator('#novaInboxTab');
assert.equal(await tab.count(), 1, 'tab present when on');
await tab.click();
const view = on.page.locator('#novaInboxView');
assert.ok(await view.isVisible(), 'view opens');
const sec = view.locator('section[data-conv="demo-1"]');
assert.equal(await sec.getAttribute('data-mode'), 'bot');
await view.locator('[data-act="handoff"]').click();
assert.equal(await view.locator('section[data-conv="demo-1"]').getAttribute('data-mode'), 'human');
await on.page.reload({ waitUntil: 'load' });
await on.page.waitForTimeout(800);
await on.page.locator('#novaInboxTab').click();
assert.equal(await on.page.locator('#novaInboxView section[data-conv="demo-1"]').getAttribute('data-mode'), 'human', 'handoff persists');
assert.deepEqual(on.attempted, [], 'no non-GET attempted');
assert.deepEqual(on.errors, []);
await on.ctx.close();
await browser.close();
console.log('ok inbox-flag');
