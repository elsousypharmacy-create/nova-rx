// UX418: photos in the chat no longer change size/jump while they load. Fake data only; /media answers slowly on purpose.
// First visit (size unknown): a 3:4 placeholder, then the real box, and the reading position is kept.
// Next visits (size remembered): the box is already the final size BEFORE the photo arrives (zero shift).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux418-image-no-shift.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const origin = new URL(BASE).origin;
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-19T21:17:00+03:00'), M = 60e3;
const svg = (w, h, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${c}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#fff"/></svg>`;
const IMG = { tall: svg(600, 900, '#4a90a4'), wide: svg(900, 450, '#a4684a'), square: svg(500, 500, '#6a4aa4'), small: svg(120, 90, '#4aa46a') };
const mk = (id, kind, at, who = 'in') => ({ id, dir: who, kind: who === 'in' ? 'in' : 'pharm', text: '[صورة]', at, media: { type: 'image', cached: true } });
const msgs = [{ id: 't0', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 100 * M }, mk('tall', 'tall', NOW - 90 * M), mk('wide', 'wide', NOW - 80 * M), { id: 't1', dir: 'out', kind: 'pharm', text: 'تمام', at: NOW - 75 * M, status: 'read' }, mk('square', 'square', NOW - 70 * M), mk('small', 'small', NOW - 60 * M), ...Array.from({ length: 16 }, (_, i) => ({ id: 'f' + i, dir: i % 2 ? 'out' : 'in', kind: i % 2 ? 'pharm' : 'in', text: 'رسالة عادية رقم ' + i + ' بعد الصور', at: NOW - (59 - i) * M, status: i % 2 ? 'read' : null })), { id: 't2', dir: 'in', kind: 'in', text: 'آخر رسالة', at: NOW - 30 * M }];
const list = [{ id: 'wa_1', customer: 'منى حسن', updatedAt: msgs.at(-1).at, count: msgs.length, last: msgs.at(-1) }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };

async function visit(ctx, { release }) {
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let gate = null; const held = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.route('**/*', async (r) => {
    const u = r.request().url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (u.includes('/api/v1/inbox/history/')) {
      const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.includes('/media?')) { const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]); held.push(id); await new Promise((res) => { gate = gate || new Promise((x) => { page.__open = x; }); gate.then(res); }); return r.fulfill({ status: 200, headers: cors, contentType: 'image/svg+xml', body: IMG[id] }); }
      if (u.includes('/send-media')) return j({ ok: true, enabled: false });
      if (u.includes('/conversations')) return j({ ok: true, conversations: list });
      if (u.includes('/conversation?')) return j({ ok: true, conversation: { id: 'wa_1', customer: 'منى حسن', updatedAt: NOW, messages: msgs } });
      return j({ ok: true });
    }
    return u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(400);
  await page.locator('#novaWaBtn').click(); await page.locator('[data-conv="wa_1"]').click(); await page.locator('#waMsgs .wa-msg').first().waitFor(); await page.waitForTimeout(500);
  return { page, errors, held, open: () => page.__open && page.__open() };
}
const geo = (page) => page.evaluate(() => { const ms = document.getElementById('waMsgs'), mr = ms.getBoundingClientRect(); const last = [...ms.querySelectorAll('.wa-msg')].pop().getBoundingClientRect(); return { imgs: [...ms.querySelectorAll('img.wa-mimg')].map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), lastBottom: Math.round(mr.bottom - last.bottom), top: ms.scrollTop, sh: ms.scrollHeight, atEnd: ms.scrollHeight - ms.scrollTop - ms.clientHeight < 4 }; });
const mkctx = () => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, locale: 'ar-EG', serviceWorkers: 'block' });

{ // FIRST visit: nothing remembered
  const ctx = await mkctx(); const v = await visit(ctx, {});
  const before = await geo(v.page);
  assert.equal(before.imgs.length, 4); assert.ok(before.imgs.every((s) => Math.abs(s[0] / s[1] - 0.75) < 0.02 && s[0] >= 200), 'placeholders are 3:4 boxes: ' + JSON.stringify(before.imgs));
  assert.ok(before.atEnd, 'opened at the newest message'); if (SHOTS) await v.page.screenshot({ path: SHOTS + '/ux418-before-load.png' });
  v.open(); await v.page.waitForFunction(() => [...document.querySelectorAll('img.wa-mimg')].every((i) => i.complete && i.naturalWidth > 0)); await v.page.waitForTimeout(500);
  const after = await geo(v.page);
  const want = [[200, 300], [300, 150], [300, 300], [120, 90]];
  const r = (a) => a.map((x) => x.map(Math.round));
  assert.ok(Math.abs(after.imgs[0][0] / after.imgs[0][1] - 0.75) < 0.02, 'a tall 2:3 photo is cropped to 3:4 like WhatsApp: ' + after.imgs[0]); assert.ok(after.imgs.every((s) => Math.abs(s[0] - after.imgs[0][0]) <= 1), 'every photo has the same bubble width: ' + JSON.stringify(after.imgs));
  assert.ok(Math.abs(after.imgs[1][0] / after.imgs[1][1] - 1.78) < 0.05, 'a 2:1 panorama is cropped to 16:9: ' + after.imgs[1]); assert.ok(Math.abs(after.imgs[2][0] / after.imgs[2][1] - 1) < 0.05, 'square keeps 1:1'); assert.ok(Math.abs(after.imgs[3][0] / after.imgs[3][1] - 4 / 3) < 0.02, 'a small 4:3 photo keeps 4:3 at bubble width: ' + after.imgs[3]);
  assert.ok(after.atEnd, 'still at the newest message after the photos arrived'); assert.ok(Math.abs(after.lastBottom - before.lastBottom) <= 2, 'the last message did not move: ' + before.lastBottom + ' -> ' + after.lastBottom);
  if (SHOTS) await v.page.screenshot({ path: SHOTS + '/ux418-after-load.png' });
  const stored = await v.page.evaluate(() => JSON.parse(localStorage.getItem('nova.wa.dims') || '{}')); assert.deepEqual(stored.tall, [600, 900]); assert.deepEqual(stored.small, [120, 90]);
  assert.deepEqual(v.errors, []); ok('first visit: placeholders, real proportions after load, bottom stays pinned, sizes remembered'); 
  // SECOND visit in the same browser profile: sizes known up front
  await v.page.close(); const v2 = await visit(ctx, {});
  const b2 = await geo(v2.page); assert.deepEqual(b2.imgs.map((s) => s.map(Math.round)), after.imgs.map((s) => s.map(Math.round)), 'before the photos even arrive the boxes already have their final size: ' + JSON.stringify(b2.imgs));
  v2.open(); await v2.page.waitForFunction(() => [...document.querySelectorAll('img.wa-mimg')].every((i) => i.complete && i.naturalWidth > 0)); await v2.page.waitForTimeout(400);
  const a2 = await geo(v2.page); assert.deepEqual(a2.imgs, b2.imgs, 'zero change when the photos arrive'); assert.equal(a2.sh, b2.sh, 'the chat did not get taller or shorter'); assert.equal(a2.lastBottom, b2.lastBottom);
  assert.deepEqual(v2.errors, []); ok('next visit: boxes are already final before the photos arrive; nothing moves when they do'); await ctx.close();
}
{ // reading position: scrolled up with a photo ABOVE the screen loading later
  const ctx = await mkctx(); const v = await visit(ctx, {});
  await v.page.evaluate(() => { const ms = document.getElementById('waMsgs'); const target = document.querySelector('#waMsgs [data-mid="t1"]'); ms.scrollTop = target.offsetTop - 120; });
  await v.page.waitForTimeout(250);
  const anchor = () => v.page.evaluate(() => { const t = document.querySelector('#waMsgs [data-mid="t1"]'), ms = document.getElementById('waMsgs'); return Math.round(t.getBoundingClientRect().top - ms.getBoundingClientRect().top); });
  const y0 = await anchor(); v.open(); await v.page.waitForFunction(() => [...document.querySelectorAll('img.wa-mimg')].every((i) => i.complete && i.naturalWidth > 0)); await v.page.waitForTimeout(500);
  const y1 = await anchor(); assert.ok(Math.abs(y1 - y0) <= 3, 'the message being read did not jump: ' + y0 + ' -> ' + y1); await ctx.close(); ok('scrolled up: photos loading above do not move the message being read');
}
{ // a photo that finishes loading LATE (after any redraw) while the reader is scrolled up: the page itself keeps the message being read in place
  const ctx = await mkctx(); const v = await visit(ctx, {});
  await v.page.evaluate(() => { const ms = document.getElementById('waMsgs'); ms.scrollTop = document.querySelector('#waMsgs [data-mid="t1"]').offsetTop - 120; });
  await v.page.waitForTimeout(250);
  const r = await v.page.evaluate(() => { const ms = document.getElementById('waMsgs'); ms.style.overflowAnchor = 'none'; /* iOS Safari has no scroll anchoring: switch Chromium's off so only the page's own code can keep the position */ const t = () => Math.round(document.querySelector('#waMsgs [data-mid="t1"]').getBoundingClientRect().top - ms.getBoundingClientRect().top);
    const img = document.querySelector('img[data-wa-mid="wide"]'), h0 = img.getBoundingClientRect().height, y0 = t();
    Object.defineProperty(img, 'currentSrc', { value: 'blob:fake' }); Object.defineProperty(img, 'naturalWidth', { value: 900 }); Object.defineProperty(img, 'naturalHeight', { value: 450 });
    img.dispatchEvent(new Event('load')); return { y0, y1: t(), h0: Math.round(h0), h1: Math.round(img.getBoundingClientRect().height), cls: img.className }; });
  assert.ok(r.h0 - r.h1 > 100 && /wa-dim/.test(r.cls), 'the late photo really changed the layout: ' + JSON.stringify(r)); assert.ok(Math.abs(r.y1 - r.y0) <= 3, 'the message being read stayed put: ' + r.y0 + ' -> ' + r.y1);
  await ctx.close(); ok('a photo that loads late while scrolled up: the message being read stays put');
}
await browser.close();
console.log(`PASS ux418 image no shift: ${n} groups`);
