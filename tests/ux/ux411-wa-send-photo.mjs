// UX411: send a photo to a WhatsApp customer from the conversations screen (gallery / camera -> preview with caption -> send).
// Fake data only: every /inbox/history/ call is answered by page.route; the POST send-media is answered by a stub (NO real send).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux411-wa-send-photo.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T18:17:00+03:00'), H = 3600e3;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#e8eef2"/><rect x="60" y="50" width="780" height="90" rx="10" fill="#2f7f93"/><text x="450" y="110" font-size="48" text-anchor="middle" fill="#fff" font-family="sans-serif">Rx - Prescription</text><g fill="#52606b"><rect x="80" y="190" width="600" height="26"/><rect x="80" y="240" width="520" height="26"/><rect x="80" y="290" width="640" height="26"/><rect x="80" y="340" width="480" height="26"/></g><circle cx="740" cy="480" r="60" fill="#c0392b"/></svg>';
const CHAT = 'wa_201000000411';
const conv = { id: CHAT, customer: 'منى حسن', updatedAt: NOW - H, count: 1, last: { id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - H } };
const msgs = [{ id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - H }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

async function setup({ mediaOn, postReply }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });
  const st = { posts: [], other: [] };
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.includes('/api/v1/inbox/history/send-media') && q.method() === 'POST') { st.posts.push(JSON.parse(q.postData())); const rep = postReply(st.posts.length); return r.fulfill({ status: rep.status, headers: cors, contentType: 'application/json', body: JSON.stringify(rep.body) }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.includes('/send-media')) return j({ ok: true, enabled: mediaOn });
      if (u.includes('/media?')) return r.fulfill({ status: 200, headers: cors, contentType: 'image/svg+xml', body: PHOTO });
      if (u.includes('/conversations')) return j({ ok: true, conversations: [conv] });
      if (u.includes('/conversation?')) return j({ ok: true, conversation: { id: CHAT, customer: conv.customer, updatedAt: conv.updatedAt, messages: msgs } });
      return j({ ok: true });
    }
    return u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(400);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${CHAT}"]`).click();
  await view.locator('#waInput').waitFor(); await page.waitForTimeout(500);
  return { ctx, page, view, st, errors };
}
const vis = (view, sel) => view.locator(sel).first().isVisible();
const file = { name: 'rx.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(PHOTO) };
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux411-${n}.png` }); };
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };

{ // flag OFF: no dead buttons
  const { ctx, view, st, errors } = await setup({ mediaOn: false, postReply: () => ({ status: 500, body: {} }) });
  for (const k of ['attach', 'camera', 'mic']) assert.equal(await vis(view, `[data-wa-composer] [data-wa-${k}]`), false, k + ' hidden while photo sending is off');
  assert.equal(await view.locator('[data-wa-file]').count(), 0, 'no file inputs when off');
  assert.deepEqual(errors, []); assert.deepEqual(st.other, []); await ctx.close(); ok('flag off: + / camera / mic hidden, no file inputs');
}
{ // flag ON
  const { ctx, page, view, st, errors } = await setup({ mediaOn: true, postReply: (i) => i === 1 ? { status: 200, body: { ok: true, message: { id: 'ps_1', dir: 'out', kind: 'pharm', text: 'الروشتة', at: NOW, status: 'sent', media: { type: 'image', mime: 'image/jpeg', size: 1000, caption: 'الروشتة', cached: true } } } } : { status: 422, body: { ok: false, code: 'SEND_WINDOW_CLOSED', message_ar: 'الرسالة ما وصلتش: عدّى أكتر من 24 ساعة على آخر رسالة من العميل.' } } });
  assert.equal(await vis(view, '[data-wa-composer] [data-wa-attach]'), true, '+ visible'); assert.equal(await vis(view, '[data-wa-composer] [data-wa-camera]'), true, 'camera visible'); assert.equal(await vis(view, '[data-wa-composer] [data-wa-mic]'), false, 'mic still hidden (voice not built)');
  await view.locator('#waInput').fill('x'); assert.equal(await vis(view, '[data-wa-composer] [data-wa-camera]'), false, 'camera hides while typing'); await view.locator('#waInput').fill('');
  await shot(page, '1-composer');
  await view.locator('[data-wa-attach]').click();
  assert.equal(await view.locator('[data-wa-att]').count(), 2, 'menu: gallery + camera'); assert.equal(await view.locator('[data-wa-att="image"]').getAttribute('aria-disabled'), null);
  await shot(page, '2-menu'); await view.locator('[data-wa-attach]').click(); assert.equal(await view.locator('[data-wa-attach-menu]').isHidden(), true, 'menu closes');
  // cancel path: pick -> preview -> X -> nothing sent
  await view.locator('[data-wa-file]').setInputFiles(file);
  await page.locator('[data-wa-mp]').waitFor(); await page.waitForTimeout(300); await shot(page, '3-preview');
  assert.ok(await page.locator('[data-wa-mp-img]').evaluate((i) => i.naturalWidth > 0 && i.src.startsWith('data:image/jpeg')), 'preview shows the JPEG-converted photo');
  await page.locator('[data-wa-mp-x]').click(); assert.equal(await page.locator('[data-wa-mp]').count(), 0); assert.equal(st.posts.length, 0, 'cancel sends nothing'); ok('preview cancel sends nothing');
  // camera path uses the capture input
  assert.equal(await view.locator('[data-wa-file-cam]').getAttribute('capture'), 'environment');
  await view.locator('[data-wa-file-cam]').setInputFiles(file); await page.locator('[data-wa-mp]').waitFor(); await page.locator('[data-wa-mp-x]').click(); ok('camera input opens the same preview');
  // not an image -> error, no preview, no POST
  await view.locator('[data-wa-file]').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') });
  await page.waitForTimeout(300); assert.equal(await page.locator('[data-wa-mp]').count(), 0); assert.equal(st.posts.length, 0); assert.ok((await view.locator('[data-send-err]').textContent()).includes('مش صورة')); ok('non-image rejected before any request');
  // send with caption
  await view.locator('[data-wa-file]').setInputFiles(file); await page.locator('[data-wa-mp]').waitFor();
  await page.locator('[data-wa-mp-cap]').fill('الروشتة'); await page.locator('[data-wa-mp-send]').click();
  await page.waitForFunction(() => document.querySelectorAll('#waMsgs .wa-msg').length >= 2); await page.waitForTimeout(600);
  assert.equal(st.posts.length, 1); const b = st.posts[0];
  assert.equal(b.id, CHAT); assert.equal(b.mime, 'image/jpeg'); assert.equal(b.caption, 'الروشتة'); assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(b.clientId)); assert.ok(b.data.startsWith('/9j/'), 'JPEG bytes (base64 FFD8FF)'); assert.ok(!('to' in b) && !('phone' in b), 'chat id only');
  assert.equal(await page.locator('[data-wa-preview], [data-wa-mp]').count(), 0, 'preview closed after send');
  const bub = await page.evaluate(() => { const m = [...document.querySelectorAll('#waMsgs .wa-msg')].pop(); const im = m.querySelector('img.wa-mimg'); return { img: !!im, loaded: im && im.naturalWidth > 0, text: m.textContent, failed: /فشل|لم يُرسل/.test(m.textContent) }; });
  assert.ok(bub.img && bub.loaded, 'photo bubble is shown'); assert.ok(bub.text.includes('الروشتة'), 'caption shown');
  await shot(page, '4-sent'); ok('photo + caption sent: POST body valid, bubble shown');
  // second send is refused by the server (24h window): failed note, bubble marked failed
  await view.locator('[data-wa-attach]').click(); await view.locator('[data-wa-file]').setInputFiles(file); await page.locator('[data-wa-mp]').waitFor(); await page.locator('[data-wa-mp-send]').click();
  await page.waitForTimeout(700); assert.equal(st.posts.length, 2); assert.ok((await view.locator('[data-send-err]').textContent()).includes('24 ساعة')); await shot(page, '5-refused'); ok('server refusal shown as a plain note');
  assert.deepEqual(errors, [], 'no page errors'); assert.deepEqual(st.other, [], 'no other non-GET request'); await ctx.close();
}
console.log(`PASS ux411 send photo: ${n} groups`); await browser.close();
