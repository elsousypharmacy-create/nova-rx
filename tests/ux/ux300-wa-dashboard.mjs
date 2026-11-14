// UX300: WhatsApp response-time dashboard. PIN-gated, exact times (Africa/Cairo), filters, drill-down, no storage, no writes.
// Backend is mocked. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux300-wa-dashboard.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0), S = 1000, MIN = 60000;
const CONVS = [{ id: 'wa_1', customer: 'منى التجريبية', updatedAt: T, count: 2, last: { id: 'h_p_2', dir: 'out', kind: 'pharm', text: 'x', at: T, status: null } }];
const ev = (c, k, t, x = {}) => ({ c, k, t, ...x });
const DATA = { customers: [{ id: 'wa_1', name: 'منى التجريبية' }, { id: 'wa_2', name: 'علي التجريبي' }], events: [
  ev('wa_1', 'in', T, { tp: ['price'] }), ev('wa_1', 'bot', T + 5 * S), ev('wa_1', 'in', T + MIN), ev('wa_1', 'sys', T + MIN + S, { h: 1 }), ev('wa_1', 'pharm', T + MIN + S + 4 * MIN + 30 * S),
  ev('wa_2', 'in', (T + 20 * MIN) / 1000) ] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const metricsReq = [], posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID' }) });
      if (u.includes('/metrics')) { metricsReq.push(u); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, data: DATA }) }); }
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: { id: 'wa_1', customer: 'منى التجريبية', updatedAt: T, messages: [{ id: 'h_u_1', dir: 'in', kind: 'in', text: 'سؤال', at: T, status: null }] } };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.waitFor({ state: 'visible' });
  assert.equal(await view.locator('#waDashOpen').count(), 0, 'no dashboard button before the PIN');
  assert.equal(metricsReq.length, 0, 'no metrics request without a PIN');
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_1"]').waitFor();
  await view.locator('#waDashOpen').click();
  await view.locator('.wd-grid').waitFor();
  assert.equal(metricsReq.length, 1);
  const card = async (key) => (await view.locator(`.wd-card[data-drill="${key}"] .v`).innerText()).trim();
  // exact numbers: replies bot 5s, pharmacist 4m31s (reply after the 1s handoff note => 4m30s handoff), wa_2 unanswered (seconds-based ts)
  assert.equal(await card('bot'), '5 ث'); assert.equal(await card('pharm'), '4 د 31 ث'); assert.equal(await card('handoffAns'), '4 د 30 ث');
  assert.equal(await card('unanswered'), '1'); assert.equal(await card('waiting'), '1'); assert.equal(await card('customers'), '2');
  assert.equal(await card('first'), '5 ث');
  // drill: unanswered -> علي, Cairo time 13:20 (UTC+3 in Oct 2026)
  await view.locator('.wd-card[data-drill="unanswered"]').click();
  const dr = view.locator('#wdDrill');
  await dr.waitFor(); assert.match(await dr.innerText(), /علي التجريبي/); assert.match(await dr.innerText(), /2026-10-20 13:20:00/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux300-${vp.name}-top.png` });
  // pharmacist-only filter
  await view.locator('[data-wd-who="pharm"]').click();
  assert.equal(await card('replies'), '4 د 31 ث');
  await view.locator('[data-wd-who="bot"]').click();
  assert.equal(await card('replies'), '5 ث');
  await view.locator('[data-wd-who="all"]').click();
  // date range: custom day excluding the data => zero customers
  await view.locator('#wdFrom').fill('2026-10-21'); await view.locator('#wdFrom').dispatchEvent('change');
  assert.equal(await card('customers'), '0');
  await view.locator('[data-wd-preset="all"]').click();
  assert.equal(await card('customers'), '2');
  // chart drill + open chat
  await view.locator('.wd-hit[data-drill^="d:"]').first().click();
  await dr.waitFor(); assert.match(await dr.innerText(), /منى التجريبية/);
  if (SHOTS) { await view.locator('.wd-two').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/ux300-${vp.name}-charts.png` }); }
  await view.locator('[data-open-chat="wa_1"]').first().click();
  await view.locator('[data-mid="h_u_1"]').waitFor();
  // chat -> dashboard again -> lock clears everything
  if (vp.name === 'mobile') await view.locator('[data-wa-back]').click();
  await view.locator('#waDashOpen').click(); await view.locator('.wd-grid').waitFor();
  await view.locator('[data-wa-lock]').first().click();
  await view.locator('#waHistForm').waitFor();
  assert.ok(!(await view.innerText()).includes('منى التجريبية'), 'lock clears dashboard data');
  const ls = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  assert.ok(!ls.includes('التجريبية') && !ls.includes(PIN), 'nothing stored');
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('ux300-wa-dashboard OK');
