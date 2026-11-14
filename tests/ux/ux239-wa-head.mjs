// UX239: WhatsApp chat header has subtitle (count · last activity · read-only), 44x44 back chevron on touch, header lock button.
// Mock history API, no real PIN. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux239-wa-head.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0);
const CONVS = [{ id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T + 3000, count: 4, last: { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر', at: T + 3000, status: 'delivered' } }];
const FULL = { id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T + 3000, messages: [
  { id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null },
  { id: 'h_s_2', dir: 'out', kind: 'sys', text: 'اتحوّل للصيدلي', at: T + 1000, status: null },
  { id: 'h_p_4', dir: 'out', kind: 'pharm', text: 'أهلاً', at: T + 2000, status: 'delivered' },
  { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر', at: T + 3000, status: 'delivered' } ] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const out = {};
for (const vp of [{ width: 1280, height: 800, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch });
  const posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { posts.push(u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID' }) });
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL };
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
  await view.locator('#waHistForm').waitFor();
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_201000000001"]').click();
  await view.locator('[data-mid="h_u_1"]').waitFor();
  const sub = await view.locator('.wa-head [data-wa-sub]').innerText();
  assert.match(sub, /4 رسالة/, 'message count'); assert.match(sub, /آخر نشاط/, 'last activity'); assert.match(sub, /أرشيف للقراءة فقط/, 'read-only');
  const lock = view.locator('.wa-head [data-wa-lock]');
  assert.equal(await lock.count(), 1, 'header lock button');
  const lb = await lock.boundingBox();
  assert.ok(lb.width >= 44 && lb.height >= 44, `lock ${lb.width}x${lb.height}`);
  const info = { sub, lock: [lb.width, lb.height] };
  if (vp.touch) {
    const bk = view.locator('.wa-head [data-wa-back]');
    const bb = await bk.boundingBox();
    assert.ok(bb.width >= 44 && bb.height >= 44, `back ${bb.width}x${bb.height}`);
    assert.equal(await bk.locator('svg').count(), 1, 'chevron icon');
    assert.ok(!(await bk.innerText()).trim(), 'no bare glyph');
    // RTL: back button is at the right end (start) of the header, lock at the left
    const hb = await view.locator('.wa-head').boundingBox();
    assert.ok(bb.x + bb.width > lb.x + lb.width && bb.x > hb.x + hb.width / 2, 'back at RTL start (right)');
    info.back = [bb.width, bb.height];
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux239-mobile-head.png` });
    await bk.click();
    await view.locator('#waHistLock').waitFor();
    await view.locator('[data-conv="wa_201000000001"]').click();
    await view.locator('.wa-head [data-wa-lock]').click();
  } else {
    assert.equal(await view.locator('.wa-head [data-wa-back]').isVisible(), false, 'no back on desktop');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux239-desktop-head.png` });
    await view.locator('.wa-head [data-wa-lock]').click();
  }
  await view.locator('#waHistForm').waitFor();
  assert.ok(!(await view.innerText()).includes('منى التجريبية'), 'header lock clears chats');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null);
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  out[vp.name] = info;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out));
console.log('ux239-wa-head OK');
