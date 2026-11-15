// UX402: realtime conversations like WhatsApp Web. 1366x768 + 390x844, fake data only: the history API is answered by ctx.route,
// every non-GET is aborted (no live writes, no WhatsApp send), Notification/AudioContext are fakes injected before load, SW blocked.
// Asserts, without location.reload: a new inbound + outbound message appears in the open chat (smooth data-live insert, no duplicate
// bubble) and in the list (preview + unread badge); the tab badge and #novaWaBadge update live; the in-app Arabic toast shows for
// another chat / another screen and is muted for the chat already on screen; browser Notification fires in the background when
// granted without Web Push, and a missing Notification API falls back to toast + badges; the poll pauses when the tab is hidden
// and backs off on errors; scroll-to-latest only when the user is at the bottom.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux402-wa-realtime.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const A = 'wa_201000000402', B = 'wa_201000000403';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

const FAKES = (noNotif) => {
  const w = window;
  w.__t = { snd: 0, perm: 'default', hidden: false, focus: true, sys: [], reloads: 0 };
  class FakeAC { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { w.__t.snd++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } resume() {} }
  w.AudioContext = FakeAC; w.webkitAudioContext = FakeAC;
  if (noNotif) { try { delete w.Notification; } catch (e) {} w.Notification = undefined; }
  else {
    function N(title, o) { w.__t.sys.push({ title, body: o && o.body, tag: o && o.tag }); this.close = () => {}; }
    Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
    N.requestPermission = () => Promise.resolve(w.__t.perm);
    w.Notification = N;
  }
  Object.defineProperty(document, 'hidden', { get: () => w.__t.hidden, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (w.__t.hidden ? 'hidden' : 'visible'), configurable: true });
  document.hasFocus = () => w.__t.focus;
  w.__bg = (on) => { w.__t.hidden = on; w.__t.focus = !on; document.dispatchEvent(new Event('visibilitychange')); w.dispatchEvent(new Event(on ? 'blur' : 'focus')); };
  w.addEventListener('beforeunload', () => { w.__t.reloads++; sessionStorage.setItem('ux402.unload', '1'); });
};

const M = (id, dir, at, text, kind) => ({ id, dir, kind: kind || (dir === 'in' ? 'in' : 'pharm'), text, at, status: dir === 'out' ? 'sent' : null });
async function run(vp, noNotif) {
  const many = Array.from({ length: 24 }, (_, i) => M('a' + i, i % 2 ? 'out' : 'in', NOW - (30 - i) * 60e3, 'رسالة قديمة رقم ' + i + ' للتجربة فقط'));
  const data = {
    [A]: { customer: 'منى (تجربة)', messages: many },
    [B]: { customer: 'سعيد (تجربة)', messages: [M('b1', 'in', NOW - 7200e3, 'السلام عليكم'), M('b2', 'out', NOW - 7100e3, 'أهلاً')] },
  };
  const list = () => Object.entries(data).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages[c.messages.length - 1].at, count: c.messages.length, last: c.messages[c.messages.length - 1] }));
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Africa/Cairo', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
  const other = [], hits = { list: 0 }; let fail = false;
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/') && q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type,accept' } });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      if (u.includes('/push/key')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"enabled":false}' });
      if (u.includes('/conversations')) { hits.list++; if (fail) return r.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: '{"ok":false}' }); }
      const id = new URL(u).searchParams.get('id');
      const body = u.includes('/conversations') ? { ok: true, conversations: list() }
        : { ok: true, conversation: data[id] ? { id, customer: data[id].customer, updatedAt: NOW, messages: data[id].messages } : null };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.addInitScript(FAKES, noNotif);
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__marker = 'same-document'; });
  const tag = vp.name + (noNotif ? '/no-Notification' : '');
  const T = () => page.evaluate(() => ({ ...window.__t }));
  const view = page.locator('#novaInboxView');
  await page.locator('#novaWaBtn').click();
  await view.locator(`[data-conv="${B}"]`).waitFor();
  const unreadOf = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-conv="${id}"] [data-unread]`); return b ? b.dataset.unread : null; }, id);
  const tabBadge = () => page.evaluate(() => { const b = document.querySelector('#novaInboxTab [data-wa-tab-unread]'); return b && !b.hidden ? b.textContent : ''; });
  const hdrBadge = () => page.evaluate(() => { const b = document.getElementById('novaWaBadge'); return b && !b.hidden ? b.textContent : ''; });
  const toast = () => page.evaluate(() => { const e = document.getElementById('novaWaToast'); return e && !e.hidden ? { chat: e.dataset.chat, text: e.textContent } : null; });
  assert.equal(await page.evaluate(() => window.NovaWaNotify.delay()), 4000, tag + ' 4s poll on the conversations screen');

  // 1) open chat A, at the bottom. A new inbound + outbound appear in the open chat and in the list without reload
  await view.locator(`[data-conv="${A}"]`).click();
  await view.locator('[data-mid="a23"]').waitFor();
  await page.waitForFunction(() => { const m = document.querySelector('#waMsgs'); return m && m.scrollHeight - m.scrollTop - m.clientHeight < 40; });
  const before = await view.locator('#waMsgs [data-mid]').count();
  data[A].messages.push(M('a90', 'in', NOW + 60e3, 'وصلت رسالة جديدة من العميل'));
  data[A].messages.push(M('a91', 'out', NOW + 61e3, 'رد من موبايل الصيدلية'));
  await view.locator('[data-mid="a91"]').waitFor({ timeout: 9000 });
  assert.equal(await view.locator('#waMsgs [data-mid]').count(), before + 2, tag + ' exactly two new bubbles (no duplicates)');
  assert.equal(await view.locator('[data-mid="a90"]').count(), 1);
  assert.equal(await view.locator('[data-mid="a90"]').getAttribute('data-live'), '', tag + ' inbound slides in (data-live)');
  assert.equal(await view.locator('[data-mid="a23"]').getAttribute('data-live'), null, 'old bubbles do not re-animate');
  assert.ok(await page.evaluate(() => { const m = document.querySelector('#waMsgs'); return m.scrollHeight - m.scrollTop - m.clientHeight < 40; }), tag + ' stays at latest when already at the bottom');
  assert.equal(await toast(), null, tag + ' no toast for the chat already on screen');
  assert.equal((await T()).sys.length, 0);
  if (vp.touch) { await view.locator('[data-wa-back]').click(); await view.locator(`[data-conv="${A}"]`).waitFor(); }
  assert.match(await view.locator(`[data-conv="${A}"]`).textContent(), /رد من موبايل الصيدلية/, tag + ' list preview updated');

  // 2) not at the bottom: a new bubble does not yank the scroll
  if (vp.touch) { await view.locator(`[data-conv="${A}"]`).click(); await view.locator('[data-mid="a91"]').waitFor(); }
  await page.evaluate(() => { const m = document.querySelector('#waMsgs'); m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(200);
  data[A].messages.push(M('a92', 'in', NOW + 62e3, 'رسالة وأنت فوق'));
  await view.locator('[data-mid="a92"]').waitFor({ state: 'attached', timeout: 9000 });
  assert.ok(await page.evaluate(() => { const m = document.querySelector('#waMsgs'); return m.scrollHeight - m.scrollTop - m.clientHeight > 100; }), tag + ' scrolled-up reader is not moved to the bottom');
  if (vp.touch) { await view.locator('[data-wa-back]').click(); await view.locator(`[data-conv="${B}"]`).waitFor(); }

  // 3) another chat gets a customer message while A is open (desktop) / the list is open (mobile): list row + badges live; toast on desktop only
  const tab0 = await tabBadge();
  data[B].messages.push(M('b3', 'in', NOW + 70e3, 'محتاج روشتة ضغط'));
  await page.waitForFunction((id) => { const r = document.querySelector(`[data-conv="${id}"]`); return r && r.textContent.includes('محتاج روشتة ضغط') && r.querySelector('[data-unread]'); }, B, { timeout: 9000 });
  assert.equal(await unreadOf(B), '1', tag + ' unread badge on B');
  assert.equal(await tabBadge(), String(Number(tab0 || 0) + 1), tag + ' tab badge +1');
  assert.equal(await hdrBadge(), await tabBadge(), tag + ' #novaWaBtn badge = live count');
  if (!vp.touch) {
    const ts = await toast();
    assert.ok(ts && ts.chat === B && /رسالة جديدة من سعيد/.test(ts.text) && /محتاج روشتة ضغط/.test(ts.text), tag + ' Arabic toast for the other chat ' + JSON.stringify(ts));
    const bb = await page.locator('#novaWaToast').boundingBox();
    assert.ok(bb.x >= 0 && bb.x + bb.width <= vp.width + 0.5 && bb.height >= 44, 'toast on screen ' + JSON.stringify(bb));
    await page.locator('#novaWaToast [data-wa-toast-x]').click();
    assert.equal(await toast(), null, 'toast closes');
  } else assert.equal(await toast(), null, tag + ' list on screen => the row itself updates, no toast');

  // 4) user on another screen: poll slows to 15s but keeps badges + toast live; clicking the toast opens the chat
  await page.evaluate(() => document.querySelector('.nova-nav .nova-tab[data-page="products"]').click()); // same handler as a tap (the mobile strip may scroll it off-screen)
  await page.waitForFunction(() => document.getElementById('novaInboxView').hidden);
  assert.equal(await page.evaluate(() => window.NovaWaNotify.delay()), 15000, tag + ' 15s poll on another screen');
  data[A].messages.push(M('a93', 'in', NOW + 80e3, 'سؤال عن جرعة'));
  const p0 = await page.evaluate(() => window.NovaWaNotify.polls());
  await page.evaluate(() => window.NovaWaNotify.poll());
  await page.waitForFunction((id) => { const e = document.getElementById('novaWaToast'); return e && !e.hidden && e.dataset.chat === id; }, A, { timeout: 5000 });
  assert.ok((await page.evaluate(() => window.NovaWaNotify.polls())) > p0);
  assert.match((await toast()).text, /سؤال عن جرعة/);
  assert.equal(await hdrBadge(), await tabBadge(), tag + ' header badge live from another screen');
  assert.ok(Number(await hdrBadge()) >= 2, tag + ' header badge counts A and B');
  await page.locator('#novaWaToast [data-wa-toast-open]').click();
  await view.locator('[data-mid="a93"]').waitFor();
  assert.equal(await page.evaluate(() => document.getElementById('novaInboxView').hidden), false, 'toast click opens conversations');

  // 5) background tab: Notification granted + no Web Push => slow 30s poll + browser Notification; no Notification API => paused, no crash
  await page.evaluate(() => { window.__t.perm = 'granted'; });
  await page.evaluate(() => window.__bg(true));
  const dHidden = await page.evaluate(() => window.NovaWaNotify.delay());
  data[B].messages.push(M('b4', 'in', NOW + 90e3, 'هل الدواء متوفر؟'));
  await page.evaluate(() => window.NovaWaNotify.poll());
  await page.waitForTimeout(500);
  const t5 = await T();
  if (noNotif) {
    assert.equal(dHidden, null, tag + ' hidden tab => poll paused');
    assert.equal(await page.evaluate(() => typeof window.Notification), 'undefined', 'fallback run has no Notification API');
    assert.equal(t5.sys.length, 0);
  } else {
    assert.equal(dHidden, 30000, tag + ' hidden + granted without push => 30s');
    assert.equal(t5.sys.length, 1, tag + ' one browser Notification');
    assert.equal(t5.sys[0].title, 'رسالة جديدة من سعيد (تجربة)');
    assert.ok(!/2010000004/.test(t5.sys[0].title + t5.sys[0].tag), 'no phone in title/tag');
  }
  await page.evaluate(() => window.__bg(false));
  await page.evaluate(() => { window.__t.perm = 'default'; });
  if (noNotif) { await page.waitForFunction((id) => document.querySelector(`[data-conv="${id}"] [data-unread]`) || document.querySelector('[data-mid="b4"]'), B, { timeout: 9000 }); }
  if (!noNotif) {
    // 6) poll hidden without permission => paused
    await page.evaluate(() => window.__bg(true));
    assert.equal(await page.evaluate(() => window.NovaWaNotify.delay()), null, tag + ' hidden, no permission => paused');
    await page.evaluate(() => window.__bg(false));
    assert.equal(await page.evaluate(() => window.NovaWaNotify.delay()), 4000, 'resumes on visibilitychange');
    // 7) backoff on errors
    fail = true;
    await page.evaluate(() => window.NovaWaNotify.poll());
    await page.evaluate(() => window.NovaWaNotify.poll());
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => window.NovaWaNotify.delay());
    assert.ok(d >= 8000 && d <= 60000, tag + ' backoff after errors: ' + d);
    fail = false;
    await page.evaluate(() => window.NovaWaNotify.poll());
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.NovaWaNotify.delay()), 4000, 'recovers after a good poll');
  }

  await page.waitForTimeout(300);
  await page.screenshot({ path: `tests/ux/__screenshots__/ux402-${vp.name}${noNotif ? '-nonotif' : ''}.png` });
  assert.equal(await page.evaluate(() => window.__marker), 'same-document', tag + ' never reloaded');
  assert.equal((await T()).reloads, 0, 'no location.reload');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
  assert.deepEqual(other, [], 'no non-GET request');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('ok', tag, JSON.stringify({ listPolls: hits.list, toasts: await page.evaluate(() => window.NovaWaNotify.stats.toasts), sys: (await T()).sys.length }));
  await ctx.close();
}
for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) await run(vp, false);
await run({ width: 1366, height: 768, name: 'desktop', touch: false }, true);
await browser.close();
console.log('ux402-wa-realtime OK');
