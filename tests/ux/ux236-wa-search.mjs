// UX236: inbox search ignores hamza/diacritics/digits, searches message text, no-result text + clear (×). History API mocked, no real PIN.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux236-wa-search.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '', PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10);
const mk = (id, c, text, d) => ({ id, customer: c, updatedAt: T + d, count: 1, last: { id: 'x' + d, dir: 'in', kind: 'in', text, at: T + d, status: null } });
const CONVS = [mk('wa_201000000001', 'أحمد سمير', 'عندكم بنادول', 1), mk('wa_201000000002', 'منى', 'محتاجة إسعافات أولية ٠١٢٣', 2)];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' }); const posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { posts.push(u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_REQUIRED' }) });
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: CONVS }) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView'); await view.locator('#waHistForm').waitFor();
  await view.locator('#waHistPin').fill(PIN); await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_201000000001"]').waitFor();
  const s = view.locator('#waSearch'), count = () => view.locator('#waList [data-conv]').count();
  await s.fill('احمد'); assert.equal(await count(), 1, 'احمد finds أحمد');
  await s.fill('أحمد'); assert.equal(await count(), 1);
  await s.fill('اسعافات'); assert.equal(await view.locator('[data-conv="wa_201000000002"]').count(), 1, 'message text, hamza-insensitive');
  await s.fill('٠١٠٠٠٠٠٠٠٠٢'); assert.equal(await view.locator('[data-conv="wa_201000000002"]').count(), 1, 'Arabic-Indic phone digits');
  await s.fill('0123'); assert.equal(await count(), 1, 'message ASCII digits match Arabic-Indic');
  await s.fill('زززز');
  assert.equal(await count(), 0); assert.ok((await view.locator('#waList').innerText()).includes('لا نتائج لـ “زززز”'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux236-${vp.name}-noresult.png` });
  await view.locator('#waSearchClear').click();
  assert.equal(await s.inputValue(), ''); assert.equal(await count(), 2, 'clear restores list');
  assert.equal(await view.locator('#waSearchClear').isHidden(), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.wa-root')).direction), 'rtl');
  assert.deepEqual(posts, []); assert.deepEqual(errors, [], errors.join('|'));
  await ctx.close();
}
await browser.close(); console.log('ux236-wa-search OK');
