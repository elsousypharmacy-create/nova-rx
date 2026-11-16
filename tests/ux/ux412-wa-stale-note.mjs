// UX412: informational note when the customer's last message is older than 24 h (WhatsApp may not deliver a free-text reply).
// The composer stays ENABLED (owner 2026-11-16: no pre-block). Fake data, every non-GET aborted. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux412-wa-stale-note.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T21:17:00+03:00'), H = 3600e3;
const chats = {
  wa_old: { customer: 'دكتور احمد', msgs: [{ id: 'a1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 34 * H }, { id: 'a2', dir: 'out', kind: 'pharm', text: 'اهلا', at: NOW - 33 * H, status: 'sent' }] },
  wa_fresh: { customer: 'منى حسن', msgs: [{ id: 'b1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - 2 * H }] },
  wa_edge: { customer: 'على الحد', msgs: [{ id: 'c1', dir: 'in', kind: 'in', text: 'هلا', at: NOW - 24 * H + 60e3 }] },
  wa_never: { customer: 'ما كتبش', msgs: [{ id: 'd1', dir: 'out', kind: 'pharm', text: 'اهلا', at: NOW - 3 * H, status: 'sent' }] },
};
const list = Object.entries(chats).map(([id, c], i) => ({ id, customer: c.customer, updatedAt: NOW - (i + 1) * H, count: c.msgs.length, last: c.msgs[c.msgs.length - 1] }));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const other = [];
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (q.method() !== 'GET' && q.method() !== 'HEAD') { other.push(q.method() + ' ' + u); return r.abort(); }
  if (u.includes('/api/v1/inbox/history/')) {
    const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('/send-media')) return j({ ok: true, enabled: false });
    if (u.includes('/conversations')) return j({ ok: true, conversations: list });
    if (u.includes('/conversation?')) { const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]), c = chats[id]; return j({ ok: true, conversation: { id, customer: c.customer, updatedAt: NOW, messages: c.msgs } }); }
    return j({ ok: true });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.clock.setFixedTime(new Date(NOW));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(400);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
const open = async (id) => { const back = view.locator('[data-wa-back]'); if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(400); } await view.locator(`[data-conv="${id}"]`).click(); await view.locator('#waInput').waitFor(); await page.waitForTimeout(500); };
const state = () => page.evaluate(() => ({ note: (document.querySelector('[data-wa-stale]') || {}).textContent || '', n: document.querySelectorAll('[data-wa-stale]').length, dis: document.getElementById('waInput').disabled, closed: !!document.querySelector('[data-wa-window]') }));
let k = 0; const ok = (m) => { k++; console.log('ok -', m); };

await open('wa_old'); let s = await state();
assert.equal(s.n, 1); assert.ok(s.note.includes('24 ساعة') && s.note.includes('العميل يبعت'), 'note text'); assert.equal(s.dis, false, 'composer stays enabled'); assert.equal(s.closed, false, 'not the old blocking note');
if (SHOTS) await page.screenshot({ path: SHOTS + '/ux412-stale.png' }); ok('customer silent for 34 h: note shown, composer enabled');
await view.locator('#waInput').fill('hello'); await page.waitForTimeout(100); assert.equal((await state()).n, 1, 'typing keeps the note'); assert.equal(await view.locator('#waInput').inputValue(), 'hello'); await view.locator('#waInput').fill(''); ok('typing does not remove the note or the draft');
await open('wa_fresh'); s = await state(); assert.equal(s.n, 0, 'fresh chat: no note'); ok('customer wrote 2 h ago: no note');
await open('wa_edge'); s = await state(); assert.equal(s.n, 0, '23h59m: no note'); ok('23 h 59 min: no note (boundary)');
await open('wa_never'); s = await state(); assert.equal(s.n, 1, 'customer never wrote: note'); assert.equal(s.dis, false); ok('customer never wrote: note shown');
await open('wa_old'); assert.equal((await state()).n, 1); ok('back to the old chat: note again');
assert.deepEqual(errors, []); assert.deepEqual(other, []); await ctx.close(); await browser.close();
console.log(`PASS ux412 stale note: ${k} groups`);
