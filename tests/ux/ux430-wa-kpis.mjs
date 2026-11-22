// UX430: WhatsApp KPIs card on Home + dedicated KPIs page. Backend mocked (fake events), clock fixed, any non-GET request
// is aborted and recorded (must stay empty). Desktop 1366x768 + mobile 390x844, screenshots when SHOTS=dir.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & SHOTS=/tmp/ux430 node tests/ux/ux430-wa-kpis.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const MIN = 60000, H = 3600000, D = 86400000;
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0); // Sun 2026-11-15 12:00 Africa/Cairo (UTC+2)
const TODAY = Date.UTC(2026, 10, 14, 22, 0, 0);
const at = (d, hh, mm = 0, ss = 0) => TODAY + d * D + hh * H + mm * MIN + ss * 1000;
const ev = (c, k, t, x = {}) => ({ c, k, t, ...x });
const NAMES = { wa_1: 'منى التجريبية', wa_2: 'علي التجريبي', wa_3: 'سها التجريبية', wa_4: 'هدى التجريبية', wa_5: 'كريم التجريبي' };
const DATA = { customers: Object.entries(NAMES).map(([id, name]) => ({ id, name })), events: [
  ev('wa_1', 'in', at(0, 9)), ev('wa_1', 'bot', at(0, 9, 0, 5)), ev('wa_1', 'in', at(0, 9, 1), { m: 'image' }), ev('wa_1', 'in', at(0, 9, 2), { m: 'sticker' }), ev('wa_1', 'pharm', at(0, 9, 5), { s: 'سارة' }),
  ev('wa_2', 'in', at(-3, 14)), ev('wa_2', 'pharm', at(-3, 14, 2), { s: 'أحمد' }),
  ev('wa_2', 'in', at(0, 10), { m: 'audio' }), ev('wa_2', 'pharm', at(0, 10, 1), { s: 'أحمد' }), ev('wa_2', 'in', at(0, 10, 30)), ev('wa_2', 'out', at(0, 10, 33), { s: 'أحمد' }),
  ev('wa_3', 'in', at(0, 11)), ev('wa_3', 'sys', at(0, 11, 0, 30), { h: 1 }), ev('wa_3', 'in', at(0, 11, 5)),
  ev('wa_4', 'in', at(-1, 20)), ev('wa_4', 'out', at(-1, 20, 10)),
  ev('wa_5', 'in', at(-3, 9)),
] };
const CONVS = Object.entries(NAMES).map(([id, customer], i) => ({ id, customer, updatedAt: NOW - i * MIN, count: 2, last: { id: 'h_u_' + id, dir: 'in', kind: 'in', text: 'سؤال', at: NOW - i * MIN, status: null } }));
const WD = new Date(Date.UTC(2026, 10, 15, 12)).getUTCDay();

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

// Default OFF: no Home card, no KPIs page, no metrics request.
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG', serviceWorkers: 'block' });
  const metricsOff = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') return r.abort();
    if (u.includes('/api/v1/inbox/history/metrics')) { metricsOff.push(u); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"data":{"customers":[],"events":[]}}' }); }
    if (u.startsWith(origin) || u.startsWith('data:')) return r.continue();
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('nova.waKpi.autoload', '1'); } catch (e) { } });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#novaWaKpiCard').count(), 0, 'no Home KPIs card when flag is off');
  assert.equal(await page.locator('#novaWaKpiView').count(), 0, 'no KPIs page when flag is off');
  assert.equal(metricsOff.length, 0, 'no metrics request when flag is off');
  await page.evaluate(() => window.novaLazy && window.novaLazy.load()); // startup diet P5: 330 is lazy now
  assert.equal(await page.evaluate(() => window.novaWaKpis && window.novaWaKpis.enabled), false, 'API reports disabled');
  await ctx.close();
}

for (const vp of [{ width: 1366, height: 768, name: 'desktop' }, { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, locale: 'ar-EG', serviceWorkers: 'block' });
  const metricsReq = [], convReq = [], posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      assert.equal(q.headers()['x-nova-pin'], undefined, 'no PIN header');
      if (u.includes('/metrics')) { metricsReq.push(u); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, data: DATA }) }); }
      if (u.includes('/conversations')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: CONVS }) });
      const id = new URL(u).searchParams.get('id'); convReq.push(id);
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: { id, customer: NAMES[id], updatedAt: NOW, messages: [{ id: 'h_u_' + id, dir: 'in', kind: 'in', text: 'سؤال', at: at(0, 11), status: null }] } }) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => { try { localStorage.setItem('nova.flags.waKpis', '1'); localStorage.setItem('nova.waKpi.autoload', '1'); } catch (e) { } });
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  const card = page.locator('#novaWaKpiCard');
  await card.waitFor({ state: 'visible' });
  await page.waitForFunction(() => /^3$/.test((document.querySelector('#novaWaKpiCard [data-wk="chats"] b') || {}).textContent || ''), null, { timeout: 8000 });
  const tile = async (k) => (await card.locator(`[data-wk="${k}"] b`).innerText()).trim();
  assert.equal(await tile('chats'), '3'); assert.equal(await tile('msgs'), '11'); assert.equal(await tile('waiting'), '1'); assert.equal(await tile('first'), '3 د');
  assert.match(await card.locator('[data-wk="chats"] i').innerText(), /أمس 1 ▲/);
  assert.match(await card.locator('[data-wk="first"] i').innerText(), /أمس 10 د/);
  const clipped = await card.evaluate((c) => [...c.querySelectorAll('.wk-t b, .wk-t span, .wk-t i')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent));
  assert.deepEqual(clipped, [], 'card text not truncated: ' + clipped.join(' | '));
  assert.equal(await card.getAttribute('dir'), 'rtl');
  const cb = await card.boundingBox();
  assert.ok(cb.height >= 44 && cb.width >= 200, 'card is a large tap target');
  const ovf = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(await ovf() <= 0, 'no horizontal overflow on Home (' + vp.name + ')');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-home-card.png` });
  assert.equal(metricsReq.length, 1, 'Home card loads once');

  // open the KPIs page
  await card.click();
  const view = page.locator('#novaWaKpiView');
  await view.waitFor({ state: 'visible' });
  await view.locator('[data-kpi="chats"]').waitFor();
  const kpi = async (k) => (await view.locator(`[data-kpi="${k}"] b`).innerText()).trim();
  assert.equal(await kpi('chats'), '3'); assert.equal(await kpi('msgs'), '11'); assert.equal(await kpi('waiting'), '1');
  assert.equal(await kpi('avg'), '3 د'); assert.equal(await kpi('median'), '3 د'); assert.equal(await kpi('media'), '3');
  assert.match(await view.locator('[data-tv="chats"]').innerText(), /3[\s\S]*أمس 1/);
  assert.match(await view.locator('[data-tv="avg"]').innerText(), /3 د[\s\S]*أمس 10 د/);
  assert.equal(await view.locator('[data-trend-msgs]').innerText(), '16');
  assert.equal(await view.locator('.wkp-col').count(), 7);
  assert.equal(await view.getAttribute('dir'), 'rtl');
  const vOvf = () => view.evaluate((n) => n.scrollWidth - n.clientWidth);
  const wide = () => view.evaluate((v) => [...v.querySelectorAll('*')].filter((n) => { const b = n.getBoundingClientRect(); return b.right > v.clientWidth + 1 || b.left < -1; }).slice(0, 5).map((n) => n.tagName + '.' + n.className).join(', '));
  assert.ok(await vOvf() <= 0, 'no horizontal overflow on KPIs page: ' + (await wide()));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-page-top.png` });
  // waiting list: open chat first (1h), closed chat after
  const rows = view.locator('[data-kp-chat]');
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.nth(0).getAttribute('data-kp-chat'), 'wa_3');
  assert.match(await rows.nth(0).innerText(), /سها التجريبية[\s\S]*1 س/);
  assert.match(await rows.nth(1).innerText(), /كريم التجريبي[\s\S]*3 يوم 3 س/);
  assert.ok((await rows.nth(0).boundingBox()).height >= 44);
  // heatmap + peak hours
  assert.equal(await view.locator('.wkp-heat .cell').count(), 7 * 24);
  assert.match(await view.locator(`[data-heat="${WD}-9"]`).getAttribute('title'), /3 رسالة/);
  assert.match(await view.locator('[data-peak]').innerText(), /09:00 \(3\)/);
  // new vs returning, staff, media
  assert.equal((await view.locator('[data-cust="new"] b').innerText()).trim(), '2'); assert.equal((await view.locator('[data-cust="ret"] b').innerText()).trim(), '1');
  assert.match(await view.locator('[data-staff="أحمد"]').innerText(), /2/); assert.match(await view.locator('[data-staff="سارة"]').innerText(), /1/);
  assert.equal((await view.locator('[data-media="image"] b').innerText()).trim(), '1'); assert.equal((await view.locator('[data-media="audio"] b').innerText()).trim(), '1');
  assert.equal((await view.locator('[data-media="sticker"] b').innerText()).trim(), '1');
  if (SHOTS) { await view.locator('[data-sec="waiting"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-page-waiting-heatmap.png` }); }
  if (SHOTS) { await view.locator('[data-sec="media"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-page-staff-media.png` }); }
  // trend toggle 30 days
  await view.locator('[data-kp-trend="30"]').click();
  assert.equal(await view.locator('.wkp-col').count(), 30);
  assert.equal(await view.locator('[data-trend-msgs]').innerText(), '16');
  // filters apply across the page
  await view.locator('[data-kp-preset="7d"]').click();
  assert.equal(await kpi('chats'), '5'); assert.equal(await kpi('msgs'), '16'); assert.equal(await kpi('median'), '3 د');
  assert.equal((await view.locator('[data-cust="new"] b').innerText()).trim(), '5');
  assert.match(await view.locator('[data-staff="أحمد"]').innerText(), /3/);
  await view.locator('[data-kp-preset="30d"]').click();
  assert.equal(await kpi('chats'), '5');
  await view.locator('[data-kp-preset="custom"]').click();
  await view.locator('[data-kp-from]').fill('2026-11-14'); await view.locator('[data-kp-from]').dispatchEvent('change');
  await view.locator('[data-kp-to]').fill('2026-11-14'); await view.locator('[data-kp-to]').dispatchEvent('change');
  assert.equal(await kpi('chats'), '1'); assert.equal(await kpi('msgs'), '2'); assert.equal(await kpi('avg'), '10 د');
  assert.equal(await view.locator('[data-staff=""]').count(), 1, 'unnamed staff row');
  assert.ok(await vOvf() <= 0, 'no horizontal overflow after filters: ' + (await wide()));
  await view.evaluate((n) => { n.scrollTop = 0; });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-page-filter-custom.png` });
  await view.locator('[data-kp-preset="today"]').click();
  // back to Home and reopen
  await view.locator('[data-kp-back]').click();
  await view.waitFor({ state: 'hidden' });
  await card.click(); await view.waitFor({ state: 'visible' });
  // tapping a waiting chat opens that conversation (read-only GET), sends nothing
  await view.locator('[data-kp-chat="wa_3"]').click();
  await view.waitFor({ state: 'hidden' });
  const inbox = page.locator('#novaInboxView');
  await inbox.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!document.querySelector('#novaInboxView [data-mid="h_u_wa_3"]'), null, { timeout: 8000 });
  assert.deepEqual(convReq, ['wa_3']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux430-${vp.name}-open-chat.png` });
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  const ls = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  assert.ok(!ls.includes('التجريبي'), 'no chat data stored');
  console.log('  ok', vp.name);
  await ctx.close();
}
// English UI: card + page follow the app language (no Arabic UI text), LTR.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') return r.abort();
    if (u.includes('/inbox/history/metrics')) return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': origin }, contentType: 'application/json', body: JSON.stringify({ ok: true, data: DATA }) });
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => { try { localStorage.setItem('nova.waKpi.autoload', '1'); localStorage.setItem('nova-rx-language', 'en'); } catch (e) { } });
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  const card = page.locator('#novaWaKpiCard');
  await page.waitForFunction(() => /^3$/.test((document.querySelector('#novaWaKpiCard [data-wk="chats"] b') || {}).textContent || ''), null, { timeout: 8000 });
  assert.equal(await card.getAttribute('dir'), 'ltr');
  assert.match(await card.innerText(), /WhatsApp today/); assert.match(await card.locator('[data-wk="first"] b').innerText(), /3 min/);
  await card.click();
  const view = page.locator('#novaWaKpiView'); await view.locator('[data-kpi="chats"]').waitFor();
  const AR = /[\u0600-\u06FF]/;
  const strip = (t) => t.replace(/[^\n]*(التجريبي|أحمد|سارة)[^\n]*/g, ''); // customer and staff names are data
  assert.ok(!AR.test(strip(await card.innerText())), 'no Arabic on the English card');
  { const vt = strip(await view.innerText()); assert.ok(!AR.test(vt), 'no Arabic UI on the English KPIs page: ' + vt.split('\n').filter((l) => AR.test(l)).slice(0, 4).join(' | ')); }
  assert.ok(await view.evaluate((n) => n.scrollWidth <= n.clientWidth), 'no horizontal overflow (en)');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux430-mobile-en-page.png` });
  console.log('  ok english');
  await ctx.close();
}
await browser.close();
console.log('ux430-wa-kpis OK');
