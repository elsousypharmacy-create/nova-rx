// UX413: send a voice note from the conversations screen (tap mic -> record -> send / cancel). MediaRecorder + getUserMedia are FAKED
// (no real microphone, no real audio). Every /inbox/history/ call is stubbed; the POST send-media is answered by a stub (NO real send).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux413-wa-voice.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T21:17:00+03:00'), H = 3600e3, CHAT = 'wa_201000000413';
const conv = { id: CHAT, customer: 'منى حسن', updatedAt: NOW - H, count: 1, last: { id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - H } };
const msgs = [{ id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - H }];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
// a tiny valid WAV (0.2 s of silence) so the player can really load the "server copy"
const WAV = (() => { const n = 1600, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b; })();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const FAKE = () => {
  window.__gum = 0; window.__stopped = 0; window.__recStarts = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.__gum++; if (window.__deny) throw new Error('denied'); return { getTracks: () => [{ stop() { window.__stopped++; } }] }; };
  window.MediaRecorder = class { static isTypeSupported(t) { return !window.__noRec && String(t).startsWith('audio/mp4'); }
    constructor(s, o) { this.state = 'inactive'; this.mimeType = o.mimeType; }
    start() { this.state = 'recording'; window.__recStarts++; if (window.__bigStart) setTimeout(() => this.ondataavailable({ data: new Blob([new Uint8Array(4.6 * 1024 * 1024)], { type: 'audio/mp4' }) }), 1200); }
    stop() { this.state = 'inactive'; const b = window.__huge ? new Uint8Array(5 * 1024 * 1024 + 1) : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 1, 2, 3, 4]); if (this.ondataavailable) this.ondataavailable({ data: new Blob([b], { type: 'audio/mp4' }) }); if (this.onstop) this.onstop(); } };
};
async function setup({ audio, postReply }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });
  const st = { posts: [], other: [], sent: [] };
  await ctx.addInitScript(FAKE);
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.includes('/api/v1/inbox/history/send-media') && q.method() === 'POST') { st.posts.push(JSON.parse(q.postData())); const rep = postReply(st.posts.length); if (rep.status === 200 && rep.body.message) st.sent.push(rep.body.message); return r.fulfill({ status: rep.status, headers: cors, contentType: 'application/json', body: JSON.stringify(rep.body) }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.includes('/send-media')) return j({ ok: true, enabled: true, audio });
      if (u.includes('/media?')) return r.fulfill({ status: 200, headers: cors, contentType: 'audio/wav', body: WAV });
      if (u.includes('/conversations')) return j({ ok: true, conversations: [conv] });
      if (u.includes('/conversation?')) return j({ ok: true, conversation: { id: CHAT, customer: conv.customer, updatedAt: conv.updatedAt, messages: msgs.concat(st.sent) } }); // like the real server: a sent message is part of the thread
      return j({ ok: true });
    }
    return u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(400);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${CHAT}"]`).click(); await view.locator('#waInput').waitFor(); await page.waitForTimeout(500);
  return { ctx, page, view, st, errors };
}
const vis = (view, sel) => view.locator(sel).first().isVisible();
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux413-${n}.png` }); };
const flag = (page, k) => page.evaluate((x) => window[x], k);
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
const OKREPLY = (i) => i === 1 ? { status: 200, body: { ok: true, message: { id: 'ps_v1', dir: 'out', kind: 'pharm', text: '[رسالة صوتية]', at: NOW, status: 'sent', media: { type: 'audio', mime: 'audio/mp4', size: 16, caption: null, cached: true } } } } : { status: 422, body: { ok: false, code: 'SEND_WINDOW_CLOSED', message_ar: 'الرسالة ما وصلتش: عدّى أكتر من 24 ساعة على آخر رسالة من العميل.' } };

{ // backend without voice support: mic stays hidden
  const { ctx, view, st, errors } = await setup({ audio: false, postReply: OKREPLY });
  assert.equal(await vis(view, '[data-wa-composer] [data-wa-mic]'), false, 'mic hidden when the backend has no voice support');
  assert.equal(await vis(view, '[data-wa-composer] [data-wa-attach]'), true, 'photo buttons still there');
  assert.deepEqual(errors, []); assert.deepEqual(st.other, []); await ctx.close(); ok('no voice support on the backend: mic hidden, photos unaffected');
}
{
  const { ctx, page, view, st, errors } = await setup({ audio: true, postReply: OKREPLY });
  assert.equal(await vis(view, '[data-wa-composer] [data-wa-mic]'), true, 'mic visible'); await shot(page, '1-composer');
  await view.locator('#waInput').fill('x'); assert.equal(await vis(view, '[data-wa-composer] [data-wa-mic]'), false, 'mic hides while typing'); await view.locator('#waInput').fill('');
  assert.equal(await view.locator('[data-wa-mic]').getAttribute('aria-disabled'), null, 'live button');
  // cancel
  await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); assert.equal(await flag(page, '__recStarts'), 1);
  await page.waitForTimeout(1300); assert.notEqual(await page.locator('[data-wa-rec-time]').textContent(), '0:00', 'timer runs'); await shot(page, '2-recording');
  await page.locator('[data-wa-rec-x]').click(); assert.equal(await page.locator('[data-wa-rec]').count(), 0); assert.equal(st.posts.length, 0, 'cancel sends nothing'); assert.equal(await flag(page, '__stopped'), 1, 'microphone released'); ok('record then cancel: nothing sent, mic released');
  // too short
  await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); await page.locator('[data-wa-rec-send]').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-wa-rec]').count(), 0); assert.equal(st.posts.length, 0); assert.ok((await view.locator('[data-send-err]').textContent()).includes('قصير')); assert.equal(await flag(page, '__stopped'), 2); ok('under 1 second: discarded with a note, mic released');
  // send
  await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); await page.waitForTimeout(1300); await page.locator('[data-wa-rec-send]').click();
  await page.locator('#waMsgs [data-mid="ps_v1"] [data-wa-voice]').waitFor({ timeout: 8000 }); // the server copy replaces the temporary bubble (its fake recording bytes are not decodable audio)
  assert.equal(st.posts.length, 1); const b = st.posts[0];
  assert.equal(b.id, CHAT); assert.equal(b.kind, 'audio'); assert.equal(b.mime, 'audio/mp4'); assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(b.clientId)); assert.ok(b.data.startsWith('AAAAGGZ0eXBNNEEg'), 'ftyp bytes'); assert.ok(!('caption' in b) && !('to' in b), 'no caption, chat id only');
  assert.equal(await flag(page, '__stopped'), 3, 'microphone released after sending'); assert.equal(await page.locator('[data-wa-rec]').count(), 0);
  const bub = await page.evaluate(() => { const m = document.querySelector('#waMsgs [data-mid="ps_v1"]'); return { voice: !!m.querySelector('[data-wa-voice]'), audio: !!m.querySelector('audio'), text: m.textContent }; });
  assert.ok(bub.voice && bub.audio, 'voice bubble with a player'); await shot(page, '3-sent'); ok('voice note sent: POST valid (kind audio, no caption), voice bubble shown, mic released');
  // refusal
  await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); await page.waitForTimeout(1300); await page.locator('[data-wa-rec-send]').click(); await page.waitForTimeout(700);
  assert.equal(st.posts.length, 2); assert.ok((await view.locator('[data-send-err]').textContent()).includes('24 ساعة')); ok('server refusal shown as a plain note');
  assert.deepEqual(errors, [], 'no page errors'); assert.deepEqual(st.other, []); await ctx.close();
}
{ // microphone permission denied
  const { ctx, page, view, st } = await setup({ audio: true, postReply: OKREPLY });
  await page.evaluate(() => { window.__deny = true; }); await view.locator('[data-wa-mic]').click(); await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-wa-rec]').count(), 0); assert.ok((await view.locator('[data-send-err]').textContent()).includes('المايك')); assert.equal(st.posts.length, 0);
  await page.evaluate(() => { window.__deny = false; }); await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); await page.locator('[data-wa-rec-x]').click(); ok('permission denied: plain note, and it works after allowing'); await ctx.close();
}
{ // browser records a format WhatsApp rejects (Chrome: webm) -> no recording is started
  const { ctx, page, view, st } = await setup({ audio: true, postReply: OKREPLY });
  await page.evaluate(() => { window.__noRec = true; }); await view.locator('[data-wa-mic]').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-wa-rec]').count(), 0); assert.equal(await flag(page, '__gum'), 0, 'the microphone is never opened'); assert.ok((await view.locator('[data-send-err]').textContent()).includes('بصيغة يقبلها واتساب')); assert.equal(st.posts.length, 0); ok('unsupported browser format: note, microphone never opened'); await ctx.close();
}
{ // recording that grows past the size limit: auto-stops and sends at 4.5 MB; a final blob over 5 MB is refused with a note
  const { ctx, page, view, st } = await setup({ audio: true, postReply: OKREPLY });
  await page.evaluate(() => { window.__bigStart = true; }); await view.locator('[data-wa-mic]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-wa-rec]').length === 0 && window.__stopped >= 1, null, { timeout: 8000 }); for (let i = 0; i < 80 && !st.posts.length; i++) await page.waitForTimeout(100); // a 4.6 MB recording is encoded and posted: give a loaded machine time
  assert.equal(st.posts.length, 1, 'auto-stopped and sent without pressing send at 4.5 MB'); ok('size limit: recording auto-stops and sends');
  await page.evaluate(() => { window.__bigStart = false; window.__huge = true; }); await view.locator('[data-wa-mic]').click(); await page.locator('[data-wa-rec]').waitFor(); await page.waitForTimeout(1300); await page.locator('[data-wa-rec-send]').click(); await page.waitForTimeout(500);
  assert.equal(st.posts.length, 1, 'over 5 MB is never posted'); assert.ok((await view.locator('[data-send-err]').textContent()).includes('كبير')); ok('a recording over 5 MB is refused with a note'); await ctx.close();
}
await browser.close();
console.log(`PASS ux413 voice: ${n} groups`);
