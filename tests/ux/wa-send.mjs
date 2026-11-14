// WA-SEND: composer sends a reply through the mocked staging API (no real customer, no network beyond localhost).
// Checks: no PIN => composer disabled; PIN => enabled; Enter sends; optimistic 🕓 then ✓; server error => Arabic banner + text kept;
// 24h-window error shown; X-Nova-Pin + only {id,text,clientId} posted. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-send.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.now() - 3600e3;
const CONVS = [{ id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T, count: 1, last: { id: 'wa_wamid.1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null } }];
const FULL = { id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T, messages: [{ id: 'wa_wamid.1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null }] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch });
  const sends = []; const other = []; let mode = 'ok'; let release;
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/')) {
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type,X-Nova-Pin', 'Access-Control-Allow-Methods': 'GET,POST' } });
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID' }) });
      if (u.endsWith('/send') && q.method() === 'POST') {
        const b = JSON.parse(q.postData()); sends.push(b);
        if (mode === 'slow') await new Promise((res) => { release = res; });
        if (mode === 'window') return r.fulfill({ status: 422, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SEND_WINDOW_CLOSED', message_ar: 'مينفعش تبعت للعميل ده دلوقتي: آخر رسالة منه عدّى عليها أكتر من 24 ساعة (قاعدة واتساب). لازم العميل يبعت الأول.' }) });
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 'ps_' + sends.length, dir: 'out', kind: 'pharm', text: b.text, at: Date.now(), status: 'sent' } }) });
      }
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: JSON.parse(JSON.stringify(FULL)) };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { other.push(u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator('#waHistForm').waitFor();
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_201000000001"]').click();
  await view.locator('[data-mid="wa_wamid.1"]').waitFor();
  const input = view.locator('#waInput');
  await page.waitForFunction(() => { const i = document.querySelector('#waInput'); return i && !i.disabled; });
  assert.equal(await input.getAttribute('maxlength'), '1000');
  // slow send: optimistic bubble with 🕓, then ✓
  mode = 'slow';
  await input.fill('متوفر يا فندم'); await input.press('Enter');
  await view.locator('.wa-out [data-tick="sending"]').waitFor();
  assert.equal(await input.inputValue(), '', 'input cleared after send');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wa-send-sending-${vp.name}.png` });
  release();
  await view.locator('[data-mid="ps_1"] [data-tick="sent"]').waitFor();
  assert.deepEqual(Object.keys(sends[0]).sort(), ['clientId', 'id', 'text']);
  assert.equal(sends[0].id, 'wa_201000000001'); assert.equal(sends[0].text, 'متوفر يا فندم');
  // send button path
  mode = 'ok';
  await input.fill('تشرفينا'); await view.locator('.wa-send').click();
  await view.locator('[data-mid="ps_2"]').waitFor();
  assert.notEqual(sends[0].clientId, sends[1].clientId);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wa-send-sent-${vp.name}.png` });
  // 24h window closed: Arabic banner, failed tick, text restored
  mode = 'window';
  await input.fill('رسالة متأخرة'); await input.press('Enter');
  await view.locator('[data-send-err]').waitFor();
  assert.match(await view.locator('[data-send-err]').innerText(), /24 ساعة/);
  assert.equal(await view.locator('.wa-out [data-tick="failed"]').count(), 1);
  assert.equal(await view.locator('#waInput').inputValue(), 'رسالة متأخرة', 'text kept for retry');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wa-send-window-${vp.name}.png` });
  // lock => composer disabled again
  await view.locator('.wa-head [data-wa-lock]').click();
  assert.deepEqual(other, [], 'no other non-GET requests');
  assert.deepEqual(errors, []);
  console.log(vp.name, 'sends', sends.length);
  await ctx.close();
}
await browser.close();
console.log('wa-send OK');
