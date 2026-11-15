// UX407: owner's iPhone tests 16:18–16:24 (.nova/inbox/ux407-nova-keyboard-gap.png vs ux407-whatsapp-real-keyboard.png).
// 390x844 mobile emulation (+ 1366x768 desktop), fake data only: the history API is answered by page.route; the only non-GET allowed is
// the mocked POST history/send (fulfilled locally); every other non-GET is aborted and must stay at zero. No WhatsApp send, no PIN.
// Checks: stored «👨‍⚕️ رد الصيدلي:» prefix never shown inside bubbles (only the real text, labelled الصيدلي); no dedupe (every row
// rendered); outgoing staff bubbles RIGHT (green, ticks) / incoming customer LEFT under RTL; composer is not a <form>; with a mocked
// iOS-like visualViewport keyboard (offsetTop > 0) the composer sits flush on the visual viewport bottom (no ~60px band), safe-area
// padding dropped, every other field unfocusable while typing and restored on blur; focused composer has no outline / box-shadow /
// focus-visible ring and a transparent tap highlight; Enter and the send button both send (mocked).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux407-wa-composer.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T16:22:00+03:00');
const ID = 'wa_201000000407', P = '\u{1F468}‍⚕️';
const msgs = [
  { id: 'k1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 9 * 3600e3, status: null },
  { id: 'k2', dir: 'out', kind: 'pharm', text: P + ' رد الصيدلي:\n\nاهلا', at: NOW - 8 * 3600e3, status: 'read' },
  { id: 'k3', dir: 'out', kind: 'pharm', text: 'Bbsjd', at: NOW - 7 * 3600e3, status: 'delivered' },
  { id: 'k4', dir: 'out', kind: 'bot', text: P + ' رد الصيدلي:\n\nاهلا', at: NOW - 240000, status: 'sent' },
  { id: 'k5', dir: 'out', kind: 'pharm', text: 'اهلا', at: NOW - 240000, status: 'sent' },
  { id: 'k6', dir: 'out', kind: 'pharm', text: P + ' رد الدكتور:\nتمام', at: NOW - 200000, status: 'read' },
  { id: 'k7', dir: 'in', kind: 'in', text: 'شكرا', at: NOW - 100000, status: null },
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

async function setup(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
  const st = { sends: [], other: [] };
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/')) {
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,accept' } });
      if (q.method() === 'POST' && u.endsWith('/send')) {
        const b = JSON.parse(q.postData() || '{}'); st.sends.push(b);
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 'ps_' + st.sends.length, dir: 'out', kind: 'pharm', text: b.text, at: NOW + st.sends.length, status: 'sent' } }) });
      }
      if (q.method() !== 'GET') { st.other.push(q.method() + ' ' + u); return r.abort(); }
      const body = u.includes('/conversations') ? { ok: true, conversations: [{ id: ID, customer: 'دكتور احمد', updatedAt: NOW - 100000, count: msgs.length, last: msgs[msgs.length - 1] }] }
        : { ok: true, conversation: { id: ID, customer: 'دكتور احمد', updatedAt: NOW, messages: msgs } };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  // iOS-like keyboard: the visual viewport shrinks AND is scrolled down inside the layout viewport (offsetTop > 0)
  await ctx.addInitScript(() => {
    const t = new EventTarget(); let h = innerHeight, top = 0;
    const vv = { get height() { return h; }, get width() { return innerWidth; }, get offsetTop() { return top; }, offsetLeft: 0, get pageTop() { return scrollY + top; }, pageLeft: 0, scale: 1,
      addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t) };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__kb = (px, off) => { h = px ? innerHeight - px : innerHeight; top = px ? (off || 0) : 0; t.dispatchEvent(new Event('resize')); };
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${ID}"]`).click();
  await view.locator('[data-mid="k7"]').waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  return { ctx, page, view, st, errors };
}

const report = {};
for (const vp of [{ width: 390, height: 844, name: 'mobile', touch: true }, { width: 1366, height: 768, name: 'desktop', touch: false }]) {
  const r = report[vp.name] = {};
  const { ctx, page, view, st, errors } = await setup(vp);

  // 1) prefix: bubbles show only the real message, labelled الصيدلي; nothing deduped
  const bub = await page.evaluate(() => [...document.querySelectorAll('#waMsgs .wa-msg')].map((m) => { const b = m.querySelector('.wa-bubble').getBoundingClientRect(), w = m.querySelector('.wa-who');
    return { id: m.dataset.mid, dir: m.dataset.dir, all: m.querySelector('.wa-bubble').textContent, text: m.querySelector('.wa-text').textContent, who: w ? w.textContent : '', cx: b.left + b.width / 2, left: b.left, right: b.right,
      bg: getComputedStyle(m.querySelector('.wa-bubble')).backgroundColor, tick: !!m.querySelector('.wa-tick') }; }));
  assert.deepEqual(bub.map((b) => b.id), msgs.map((m) => m.id), 'every stored row rendered once (no dedupe/merge)');
  for (const b of bub) { assert.ok(!b.all.includes('رد الصيدلي') && !b.all.includes('رد الدكتور') && !b.all.includes('\u{1F468}') && !b.all.includes('⚕'), 'no prefix in bubble ' + b.id + ': ' + JSON.stringify(b.all)); }
  const by = Object.fromEntries(bub.map((b) => [b.id, b]));
  assert.equal(by.k2.text, 'اهلا'); assert.equal(by.k4.text, 'اهلا'); assert.equal(by.k6.text, 'تمام'); assert.equal(by.k2.who, 'الصيدلي'); assert.equal(by.k4.who, 'الصيدلي', 'prefixed bot-path reply labelled pharmacist');
  const pv = await view.locator(`[data-conv="${ID}"] .wa-preview`).textContent();
  assert.ok(!pv.includes('رد الصيدلي'), 'list preview without prefix');

  // 2) sides under RTL: outgoing right (green + ticks), incoming left
  const mid = await page.evaluate(() => { const m = document.getElementById('waMsgs').getBoundingClientRect(); return m.left + m.width / 2; });
  for (const b of bub) {
    if (b.dir === 'out') { assert.ok(b.cx > mid, 'outgoing on the RIGHT ' + b.id); assert.equal(b.bg, 'rgb(15, 74, 60)'); assert.ok(b.tick, 'ticks on outgoing ' + b.id); }
    else { assert.ok(b.cx < mid, 'incoming on the LEFT ' + b.id); assert.equal(b.bg, 'rgb(31, 37, 44)'); assert.ok(!b.tick); }
  }
  assert.equal(await page.evaluate(() => document.querySelector('.wa-root').getAttribute('dir') + getComputedStyle(document.querySelector('.wa-root')).direction), 'rtlrtl');
  r.sides = 'out right / in left';

  // composer structure: no <form>, single text input inside
  assert.equal(await page.evaluate(() => document.querySelector('[data-wa-composer]').tagName + ':' + !!document.querySelector('[data-wa-composer]').closest('form') + ':' + document.querySelectorAll('[data-wa-composer] input,[data-wa-composer] textarea').length), 'DIV:false:1');

  // 4) focused composer: no outline, no box-shadow, no focus-visible ring, transparent tap highlight
  const input = view.locator('#waInput');
  if (vp.touch) await input.tap(); else await input.click();
  await page.keyboard.type('ا'); await page.keyboard.press('Backspace');
  const fs = await page.evaluate(() => { const i = document.getElementById('waInput'), c = getComputedStyle(i);
    return { active: document.activeElement === i, fv: i.matches(':focus-visible'), ow: c.outlineWidth, os: c.outlineStyle, bs: c.boxShadow, tap: c.webkitTapHighlightColor, pillTap: getComputedStyle(i.closest('.wa-pill')).webkitTapHighlightColor }; });
  assert.ok(fs.active, 'composer focused');
  assert.ok(fs.os === 'none' || fs.ow === '0px', 'no outline on the focused composer ' + JSON.stringify(fs));
  assert.equal(fs.bs, 'none', 'no box-shadow on the focused composer');
  assert.equal(fs.tap, 'rgba(0, 0, 0, 0)'); assert.equal(fs.pillTap, 'rgba(0, 0, 0, 0)');
  await input.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const fs2 = await page.evaluate(() => { const i = document.getElementById('waInput'), c = getComputedStyle(i); return { active: document.activeElement === i, fv: i.matches(':focus-visible'), os: c.outlineStyle, ow: c.outlineWidth, bs: c.boxShadow }; });
  if (fs2.active) { assert.ok(fs2.os === 'none' || fs2.ow === '0px', 'no keyboard focus-visible ring ' + JSON.stringify(fs2)); assert.equal(fs2.bs, 'none'); }
  r.focus = fs;

  // 3) mocked iOS keyboard: composer flush on the visual viewport bottom (also with offsetTop > 0), no other focusable field
  if (vp.touch) {
    // headless Chrome has env(safe-area-inset-bottom)=0: simulate the iPhone home-indicator padding (8px + 34px) the way the CSS adds it
    await input.blur(); await page.waitForTimeout(120);
    await page.addStyleTag({ content: '.wa-main>.wa-composer{padding-bottom:42px}' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-wa-composer]')).paddingBottom), '42px');
    await input.focus();
    for (const [kb, off] of [[336, 0], [336, 60], [300, 120]]) {
      await page.evaluate(([a, b]) => window.__kb(a, b), [kb, off]); await page.waitForTimeout(120);
      const g = await page.evaluate(() => { const c = document.querySelector('[data-wa-composer]'), b = c.getBoundingClientRect(), v = visualViewport, m = document.getElementById('waMsgs').getBoundingClientRect();
        return { bottom: b.bottom, vb: v.offsetTop + v.height, pad: getComputedStyle(c).paddingBottom, kbd: document.querySelector('.wa-root').hasAttribute('data-kbd'), msgsTop: m.top, msgsBottom: m.bottom, ctop: b.top,
          others: [...document.querySelectorAll('input,textarea,select')].filter((e) => e.id !== 'waInput' && !e.disabled && !e.inert && e.tabIndex >= 0 && !e.closest('[inert]') && e.getClientRects().length).map((e) => e.id || e.name || e.type) }; });
      assert.ok(Math.abs(g.bottom - g.vb) <= 1, `composer flush on the visual viewport bottom kb=${kb} off=${off}: ${g.bottom} vs ${g.vb}`);
      assert.ok(g.kbd && g.pad === '8px', 'safe-area padding dropped while typing ' + g.pad);
      assert.ok(g.msgsBottom <= g.ctop + 1, 'thread above the composer');
      assert.deepEqual(g.others, [], 'no other focusable form field while the composer is focused');
      r['kb' + kb + '_' + off] = Math.round(g.vb - g.bottom);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux407-keyboard-${vp.name}.png` });
    await page.evaluate(() => window.__kb(0)); await input.blur(); await page.waitForTimeout(150);
    const back = await page.evaluate(() => ({ locked: document.querySelectorAll('[data-wa-kbd-off]').length, kbd: document.querySelector('.wa-root').hasAttribute('data-kbd'), h: document.querySelector('.wa-root').style.height,
      inertInputs: [...document.querySelectorAll('input,textarea,select')].filter((e) => e.inert).length }));
    assert.deepEqual(back, { locked: 0, kbd: false, h: '', inertInputs: 0 }, 'fields restored and fit reset after blur');
  }

  // send still works without a form: Enter and the button (mocked POST only)
  await input.fill('تمام يا فندم'); await input.press('Enter');
  await view.locator('[data-mid="ps_1"]').waitFor();
  await input.fill('متوفر'); await view.locator('[data-wa-send]').click();
  await view.locator('[data-mid="ps_2"]').waitFor();
  assert.deepEqual(st.sends.map((s) => s.text), ['تمام يا فندم', 'متوفر']);
  const sent = await page.evaluate(() => { const m = document.querySelector('[data-mid="ps_2"] .wa-bubble').getBoundingClientRect(), w = document.getElementById('waMsgs').getBoundingClientRect(); return m.left + m.width / 2 > w.left + w.width / 2; });
  assert.ok(sent, 'a new staff reply lands on the RIGHT');
  // search field still usable after typing (lock released)
  if (vp.touch) { await view.locator('[data-wa-back]').click(); }
  await view.locator('#waSearch').click(); assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'waSearch');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux407-${vp.name}.png` });

  assert.deepEqual(st.other, [], 'no non-GET requests except the mocked send');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
console.log('ux407-wa-composer OK');
