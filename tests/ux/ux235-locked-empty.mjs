// UX235: locked WhatsApp history shows no fake demo chat, a lock empty state instead; demo only with flag, labelled 'عرض تجريبي'.
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
  const hist = [];
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('/api/v1/inbox/history/')) { hist.push(u); return r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"code":"PIN_REQUIRED"}' }); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  if (flag) await ctx.addInitScript(() => localStorage.setItem('nova.flags.localDemo', '1'));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView'); await view.waitFor({ state: 'visible' }); await view.locator('#waHistForm').waitFor();
  const txt = await view.innerText();
  assert.ok(!txt.includes('عميل تجريبي') && !txt.includes('عرض محلي'), 'old fake label gone');
  if (!flag) {
    assert.equal(await view.locator('[data-conv]').count(), 0, 'no chat rows when locked');
    assert.equal(await view.locator('.wa-side [data-wa-locked-empty]').count(), 1, 'locked empty state in list pane');
    assert.ok(txt.includes('المحادثات مقفولة'));
    if (vp.name === 'desktop') assert.equal(await view.locator('.wa-main [data-wa-locked-empty]').count(), 1, 'main pane shows same guidance');
    assert.ok(!txt.includes('هل الدواء متوفر'));
  } else {
    assert.equal(await view.locator('[data-conv="demo-1"]').count(), 1, 'demo chat with flag');
    assert.ok((await view.locator('[data-conv="demo-1"]').innerText()).includes('عرض تجريبي'), 'labelled');
  }
  assert.equal(hist.length, 0, 'no history request without PIN');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux235-${flag ? 'demo' : 'locked'}-${vp.name}.png` });
  assert.deepEqual(errors, []);
  await ctx.close();
}
await browser.close();
console.log('ux235-locked-empty OK');
