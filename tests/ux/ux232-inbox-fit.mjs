// UX232: the inbox (.wa-root) must fit the viewport with the PIN lock bar open and closed; composer never clipped.
// Backend mocked, no real PIN. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux232-inbox-fit.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0);
const CONVS = [{ id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T, count: 1, last: { id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null } }];
const FULL = { id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T, messages: [{ id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null }] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1366, height: 768, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }, { width: 844, height: 390, name: 'landscape' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') return r.abort();
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID', message_ar: 'x' }) });
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL }) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.waitFor({ state: 'visible' });
  const check = async (label, needComposer) => {
    const m = await page.evaluate(() => {
      const r = document.querySelector('[data-wa-root]').getBoundingClientRect();
      const c = document.querySelector('#waComposer'), cr = c && c.getBoundingClientRect();
      const v = document.querySelector('#novaInboxView');
      return { rootBottom: r.bottom, rootTop: r.top, h: innerHeight, cTop: cr && cr.top, cBottom: cr && cr.bottom, pageScroll: document.documentElement.scrollHeight - innerHeight, viewScroll: v.scrollHeight - v.clientHeight };
    });
    const tag = `${vp.name} ${label} ${JSON.stringify(m)}`;
    if (vp.name !== 'landscape') assert.ok(m.rootBottom <= m.h + 1, 'root bottom within viewport: ' + tag);
    if (needComposer) {
      assert.ok(m.cBottom !== null, 'composer exists: ' + tag);
      if (vp.name !== 'landscape') assert.ok(m.cBottom <= m.h + 1, 'composer visible: ' + tag);
      else { await page.locator('#waComposer').scrollIntoViewIfNeeded(); const b = await page.evaluate(() => document.querySelector('#waComposer').getBoundingClientRect().bottom); assert.ok(b <= m.h + 1, 'composer reachable: ' + tag); }
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux232-${vp.name}-${label}.png` });
  };
  await view.locator('#waHistForm').waitFor();
  await check('lock-open-list', false);
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_201000000001"]').waitFor();
  await view.locator('[data-conv="wa_201000000001"]').click();
  await view.locator('[data-mid="h_u_1"]').waitFor();
  await check('unlocked-chat', true);
  await view.locator('#waHistLock').click();
  await view.locator('#waHistForm').waitFor();
  await check('lock-closed-again', false);
  await ctx.close();
}
await browser.close();
console.log('ux232-inbox-fit OK');
