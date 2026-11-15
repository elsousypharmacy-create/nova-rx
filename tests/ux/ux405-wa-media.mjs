// UX405: incoming WhatsApp media in the conversations screen, like WhatsApp: image/sticker thumbnails (tap = fullscreen lightbox),
// audio + video players, document chip, Arabic fallback card when only metadata exists (too_large / fetch_failed) or the bytes
// fail to load. 1366x768 desktop + 390x844 mobile, fake data only: history + media API answered inside the browser by page.route;
// every non-GET is aborted and must stay at zero. No WhatsApp send, no PIN, no live customer.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux405-wa-media.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const CID = 'wa_201000000405';
// 2x2 PNG (fixture bytes, not a customer file)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const M = (id, type, extra, text, k = 0) => ({ id, dir: 'in', kind: 'in', text, at: NOW - (20 - k) * 60000, status: null, media: { type, mime: null, filename: null, size: null, skipped: null, caption: null, cached: true, ...extra } });
const msgs = [
  { id: 't0', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 21 * 60000, status: null },
  M('wa_img1', 'image', { mime: 'image/png', caption: 'دي الروشتة' }, '[صورة] دي الروشتة', 1),
  M('wa_img2', 'image', { mime: 'image/png' }, '[صورة]', 2),
  M('wa_stk1', 'sticker', { mime: 'image/png' }, '[ملصق]', 3),
  M('wa_aud1', 'audio', { mime: 'audio/ogg' }, '[رسالة صوتية]', 4),
  M('wa_vid1', 'video', { mime: 'video/mp4' }, '[فيديو]', 5),
  M('wa_doc1', 'document', { mime: 'application/pdf', filename: 'تحاليل-الدم.pdf', size: 245760 }, '[مستند] تحاليل-الدم.pdf', 6),
  M('wa_big1', 'image', { mime: 'image/jpeg', size: 7340032, skipped: 'too_large', cached: false }, '[صورة]', 7),
  M('wa_ff1', 'video', { mime: 'video/mp4', skipped: 'fetch_failed', cached: false }, '[فيديو]', 8),
  M('wa_gone', 'image', { mime: 'image/png' }, '[صورة]', 9), // cached flag set but KV expired -> 404 -> fallback
  { id: 't9', dir: 'out', kind: 'bot', text: 'تمام، وصلت', at: NOW - 60000, status: 'read' },
];
const conv = { id: CID, customer: 'عميل تجربة', updatedAt: NOW - 60000, count: msgs.length, last: msgs[9] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const report = {};

for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
  const other = [], media = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type,accept' } });
      const id = new URL(u).searchParams.get('id');
      if (u.includes('/history/media')) {
        media.push(id);
        const ok = { wa_img1: 'image/png', wa_img2: 'image/png', wa_stk1: 'image/png', wa_aud1: 'audio/ogg', wa_vid1: 'video/mp4', wa_doc1: 'application/pdf' }[id];
        if (id === 'wa_vid1') return new Promise(() => {}); // fixture has no real mp4: keep the metadata request pending (a broken file would show the fallback)
        if (!ok) return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'MEDIA_UNAVAILABLE', message_ar: 'الملف مش متاح هنا.' }) });
        return r.fulfill({ status: 200, headers: cors, contentType: ok, body: ok.startsWith('image/') ? PNG : Buffer.from([0, 0, 0]) });
      }
      const body = u.includes('/conversations') ? { ok: true, conversations: [conv] } : { ok: true, conversation: { id, customer: conv.customer, updatedAt: NOW, messages: msgs } };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${CID}"]`).waitFor();
  // list preview: media label ("صورة"), never the raw bracket placeholder
  const pv = await view.locator(`[data-conv="${CID}"] .wa-preview`).textContent();
  await view.locator(`[data-conv="${CID}"]`).click();
  await view.locator('[data-mid="wa_img1"] img[data-wa-mimg]').waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('[data-mid="wa_img1"] img'); return i && i.complete && i.naturalWidth > 0; });
  await page.waitForFunction(() => document.querySelector('[data-mid="wa_gone"] [data-wa-media-miss]'), null, { timeout: 5000 });
  const st = await page.evaluate(() => {
    const q = (s) => document.querySelector(s), box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const raw = [...document.querySelectorAll('#waMsgs [data-media] .wa-text')].map((e) => e.textContent).filter((t) => /\[(صورة|ملصق|فيديو|مستند|رسالة صوتية)\]/.test(t));
    return {
      img1: box('[data-mid="wa_img1"] .wa-m-image'), img1Cap: q('[data-mid="wa_img1"] .wa-text') && q('[data-mid="wa_img1"] .wa-text').textContent,
      img2Only: !!q('[data-mid="wa_img2"] .wa-bubble.wa-mo-ov') && !q('[data-mid="wa_img2"] .wa-text'),
      sticker: box('[data-mid="wa_stk1"] .wa-m-sticker img'), stickerBg: getComputedStyle(q('[data-mid="wa_stk1"] .wa-bubble')).backgroundColor,
      audio: !!q('[data-mid="wa_aud1"] audio[controls]'), video: !!q('[data-mid="wa_vid1"] video[controls]'),
      doc: q('[data-mid="wa_doc1"] a.wa-mdoc') && { name: q('[data-mid="wa_doc1"] .wa-mdoc-t b').textContent, sub: q('[data-mid="wa_doc1"] .wa-mdoc-t span').textContent, href: q('[data-mid="wa_doc1"] a.wa-mdoc').getAttribute('href'), dl: q('[data-mid="wa_doc1"] a.wa-mdoc').getAttribute('download') },
      big: q('[data-mid="wa_big1"] [data-wa-media-miss]') && q('[data-mid="wa_big1"] [data-wa-media-miss]').textContent, bigImg: !!q('[data-mid="wa_big1"] img'),
      ff: q('[data-mid="wa_ff1"] [data-wa-media-miss]') && q('[data-mid="wa_ff1"] [data-wa-media-miss]').dataset.reason,
      gone: !!q('[data-mid="wa_gone"] [data-wa-media-miss]') && !q('[data-mid="wa_gone"] .wa-mo-ov'), raw, rtl: q('.wa-root').getAttribute('dir'),
      overflow: [...document.querySelectorAll('#waMsgs .wa-bubble')].some((b) => b.getBoundingClientRect().width > document.getElementById('waMsgs').clientWidth),
    };
  });
  assert.ok(st.img1 && st.img1.w >= 200 && st.img1.h >= 200, 'image thumbnail ' + JSON.stringify(st.img1));
  assert.equal(st.img1Cap, 'دي الروشتة', 'caption under the image, without the [صورة] placeholder');
  assert.ok(st.img2Only, 'caption-less image = media-only bubble with the time over the image');
  assert.ok(st.sticker && st.sticker.w === 150 && st.sticker.h === 150, 'sticker 150x150'); assert.equal(st.stickerBg, 'rgba(0, 0, 0, 0)', 'sticker has no bubble background');
  assert.ok(st.audio, 'audio player'); assert.ok(st.video, 'video player');
  assert.ok(st.doc && st.doc.name === 'تحاليل-الدم.pdf' && /240 ك\.ب/.test(st.doc.sub) && /media\?id=wa_doc1$/.test(st.doc.href) && st.doc.dl === 'تحاليل-الدم.pdf', 'document chip ' + JSON.stringify(st.doc));
  assert.ok(st.big && /5 ميجا/.test(st.big) && !st.bigImg, 'too_large fallback card (Arabic), no broken image');
  assert.equal(st.ff, 'fetch_failed');
  assert.ok(st.gone, 'KV miss (404) swaps the thumbnail for the fallback card');
  assert.deepEqual(st.raw, [], 'no raw «[صورة]» placeholders in media bubbles');
  assert.equal(st.rtl, 'rtl'); assert.equal(st.overflow, false, 'media bubbles fit the thread width');
  assert.ok(!media.includes('wa_big1') && !media.includes('wa_ff1'), 'metadata-only media are never requested');
  // lightbox: tap image -> fullscreen, focus on close, Esc closes and returns focus; backdrop tap closes; double-click zooms
  await view.locator('[data-mid="wa_img1"] [data-wa-media-open]').click();
  const lb = page.locator('[data-wa-lightbox]');
  await lb.waitFor();
  const lbs = await page.evaluate(() => { const l = document.querySelector('[data-wa-lightbox]'), r = l.getBoundingClientRect(), i = l.querySelector('[data-wa-lb-img]');
    return { full: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, modal: l.getAttribute('aria-modal'), focus: document.activeElement && document.activeElement.hasAttribute('data-wa-lb-close'), src: i.getAttribute('src'), dl: !!l.querySelector('[data-wa-lb-dl]') }; });
  assert.ok(lbs.full && lbs.modal === 'true' && lbs.focus && /media\?id=wa_img1$/.test(lbs.src) && lbs.dl, 'fullscreen lightbox ' + JSON.stringify(lbs));
  if (!vp.touch) {
    await page.locator('[data-wa-lb-img]').dblclick();
    assert.equal(await lb.getAttribute('data-zoom'), '1', 'double-click zooms');
    await page.locator('[data-wa-lb-img]').dblclick();
  }
  await page.keyboard.press('Escape');
  await lb.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-wa-mid')), 'wa_img1', 'focus returns to the thumbnail');
  await view.locator('[data-mid="wa_stk1"] [data-wa-media-open]').click();
  await lb.waitFor();
  if (vp.touch) {
    // swipe down closes (WhatsApp gesture)
    await page.evaluate(() => { const l = document.querySelector('[data-wa-lightbox]'), t = (y) => new Touch({ identifier: 1, target: l, clientX: 195, clientY: y });
      l.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], bubbles: true })); l.dispatchEvent(new TouchEvent('touchmove', { touches: [t(460)], bubbles: true })); l.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); });
  } else await page.locator('[data-wa-lb-close]').click();
  await lb.waitFor({ state: 'detached' });
  // still a normal chat after redraws: the failed thumbnail stays a fallback (no retry loop)
  const n0 = media.filter((x) => x === 'wa_gone').length;
  await page.evaluate(() => document.getElementById('waMsgs').dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(300);
  assert.ok(media.filter((x) => x === 'wa_gone').length <= n0 + 0, 'no retry loop for a failed media');
  assert.deepEqual(other, [], 'no non-GET requests'); assert.deepEqual(errors, [], 'no page errors');
  report[vp.name] = { preview: pv, img: st.img1, sticker: st.sticker, doc: st.doc && st.doc.sub, mediaRequests: media.length };
  assert.ok(!/\[/.test(pv), 'list preview has no raw placeholder: ' + pv);
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = m.scrollHeight; });
  await page.screenshot({ path: `/tmp/ux405-${vp.name}.png` });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
console.log('ux405-wa-media OK');
