// UX400 (was UX240 lock bar): staging/preview conversations open with NO PIN. Opening المحادثات shows the chat list
// immediately: no PIN field, no lock bar/button, no «المحادثات مقفولة», and the UI never sends X-Nova-Pin.
// Fake data via a mocked history API only; every non-GET is aborted (the one send attempt never leaves the browser).
// Viewports: 1366x768 and 390x844. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux240-wa-lock-bar.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.now() - 3600e3; // customer wrote 1h ago: WhatsApp 24h window open, composer enabled
const ID = 'wa_201000000001';
const CONVS = [
  { id: ID, customer: 'منى التجريبية', updatedAt: T + 3000, count: 3, last: { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر بـ 30 جنيه', at: T + 3000, status: 'delivered' } },
  { id: 'wa_201000000002', customer: 'كريم التجريبي', updatedAt: T - 9e5, count: 1, last: { id: 'h_u_9', dir: 'in', kind: 'in', text: 'شكراً', at: T - 9e5, status: null } },
];
const FULL = { id: ID, customer: 'منى التجريبية', updatedAt: T + 3000, messages: [
  { id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null },
  { id: 'h_p_2', dir: 'out', kind: 'pharm', text: 'أهلاً، موجود', at: T + 2000, status: 'delivered' },
  { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر بـ 30 جنيه', at: T + 3000, status: 'delivered' } ] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1366, height: 768, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const blocked = [], pinHeaders = [], histGets = [];
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('ux400-seeded')) { sessionStorage.setItem('novaHistPin', 'stale-old-pin-000'); sessionStorage.setItem('ux400-seeded', '1'); } } catch (e) {} });
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url();
    if (q.headers()['x-nova-pin'] !== undefined) pinHeaders.push(u);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { blocked.push({ m: q.method(), u, pin: q.headers()['x-nova-pin'], body: q.postData() || '' }); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      histGets.push(u);
      const cors = { 'Access-Control-Allow-Origin': origin };
      await new Promise((x) => setTimeout(x, 300));
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL }) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.waitFor({ state: 'visible' });
  // the list loads by itself: no PIN typed, no button pressed
  await view.locator(`[data-conv="${ID}"]`).waitFor({ timeout: 5000 });
  assert.equal(await view.locator('[data-wa-root][data-wa-inbox-open]').count(), 1, 'PIN-free inbox marker');
  assert.equal(await view.locator('#waList [data-conv]').count(), 2, 'both fake chats listed');
  assert.ok(histGets.some((u) => u.endsWith('/inbox/history/conversations')), 'list requested on open');
  for (const sel of ['#waHistPin', '#waHistForm', '#waHistPinTog', '#waHistLock', '[data-wa-lock]', '.wa-lockst', '.wa-lockform', '[data-wa-locked-empty]', '.wa-head-lock'])
    assert.equal(await view.locator(sel).count(), 0, 'no PIN/lock UI: ' + sel);
  let txt = await view.innerText();
  assert.ok(!/PIN/i.test(txt), 'no PIN wording'); assert.ok(!txt.includes('مقفولة') && !txt.includes('محمية'), 'no locked wording');
  const bar = view.locator('.wa-side-head #waHistBar');
  assert.equal(await bar.getAttribute('data-state'), 'ready'); assert.match(await bar.innerText(), /المحادثات \(2\)/);
  assert.ok((await view.locator('.wa-side-head').boundingBox()).height <= 60, 'header stays compact');
  assert.equal(await view.locator('.wa-root').getAttribute('dir'), 'rtl');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null, 'stale PIN wiped from sessionStorage');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux400-${vp.name}-list.png` });
  // open a chat: thread + enabled composer (send UI unlocked), still no lock button in the chat header
  await view.locator(`[data-conv="${ID}"]`).click();
  await view.locator('#waMsgs').getByText('عندكم بنادول؟').waitFor();
  assert.equal(await view.locator('.wa-head-lock, [data-wa-lock]').count(), 0);
  const input = view.locator('#waInput');
  assert.equal(await input.isDisabled(), false, 'composer enabled without PIN');
  assert.equal(await view.locator('.wa-send').isDisabled(), false);
  assert.equal(await input.getAttribute('placeholder'), 'اكتب رسالة');
  txt = await view.innerText(); assert.ok(!/PIN/i.test(txt));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux400-${vp.name}-chat.png` });
  if (vp.name === 'desktop') {
    // one send attempt: it goes to history/send with NO PIN header and is aborted here (never reaches the network)
    await input.fill('رد تجريبي'); await view.locator('.wa-send').click();
    await view.locator('[data-send-err]').waitFor();
    assert.equal(blocked.length, 1); assert.match(blocked[0].u, /\/api\/v1\/inbox\/history\/send$/); assert.equal(blocked[0].pin, undefined);
    assert.deepEqual(Object.keys(JSON.parse(blocked[0].body)).sort(), ['clientId', 'id', 'text']);
  } else assert.deepEqual(blocked, [], 'no non-GET requests');
  assert.deepEqual(pinHeaders, [], 'UI never sends X-Nova-Pin');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('ux240-wa-lock-bar (UX400 PIN-free inbox) OK');
