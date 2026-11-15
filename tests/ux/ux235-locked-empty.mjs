// UX235 + UX400: with the PIN-free inbox an empty history shows no fake demo chat and no lock/«مقفولة» state, just the
// empty-history panel; the demo chat appears only with the flag, labelled 'عرض تجريبي'. Mocked API, fake data, GET only.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux235-locked-empty.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const flag of [false, true])
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const hist = [], pins = [];
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.request().method())) return r.abort();
    if (u.includes('/api/v1/inbox/history/')) { hist.push(u); if (r.request().headers()['x-nova-pin'] !== undefined) pins.push(u);
      return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': origin }, contentType: 'application/json', body: '{"ok":true,"conversations":[]}' }); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  if (flag) await ctx.addInitScript(() => localStorage.setItem('nova.flags.localDemo', '1'));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView'); await view.waitFor({ state: 'visible' }); await view.locator('#waHistBar[data-state="ready"]').waitFor();
  const txt = await view.innerText();
  assert.ok(!txt.includes('عميل تجريبي') && !txt.includes('عرض محلي'), 'old fake label gone');
  if (!flag) {
    assert.equal(await view.locator('[data-conv]').count(), 0, 'no chat rows for an empty history');
    assert.equal(await view.locator('[data-wa-locked-empty], #waHistForm, #waHistPin').count(), 0, 'no lock state / PIN form');
    assert.ok(!txt.includes('مقفولة') && !/PIN/i.test(txt), 'no locked / PIN wording');
    assert.equal(await view.locator('.wa-state[data-state="empty"]').count(), 1, 'empty-history panel');
    assert.ok(!txt.includes('هل الدواء متوفر'));
  } else {
    assert.equal(await view.locator('[data-conv="demo-1"]').count(), 1, 'demo chat with flag');
    assert.ok((await view.locator('[data-conv="demo-1"]').innerText()).includes('عرض تجريبي'), 'labelled');
  }
  assert.ok(hist.length > 0, 'history requested on open without a PIN'); assert.deepEqual(pins, [], 'no X-Nova-Pin');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux235-${flag ? 'demo' : 'empty'}-${vp.name}.png` });
  assert.deepEqual(errors, []);
  await ctx.close();
}
await browser.close();
console.log('ux235-locked-empty OK');
