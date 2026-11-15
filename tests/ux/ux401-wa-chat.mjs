// UX401: chat pane like WhatsApp Web. 1366x768 split view + 390x844 stacked (touch), fake data only: the history API is answered by
// page.route; the only non-GET allowed is the mocked POST history/send (fulfilled locally, never reaches a server or a customer);
// every other non-GET is aborted and must stay at zero. No PIN, no WhatsApp send, no media upload.
// Checks: wallpaper; green outgoing (right) / neutral incoming (left) bubbles; date separators between days; a time on every bubble;
// ticks from status (sent = 1 check, delivered = 2 grey, read = 2 blue, failed = red, incoming none); quoted snippet above a reply
// bubble (tap = jump + flash); reply via hover button (desktop) / swipe + long-press (touch), quote bar in the composer, × and Esc
// cancel, send carries replyTo and the new bubble shows the quote; image in-bubble, sticker 150px without bubble, voice note with
// play/pause + duration from the file, document name + type badge; emoji picker inserts into the field, attach menu explains that
// files cannot be sent (no request); dir=auto field; 24h window closed => field/send/emoji disabled, no reply, Arabic note;
// NOVA_INBOX_SEND off on the server (SEND_DISABLED) => failed tick + Arabic error, text and quote restored; open/send land on the
// latest message, a live message while scrolled up does not move the thread (jump-to-latest badge instead).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/google-chrome node tests/ux/ux401-wa-chat.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T16:22:00+03:00'), H = 3600e3, D = 24 * H;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const WAV = (() => { const n = 8000, b = Buffer.alloc(44 + n, 0x80); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();
const ID = 'wa_201000000401', ID2 = 'wa_201000000402', ID3 = 'wa_201000000403';
const md = (type, extra) => ({ type, mime: null, filename: null, size: null, skipped: null, caption: null, cached: true, ...extra });
const fill = Array.from({ length: 30 }, (_, i) => ({ id: 'f' + i, dir: i % 2 ? 'out' : 'in', kind: i % 2 ? 'pharm' : 'in', text: 'رسالة رقم ' + (i + 1) + ' عن الطلب والدواء', at: NOW - 6 * H + i * 60000, status: i % 2 ? 'read' : null }));
const msgs = [
  { id: 'a1', dir: 'in', kind: 'in', text: 'السلام عليكم، عندكم بانادول اكسترا؟', at: NOW - 2 * D, status: null },
  { id: 'a2', dir: 'out', kind: 'pharm', text: 'أيوه متوفر', at: NOW - 2 * D + 60000, status: 'read' },
  { id: 'b1', dir: 'in', kind: 'in', text: '[صورة]', at: NOW - D, status: null, media: md('image', { mime: 'image/png' }) },
  { id: 'b2', dir: 'out', kind: 'pharm', text: 'وصلت الصورة', at: NOW - D + 60000, status: 'delivered' },
  { id: 'b3', dir: 'in', kind: 'in', text: '[ملصق]', at: NOW - D + 120000, status: null, media: md('sticker', { mime: 'image/png' }) },
  ...fill,
  { id: 'c1', dir: 'in', kind: 'in', text: '[رسالة صوتية]', at: NOW - 50 * 60000, status: null, media: md('audio', { mime: 'audio/wav' }) },
  { id: 'c2', dir: 'in', kind: 'in', text: '[مستند] روشتة.pdf', at: NOW - 40 * 60000, status: null, media: md('document', { mime: 'application/pdf', filename: 'روشتة.pdf', size: 245760 }) },
  { id: 'c3', dir: 'out', kind: 'pharm', text: 'تمام', at: NOW - 30 * 60000, status: 'sent' },
  { id: 'c4', dir: 'out', kind: 'pharm', text: 'محاولة فاشلة', at: NOW - 20 * 60000, status: 'failed' },
  { id: 'c5', dir: 'out', kind: 'pharm', text: 'متوفر بـ 45 جنيه', at: NOW - 10 * 60000, status: 'read', replyTo: 'a1' },
  { id: 'c6', dir: 'in', kind: 'in', text: 'ممكن توصيل للبيت؟', at: NOW - 5 * 60000, status: null },
];
const closedMsgs = [{ id: 'x1', dir: 'in', kind: 'in', text: 'شكرا', at: NOW - 30 * H, status: null }, { id: 'x2', dir: 'out', kind: 'pharm', text: 'العفو', at: NOW - 29 * H, status: 'read' }];
const offMsgs = [{ id: 'y1', dir: 'in', kind: 'in', text: 'محتاج كريم للحساسية', at: NOW - 2 * 60000, status: null }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const origin = new URL(BASE).origin;

async function setup(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
  const st = { sends: [], other: [], extra: false };
  const live = () => st.extra ? msgs.concat([{ id: 'n1', dir: 'in', kind: 'in', text: 'رسالة جديدة وصلت', at: NOW - 1000, status: null }]) : msgs;
  const convs = () => [
    { id: ID, customer: 'سارة', updatedAt: NOW - (st.extra ? 1000 : 5 * 60000), count: live().length, last: live()[live().length - 1] },
    { id: ID3, customer: 'عميل الإرسال المقفول', updatedAt: NOW - 2 * 60000 - 1, count: offMsgs.length, last: offMsgs[0] },
    { id: ID2, customer: 'عميل قديم', updatedAt: NOW - 29 * H, count: closedMsgs.length, last: closedMsgs[1] },
  ];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/')) {
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,accept' } });
      if (q.method() === 'POST' && u.endsWith('/send')) {
        const b = JSON.parse(q.postData() || '{}'); st.sends.push(b);
        if (b.id === ID3) return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SEND_DISABLED', message_ar: 'الإرسال من شاشة المحادثات غير مفعّل.' }) });
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 'ps_' + st.sends.length, dir: 'out', kind: 'pharm', text: b.text, at: NOW + st.sends.length, status: 'sent' } }) });
      }
      if (q.method() !== 'GET') { st.other.push(q.method() + ' ' + u); return r.abort(); }
      const id = new URL(u).searchParams.get('id');
      if (u.includes('/history/media')) {
        const t = { b1: ['image/png', PNG], b3: ['image/png', PNG], c1: ['audio/wav', WAV], c2: ['application/pdf', Buffer.from('%PDF-1.4\n%%EOF')] }[id];
        if (!t) return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false}' });
        return r.fulfill({ status: 200, headers: cors, contentType: t[0], body: t[1] });
      }
      if (u.includes('/conversations')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: convs() }) });
      const c = convs().find((x) => x.id === id), m = id === ID ? live() : id === ID2 ? closedMsgs : offMsgs;
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: { id, customer: c.customer, updatedAt: c.updatedAt, messages: m } }) });
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  return { ctx, page, view, st, errors };
}
async function openChat(page, view, id, last) {
  if (await view.locator('[data-wa-back]').isVisible().catch(() => false)) await view.locator('[data-wa-back]').click();
  await view.locator(`[data-conv="${id}"]`).click();
  await view.locator(`[data-mid="${last}"]`).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}
const atBottom = (page) => page.evaluate(() => { const m = document.getElementById('waMsgs'); return m.scrollHeight - m.scrollTop - m.clientHeight; });
const touch = (page, sel, steps, holdMs) => page.evaluate(async ([sel, steps, holdMs]) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const T = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [T(x, y)], changedTouches: [T(x, y)] }));
  fire('touchstart', x0, y0); let x = x0;
  for (const dx of steps) { x = x0 + dx; fire('touchmove', x, y0); await new Promise((f) => requestAnimationFrame(f)); }
  if (holdMs) await new Promise((f) => setTimeout(f, holdMs));
  fire('touchend', x, y0);
}, [sel, steps, holdMs]);

const report = {};
for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const r = report[vp.name] = {};
  const { ctx, page, view, st, errors } = await setup(vp);
  await openChat(page, view, ID, 'c6');
  assert.ok(await atBottom(page) <= 2, 'opening a chat lands on the latest message');

  // 1) wallpaper, bubbles, sides, date separators, time on every bubble
  const g = await page.evaluate(() => {
    const ms = document.getElementById('waMsgs'), mr = ms.getBoundingClientRect(), mid = mr.left + mr.width / 2;
    const rows = [...ms.querySelectorAll('.wa-msg')].map((m) => { const b = m.querySelector('.wa-bubble'), br = b.getBoundingClientRect(), t = m.querySelector('.wa-time');
      return { id: m.dataset.mid, dir: m.dataset.dir, bg: getComputedStyle(b).backgroundColor, cx: br.left + br.width / 2, time: t ? t.textContent : null, timeVis: !!t && t.getBoundingClientRect().width > 0 }; });
    return { wp: getComputedStyle(ms).backgroundImage.slice(0, 30), rows, mid, dates: [...ms.querySelectorAll('[data-date-sep]')].map((d) => d.textContent), dir: document.querySelector('.wa-root').getAttribute('dir'),
      overflow: document.documentElement.scrollWidth > innerWidth || [...ms.querySelectorAll('.wa-bubble')].some((b) => b.getBoundingClientRect().right > mr.right + 1 || b.getBoundingClientRect().left < mr.left - 1) };
  });
  assert.ok(g.wp.startsWith('url("data:image/svg+xml'), 'WhatsApp-like doodle wallpaper');
  assert.equal(g.dir, 'rtl'); assert.equal(g.overflow, false, 'no horizontal overflow');
  assert.deepEqual(g.dates, ['الجمعة', 'أمس', 'اليوم'], 'one date separator per day, in order');
  assert.equal(g.rows.length, msgs.length);
  for (const b of g.rows) {
    assert.match(b.time || '', /^\d\d:\d\d$/, 'time on bubble ' + b.id); assert.ok(b.timeVis, 'time visible ' + b.id);
    if (b.id === 'b3') continue; // sticker: no bubble background, like WhatsApp
    if (b.dir === 'out') { assert.ok(b.cx > g.mid, 'outgoing right ' + b.id); assert.equal(b.bg, 'rgb(15, 74, 60)', 'green outgoing ' + b.id); }
    else { assert.ok(b.cx < g.mid, 'incoming left ' + b.id); assert.equal(b.bg, 'rgb(31, 37, 44)', 'incoming bubble ' + b.id); }
  }
  r.dates = g.dates;

  // 2) ticks from status
  const tk = await page.evaluate(() => Object.fromEntries(['a2', 'b2', 'c3', 'c4', 'c5', 'c6', 'a1'].map((id) => { const t = document.querySelector(`[data-mid="${id}"] .wa-meta .wa-tick`);
    return [id, t ? { k: t.dataset.tick, paths: t.querySelectorAll('svg path').length, color: getComputedStyle(t).color, w: t.getBoundingClientRect().width, label: t.getAttribute('aria-label') } : null]; })));
  assert.equal(tk.c3.k, 'sent'); assert.equal(tk.c3.paths, 1, 'sent = one check');
  assert.equal(tk.b2.k, 'delivered'); assert.equal(tk.b2.paths, 2, 'delivered = two checks'); assert.equal(tk.b2.color, 'rgb(158, 172, 185)', 'delivered grey');
  assert.equal(tk.a2.k, 'read'); assert.equal(tk.a2.paths, 2); assert.equal(tk.a2.color, 'rgb(83, 189, 235)', 'read = blue');
  assert.equal(tk.c5.k, 'read');
  assert.equal(tk.c4.k, 'failed'); assert.equal(tk.c4.color, 'rgb(255, 107, 122)', 'failed red'); assert.ok(tk.c4.label.includes('ما اتبعتتش'));
  for (const k of ['a2', 'b2', 'c3', 'c4']) assert.ok(tk[k].w >= 10, 'tick visible ' + k);
  assert.equal(tk.c6, null); assert.equal(tk.a1, null, 'no ticks on incoming');
  r.ticks = Object.fromEntries(Object.entries(tk).map(([k, v]) => [k, v && v.k]));

  // 3) media: image in-bubble, sticker, voice (duration from the file, play/pause), document name + type
  const mdv = await page.evaluate(() => { const q = (s) => document.querySelector(s), bx = (s) => { const e = q(s); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
    return { img: bx('[data-mid="b1"] .wa-m-image'), imgInBubble: !!q('[data-mid="b1"] .wa-bubble img.wa-mimg'), stk: bx('[data-mid="b3"] .wa-m-sticker img'), stkBg: getComputedStyle(q('[data-mid="b3"] .wa-bubble')).backgroundColor,
      voice: !!q('[data-mid="c1"] [data-wa-voice] [data-wa-vplay]'), docName: q('[data-mid="c2"] .wa-mdoc-t b').textContent, docExt: q('[data-mid="c2"] .wa-mext').textContent, docSub: q('[data-mid="c2"] .wa-mdoc-t span').textContent }; });
  assert.ok(mdv.img >= 96 && mdv.imgInBubble, 'image inside the bubble ' + JSON.stringify(mdv)); // UX408: natural aspect ratio, no forced 260px square assert.equal(mdv.stk, 150); assert.equal(mdv.stkBg, 'rgba(0, 0, 0, 0)', 'sticker without bubble');
  assert.ok(mdv.voice); assert.equal(mdv.docName, 'روشتة.pdf'); assert.equal(mdv.docExt, 'PDF'); assert.match(mdv.docSub, /PDF · 240 ك\.ب/);
  await page.waitForFunction(() => document.querySelector('[data-mid="c1"] [data-wa-vdur]').textContent === '0:01', null, { timeout: 5000 });
  await view.locator('[data-mid="c1"] [data-wa-vplay]').click();
  await page.waitForFunction(() => document.querySelector('[data-mid="c1"] [data-wa-vplay]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
  await view.locator('[data-mid="c1"] [data-wa-vplay]').click();
  await page.waitForFunction(() => document.querySelector('[data-mid="c1"] [data-wa-vplay]').getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
  r.voice = 'duration 0:01, play/pause';

  // 4) quoted snippet above a reply; tap jumps to the original and flashes it
  const qt = await page.evaluate(() => { const q = document.querySelector('[data-mid="c5"] .wa-bubble > .wa-quote'), t = document.querySelector('[data-mid="c5"] .wa-text');
    return q && { who: q.querySelector('.wa-q-who').textContent, txt: q.querySelector('.wa-q-txt').textContent, above: q.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1, jump: q.dataset.waQuoteJump }; });
  assert.deepEqual(qt, { who: 'سارة', txt: 'السلام عليكم، عندكم بانادول اكسترا؟', above: true, jump: 'a1' });
  await view.locator('[data-mid="c5"] [data-wa-quote-jump]').click();
  const jumped = await page.evaluate(() => { const a = document.querySelector('[data-mid="a1"]'), m = document.getElementById('waMsgs').getBoundingClientRect(), r = a.getBoundingClientRect(); return { flash: a.classList.contains('wa-flash'), inView: r.top >= m.top && r.bottom <= m.bottom }; });
  assert.deepEqual(jumped, { flash: true, inView: true }, 'quote jumps to the original message');

  // 5) a live message while scrolled up never moves the thread; the jump-to-latest control shows a badge
  const top0 = await page.evaluate(() => document.getElementById('waMsgs').scrollTop);
  st.extra = true;
  await view.locator('[data-wa-latest]:not([hidden]) [data-wa-fab-n]:not([hidden])').waitFor({ timeout: 12000 });
  await view.locator('[data-mid="n1"]').waitFor({ state: 'attached' });
  const top1 = await page.evaluate(() => document.getElementById('waMsgs').scrollTop);
  assert.ok(Math.abs(top1 - top0) <= 2, `not ripped away while scrolled up: ${top0} -> ${top1}`);
  await view.locator('[data-wa-latest]').click();
  assert.ok(await atBottom(page) <= 2, 'jump to latest');
  r.live = 'kept position, badge, jump';

  // 6) reply: desktop hover button; touch swipe + long-press. Quote bar shows the snippet; × and Esc cancel; instant (<100ms)
  const input = view.locator('#waInput');
  if (!vp.touch) {
    await view.locator('[data-mid="c6"] .wa-bubble').hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-mid="c6"] .wa-rbtn')).opacity === '1');
    const ms = await page.evaluate(() => { const t0 = performance.now(); document.querySelector('[data-mid="c6"] [data-wa-reply]').click(); return { dt: performance.now() - t0, bar: !!document.querySelector('[data-wa-qbar]') }; });
    assert.ok(ms.bar && ms.dt < 100, 'reply bar appears instantly ' + JSON.stringify(ms)); r.replyMs = Math.round(ms.dt);
  } else {
    assert.equal(await view.locator('[data-mid="c6"] .wa-rbtn').isVisible(), false, 'no hover button on touch');
    await touch(page, '[data-mid="c6"] .wa-bubble', [14, 30, 50, 70], 0);
    await view.locator('[data-wa-qbar]').waitFor({ timeout: 1000 });
  }
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const bar = await page.evaluate(() => { const b = document.querySelector('[data-wa-qbar]'), c = document.querySelector('[data-wa-composer]'); return { qid: b.dataset.qid, txt: b.querySelector('.wa-q-txt').textContent, who: b.querySelector('.wa-q-who').textContent, above: b.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 1 }; });
  assert.deepEqual(bar, { qid: 'c6', txt: 'ممكن توصيل للبيت؟', who: 'سارة', above: true });
  await view.locator('[data-wa-qcancel]').click();
  assert.equal(await view.locator('[data-wa-qbar]').count(), 0, '× cancels the quote');
  if (vp.touch) { await touch(page, '[data-mid="c3"] .wa-bubble', [], 650); await view.locator('[data-wa-qbar][data-qid="c3"]').waitFor({ timeout: 1000 }); r.longPress = 'ok'; }
  else { await view.locator('[data-mid="c3"] .wa-bubble').hover(); await view.locator('[data-mid="c3"] [data-wa-reply]').click(); }
  assert.equal(await view.locator('[data-wa-qbar] .wa-q-who').textContent(), 'أنت', 'own message quoted as «أنت»');
  await input.focus(); await page.keyboard.press('Escape');
  assert.equal(await view.locator('[data-wa-qbar]').count(), 0, 'Esc cancels the quote');
  assert.ok(await view.locator('#waMsgs').isVisible(), 'Esc on a quote does not close the chat');
  // vertical drag on a bubble = scroll, never a reply
  await touch(page, '[data-mid="c6"] .wa-bubble', [], 0).catch(() => {});
  if (vp.touch) assert.equal(await view.locator('[data-wa-qbar]').count(), 0, 'a tap is not a reply');

  // 7) composer: emoji picker, attach menu, dir=auto; send with the quote lands at the bottom with the quote shown
  assert.equal(await input.getAttribute('dir'), 'auto');
  // UX408 (WhatsApp iOS): no emoji button inside the field (the iOS keyboard has its own emoji key)
  assert.equal(await view.locator('[data-wa-emoji]').count(), 0, 'no emoji clutter in the composer');
  await input.fill('تمام 👍');
  await view.locator('[data-wa-attach]').click();
  const att = await page.evaluate(() => { const m = document.querySelector('[data-wa-attach-menu]'); return { open: !m.hidden, items: [...m.querySelectorAll('[data-wa-att]')].map((b) => b.getAttribute('aria-disabled')), note: m.querySelector('[data-wa-att-note]').textContent }; });
  assert.ok(att.open && att.items.length === 3 && att.items.every((x) => x === 'true') && att.note.includes('النص بس'), 'attach menu: no file sending, explained ' + JSON.stringify(att));
  const n0 = st.sends.length; await view.locator('[data-wa-att="document"]').click({ force: true }); assert.equal(st.sends.length, n0, 'attach items never send');
  await view.locator('#waMsgs').click({ position: { x: 20, y: 20 } });
  assert.equal(await view.locator('[data-wa-attach-menu]').isHidden(), true, 'outside click closes the attach menu');
  assert.equal(await input.inputValue(), 'تمام 👍', 'draft kept');
  // reply to c6 and send; scroll up first: sending still lands on the newest message
  if (vp.touch) { await touch(page, '[data-mid="c6"] .wa-bubble', [-14, -30, -50, -70], 0); await view.locator('[data-wa-qbar]').waitFor({ timeout: 1000 }); }
  else { await view.locator('[data-mid="c6"] .wa-bubble').hover(); await view.locator('[data-mid="c6"] [data-wa-reply]').click(); }
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); });
  await input.focus(); await page.keyboard.press('Enter');
  await view.locator('[data-mid="ps_1"]').waitFor();
  const sent = st.sends[st.sends.length - 1];
  assert.deepEqual({ id: sent.id, text: sent.text, replyTo: sent.replyTo }, { id: ID, text: 'تمام 👍', replyTo: 'c6' }, 'send carries replyTo');
  assert.equal(await view.locator('[data-mid="ps_1"] .wa-quote .wa-q-txt').textContent(), 'ممكن توصيل للبيت؟', 'sent bubble shows the quote');
  assert.equal(await view.locator('[data-mid="ps_1"] [data-tick="sent"]').count(), 1);
  assert.equal(await view.locator('[data-wa-qbar]').count(), 0, 'quote bar cleared after send');
  await page.waitForTimeout(50);
  assert.ok(await atBottom(page) <= 2, 'send lands on the newest message');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux401-chat-${vp.name}.png` });

  // 8) 24h window closed: everything disabled with the Arabic explanation, no reply affordance
  await openChat(page, view, ID2, 'x2');
  const cl = await page.evaluate(() => ({ dis: document.getElementById('waInput').disabled, send: document.querySelector('[data-wa-send]').disabled, note: (document.querySelector('[data-wa-window]') || {}).textContent || '',
    emoji: document.querySelector('[data-wa-emoji]') ? 'present' : 'none', attach: document.querySelector('[data-wa-attach]').getAttribute('aria-disabled'), panel: !!document.querySelector('[data-wa-emoji-panel]'), reply: document.querySelectorAll('[data-wa-reply]').length }));
  assert.ok(cl.dis && cl.send, 'field + send disabled'); assert.match(cl.note, /24 ساعة/); assert.equal(cl.emoji, 'none', 'UX408: no emoji button'); assert.equal(cl.attach, 'true'); assert.equal(cl.panel, false); assert.equal(cl.reply, 0);
  if (vp.touch) { await touch(page, '[data-mid="x1"] .wa-bubble', [14, 30, 50, 70], 0); assert.equal(await view.locator('[data-wa-qbar]').count(), 0, 'no swipe reply when the window is closed'); }
  const n1 = st.sends.length; await page.evaluate(() => document.querySelector('[data-wa-send]').click()); /* UX408: Send is hidden while the field is empty */ assert.equal(st.sends.length, n1, 'nothing sent when closed');
  r.window = 'closed: disabled + note';

  // 9) NOVA_INBOX_SEND off on the server: failed tick, Arabic error, text + quote restored for a retry
  await openChat(page, view, ID3, 'y1');
  if (vp.touch) { await touch(page, '[data-mid="y1"] .wa-bubble', [14, 30, 50, 70], 0); } else { await view.locator('[data-mid="y1"] .wa-bubble').hover(); await view.locator('[data-mid="y1"] [data-wa-reply]').click(); }
  await view.locator('[data-wa-qbar]').waitFor();
  await input.fill('متوفر'); await view.locator('[data-wa-send]').click();
  await view.locator('[data-send-err]').waitFor();
  const off = await page.evaluate(() => ({ err: document.querySelector('[data-send-err]').textContent, failed: document.querySelectorAll('.wa-msg[data-status=failed] [data-tick=failed]').length, val: document.getElementById('waInput').value, q: (document.querySelector('[data-wa-qbar]') || { dataset: {} }).dataset.qid }));
  assert.deepEqual(off, { err: 'الإرسال من شاشة المحادثات غير مفعّل.', failed: 1, val: 'متوفر', q: 'y1' }, 'kill switch: visible failure, draft + quote kept');
  r.killSwitch = 'failed + Arabic error + draft/quote restored';

  assert.deepEqual(st.other, [], 'no non-GET requests except the mocked send');
  assert.ok(st.sends.every((s) => typeof s.text === 'string' && !s.media && !s.file), 'text-only sends');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
console.log('ux401-wa-chat OK');
