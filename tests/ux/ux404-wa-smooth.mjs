// UX404: conversations screen at WhatsApp-level smoothness + the owner's phone bugs (screenshot .nova/inbox/ux404-ahmed-phone-2026-11-15.png).
// 1366x768 desktop and 390x844 mobile emulation, fake data only. The history API is answered inside the browser by page.route;
// the only non-GET allowed is the mocked POST history/send (fulfilled locally, never reaches a server); every other non-GET is
// aborted and must stay at zero. No WhatsApp send, no PIN.
// Checks: 500-message thread opens at the bottom with no jump; scrolling = no long tasks, few dropped frames, CLS ~ 0; DOM windowed;
// scroll-up loads older messages by itself without moving the visible message; FAB appears when scrolled up and counts new incoming
// messages; optimistic send (clock -> ✓, failed visible); composer stays above a simulated visualViewport keyboard; safe-area top
// padding (simulated with --wa-sat); time slot never overlaps text («Bottest off», Arabic, mixed); tails; emoji/attach/mic icons;
// ~200ms slide open/back (none with prefers-reduced-motion); visual regression screenshots at 390x844.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux404-wa-smooth.mjs   (UPDATE_SNAPSHOTS=1 rewrites the baselines)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SNAP = new URL('./__screenshots__/ux404/', import.meta.url);
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const BIG = 'wa_201000000500', SHORT = 'wa_201000000777', N = 500;
const big = Array.from({ length: N }, (_, k) => ({ id: 'b_' + k, dir: k % 3 ? 'out' : 'in', kind: k % 3 ? 'bot' : 'in',
  text: k % 7 === 0 ? 'رسالة رقم ' + k + ' — نص أطول شوية علشان الفقاعة تلف على سطرين أو أكتر زي المحادثات الحقيقية' : 'رسالة رقم ' + k,
  at: NOW - (N - k) * 60000, status: k % 3 ? 'read' : null }));
const shortMsgs = [
  { id: 's1', dir: 'in', kind: 'in', text: 'Bottest off', at: NOW - 600000, status: null },
  { id: 's2', dir: 'in', kind: 'in', text: 'دد', at: NOW - 540000, status: null },
  { id: 's3', dir: 'out', kind: 'pharm', text: 'Bbsjd', at: NOW - 480000, status: 'read' },
  { id: 's4', dir: 'out', kind: 'pharm', text: 'اهلا', at: NOW - 420000, status: 'sent' },
  { id: 's5', dir: 'in', kind: 'in', text: 'Panadol extra متوفر؟', at: NOW - 360000, status: null },
  { id: 's6', dir: 'in', kind: 'in', text: 'ok', at: NOW - 300000, status: null },
];
const convList = (extra) => [
  { id: SHORT, customer: 'دكتور احمد', updatedAt: NOW - 300000, count: shortMsgs.length, last: shortMsgs[shortMsgs.length - 1] },
  { id: BIG, customer: 'عميل كبير', updatedAt: NOW - 60000 + extra.length, count: N + extra.length, last: (extra[extra.length - 1] || big[N - 1]) },
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const report = {};

async function setup(vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block',
    hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const st = { extra: [], sends: [], other: [], sendMode: 'slow', release: null };
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/')) {
      if (q.headers()['x-nova-pin'] !== undefined) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"ok":false}' });
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,accept' } });
      if (q.method() === 'POST' && u.endsWith('/send')) {
        const b = JSON.parse(q.postData() || '{}'); st.sends.push(b);
        const ok = () => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 'ps_' + st.sends.length, dir: 'out', kind: 'pharm', text: b.text, at: Date.now(), status: 'sent' } }) });
        if (st.sendMode === 'fail') return r.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SEND_FAILED', message_ar: 'الرسالة ما اتبعتتش. حاول تاني.' }) });
        return new Promise((res) => { st.release = () => res(ok()); });
      }
      if (q.method() !== 'GET') { st.other.push(q.method() + ' ' + u); return r.abort(); }
      const id = new URL(u).searchParams.get('id');
      const body = u.includes('/conversations') ? { ok: true, conversations: convList(st.extra) }
        : { ok: true, conversation: id === SHORT ? { id, customer: 'دكتور احمد', updatedAt: NOW, messages: shortMsgs } : { id, customer: 'عميل كبير', updatedAt: NOW, messages: big.concat(st.extra) } };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  // simulated on-screen keyboard: a controllable visualViewport (installed before the app scripts run)
  await ctx.addInitScript(() => {
    const t = new EventTarget(); let h = innerHeight;
    const vv = { get height() { return h; }, get width() { return innerWidth; }, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t) };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__kb = (px) => { h = px ? innerHeight - px : innerHeight; t.dispatchEvent(new Event('resize')); };
    window.__cls = 0; window.__long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }); } catch (e) {}
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${BIG}"]`).waitFor();
  return { ctx, page, view, st, errors };
}
const geo = (page) => page.evaluate(() => { const m = document.getElementById('waMsgs'); const b = document.querySelector('[data-wa-latest]'); const n = document.querySelector('[data-wa-fab-n]');
  return { n: m.querySelectorAll('[data-mid]').length, top: m.scrollTop, gap: m.scrollHeight - m.scrollTop - m.clientHeight, ch: m.clientHeight, fab: b && !b.hidden, badge: n && !n.hidden ? n.textContent : '' }; });
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

// pixel comparison in the browser (no extra deps): ratio of pixels whose max channel diff > 40
async function compareShot(page, name, buf) {
  const file = new URL(name + '.png', SNAP);
  if (UPDATE || !existsSync(file)) { mkdirSync(SNAP, { recursive: true }); writeFileSync(file, buf); return { name, baseline: 'written' }; }
  const ref = readFileSync(file);
  const ratio = await page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return 1;
    const c = (i) => { const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const g = k.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const p = c(x), q = c(y); let d = 0;
    for (let i = 0; i < p.length; i += 4) if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > 40) d++;
    return d / (p.length / 4);
  }, [buf.toString('base64'), ref.toString('base64')]);
  assert.ok(ratio < 0.04, `visual regression ${name}: ${(ratio * 100).toFixed(2)}% pixels differ (UPDATE_SNAPSHOTS=1 to accept)`);
  return { name, diff: +(ratio * 100).toFixed(2) };
}

for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const r = report[vp.name] = {};
  const { ctx, page, view, st, errors } = await setup(vp);
  // --- safe area: the app header / المحادثات tab clears the phone status bar
  await page.evaluate(() => document.documentElement.style.setProperty('--wa-sat', '47px'));
  const sa = await page.evaluate(() => { const row = document.querySelector('.nova-nav-row'), tab = document.getElementById('novaInboxTab');
    return { pad: getComputedStyle(row).paddingTop, tabTop: tab.getBoundingClientRect().top, page: document.body.dataset.activePage,
      rule: [...document.querySelectorAll('#novaInboxView style')].some((s) => /body\[data-active-page=inbox\] \.nova-nav-row\{[^}]*env\(safe-area-inset-top/.test(s.textContent)) }; });
  assert.equal(sa.page, 'inbox'); assert.equal(sa.pad, '47px', 'safe-area top padding applied'); assert.ok(sa.tabTop >= 47, 'tab below the status bar ' + sa.tabTop); assert.ok(sa.rule, 'rule uses env(safe-area-inset-top)');
  await page.evaluate(() => document.documentElement.style.removeProperty('--wa-sat'));
  r.safeArea = sa;

  // --- open the 500-message chat: lands at the bottom on the first painted frame and never moves
  await page.evaluate(() => { window.__cls = 0; });
  await view.locator(`[data-conv="${BIG}"]`).click();
  if (vp.touch) {
    const anim = await page.evaluate(() => document.getAnimations().map((a) => ({ n: a.animationName, d: a.effect.getTiming().duration })));
    assert.ok(anim.some((a) => a.n === 'waOpen' && a.d === 200), 'slide-in 200ms on open ' + JSON.stringify(anim));
  }
  const frames = await page.evaluate(() => new Promise((res) => {
    const out = []; let k = 0;
    const tick = () => { const m = document.getElementById('waMsgs'), has = m && m.querySelector('[data-mid]'); if (has) out.push(Math.round(m.scrollHeight - m.scrollTop - m.clientHeight)); if (++k < 45) requestAnimationFrame(tick); else res(out); };
    requestAnimationFrame(tick);
  }));
  assert.ok(frames.length > 5 && frames.every((g) => g <= 2), 'opened at the bottom on every frame (no jump/flash): ' + frames.slice(0, 12).join(','));
  await settle(page);
  let g = await geo(page);
  assert.equal(g.n, 80, 'windowed DOM: only the newest 80 of 500 bubbles'); assert.ok(g.gap <= 2); assert.equal(g.fab, false, 'no FAB at the bottom');
  r.open = { frames: frames.length, n: g.n };

  // --- 60fps scroll: smooth programmatic scroll over the windowed thread; no long tasks, few dropped frames, CLS ~ 0
  const perf = await page.evaluate(() => new Promise((res) => {
    window.__long = []; const m = document.getElementById('waMsgs'); const start = m.scrollTop, dist = Math.min(2400, start - 400); const t0 = performance.now(), D = 1200, ts = [];
    const step = (t) => { ts.push(t); const p = Math.min(1, (t - t0) / D); m.scrollTop = start - dist * p; if (p < 1) requestAnimationFrame(step); else setTimeout(() => {
      const gaps = ts.slice(1).map((x, i) => x - ts[i]); res({ frames: ts.length, worst: Math.round(Math.max(...gaps)), slow: gaps.filter((x) => x > 34).length, long: window.__long.slice(), cls: window.__cls, n: m.querySelectorAll('[data-mid]').length }); }, 100); };
    requestAnimationFrame(step);
  }));
  r.scroll = perf;
  assert.deepEqual(perf.long, [], 'no long tasks while scrolling: ' + perf.long);
  assert.ok(perf.slow <= Math.max(2, perf.frames * 0.05), `excessive frame drops: ${perf.slow}/${perf.frames} (worst ${perf.worst}ms)`);
  assert.ok(perf.cls < 0.01, 'CLS ~ 0: ' + perf.cls);
  g = await geo(page); assert.equal(g.fab, true, 'FAB visible after scrolling up'); assert.equal(g.badge, '', 'no badge without new messages');

  // --- FAB unread count: two new incoming messages arrive while scrolled up (silent 4s poll)
  st.extra.push({ id: 'n1', dir: 'in', kind: 'in', text: 'رسالة جديدة 1', at: NOW + 1000, status: null }, { id: 'n2', dir: 'in', kind: 'in', text: 'رسالة جديدة 2', at: NOW + 2000, status: null });
  await page.clock.setFixedTime(new Date(NOW + 5000));
  await page.waitForFunction(() => { const n = document.querySelector('[data-wa-fab-n]'); return n && !n.hidden && n.textContent === '2'; }, null, { timeout: 9000 });
  const keep = await geo(page); assert.ok(keep.gap > 400, 'new messages do not yank the reader to the bottom');
  assert.match(await view.locator('[data-wa-latest]').getAttribute('aria-label'), /2 رسالة جديدة/);
  await view.locator('[data-wa-latest]').click();
  g = await geo(page); assert.ok(g.gap <= 2, 'FAB jumps to the newest'); assert.equal(g.fab, false); assert.equal(g.badge, '');
  r.fab = 'badge 2 -> cleared';

  // --- infinite scroll-up: older batch loads by itself, the visible message does not move
  const n0 = (await geo(page)).n;
  const before = await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = 0; const e = m.querySelector('[data-mid]'); window.__anc = e.dataset.mid; return e.getBoundingClientRect().top - m.getBoundingClientRect().top; });
  await page.waitForFunction((n) => document.querySelectorAll('#waMsgs [data-mid]').length >= n + 80, n0);
  const after = await page.evaluate(() => { const m = document.getElementById('waMsgs'); const e = [...m.querySelectorAll('[data-mid]')].find((x) => x.dataset.mid === window.__anc); return e.getBoundingClientRect().top - m.getBoundingClientRect().top; });
  assert.ok(Math.abs(after - before) < 2, `prepend kept position (${before} vs ${after})`);
  r.prepend = { before, after };

  // --- optimistic send: bubble + clock immediately, then ✓; a failure is visible
  await view.locator('[data-wa-latest]').click().catch(() => {});
  const input = view.locator('#waInput');
  await page.waitForFunction(() => { const i = document.querySelector('#waInput'); return i && !i.disabled; });
  await input.fill('تمام، جاري التجهيز'); await input.press('Enter');
  await view.locator('.wa-out [data-tick="sending"]').waitFor({ timeout: 1000 });
  g = await geo(page); assert.ok(g.gap <= 2, 'own message scrolls into view');
  st.release(); await view.locator('[data-mid="ps_1"] [data-tick="sent"]').waitFor();
  st.sendMode = 'fail'; await input.fill('رسالة هتفشل'); await input.press('Enter');
  await view.locator('.wa-msg[data-status="failed"] [data-tick="failed"]').waitFor();
  assert.equal(await view.locator('[data-send-err]').count(), 1);
  await page.evaluate(() => { const e = document.querySelector('#waInput'); e.value = ''; });
  r.send = 'clock -> ✓, failed visible';

  // --- composer: WhatsApp icons (UX401: emoji + attach open popovers, mic stays inert), send kept
  for (const k of ['emoji', 'attach', 'mic']) {
    const b = view.locator(`[data-wa-composer] [data-wa-${k}]`); assert.ok(await b.isVisible(), k + ' icon'); const bb = await b.boundingBox();
    assert.ok(bb.width >= 40 && bb.height >= 40, k + ' touch target'); assert.equal(await b.getAttribute('aria-disabled'), k === 'mic' ? 'true' : null);
  }
  const nBefore = st.sends.length; await view.locator('[data-wa-mic]').click({ force: true }); await view.locator('[data-wa-emoji]').click({ force: true }); assert.equal(st.sends.length, nBefore, 'icons never send');

  // --- simulated on-screen keyboard (mobile): composer stays above it, no gap
  if (vp.touch) {
    await input.focus(); await page.evaluate(() => window.__kb(336)); await page.waitForTimeout(120);
    const kb = await page.evaluate(() => { const c = document.querySelector('[data-wa-composer]').getBoundingClientRect(); return { bottom: c.bottom, vvh: visualViewport.height }; });
    assert.ok(kb.bottom <= kb.vvh + 1 && kb.bottom >= kb.vvh - 4, `composer sits on the keyboard (${kb.bottom} vs ${kb.vvh})`);
    g = await geo(page); assert.ok(g.gap <= 2, 'thread stays at the bottom above the keyboard');
    await page.evaluate(() => window.__kb(0)); await input.blur(); await page.waitForTimeout(120);
    r.keyboard = kb;
  }

  // --- short / LTR / mixed bubbles: time + ticks never overlap the glyphs; tails on the first bubble of a run
  if (vp.touch) { await view.locator('[data-wa-back]').click(); const ba = await page.evaluate(() => document.getAnimations().map((a) => a.animationName)); assert.ok(ba.includes('waBack'), 'back slide'); await settle(page); }
  await view.locator(`[data-conv="${SHORT}"]`).click();
  await view.locator('[data-mid="s6"]').waitFor(); await settle(page);
  const ov = await page.evaluate(() => [...document.querySelectorAll('#waMsgs .wa-msg')].map((m) => {
    const t = m.querySelector('.wa-text'), meta = m.querySelector('.wa-meta').getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(t);
    const hit = [...rg.getClientRects()].some((c) => c.width > 0 && c.left < meta.right - 0.5 && c.right > meta.left + 0.5 && c.top < meta.bottom - 0.5 && c.bottom > meta.top + 0.5);
    const b = m.querySelector('.wa-bubble').getBoundingClientRect(), inside = meta.left >= b.left - 0.5 && meta.right <= b.right + 0.5 && meta.bottom <= b.bottom + 0.5;
    const pb = getComputedStyle(m.querySelector('.wa-bubble'), '::before');
    return { id: m.dataset.mid, text: t.textContent, hit, inside, first: m.classList.contains('wa-first'), tail: pb.content !== 'none' && pb.content !== '' ? (pb.right === '-8px' ? 'right' : pb.left === '-8px' ? 'left' : '?') : '', side: b.left + b.width / 2 > innerWidth / 2 ? 'right' : 'left', dir: m.dataset.dir };
  }));
  for (const o of ov) { assert.equal(o.hit, false, `time overlaps text in «${o.text}»`); assert.ok(o.inside, `time inside bubble «${o.text}»`); }
  for (const o of ov.filter((x) => x.first)) assert.equal(o.tail, o.dir === 'in' ? 'left' : 'right', 'tail on the screen-edge side ' + o.id); // UX407: WhatsApp sides
  assert.ok(ov.filter((x) => !x.first).every((x) => x.tail === ''), 'tail only on the first bubble of a run');
  assert.ok(ov.filter((x) => x.dir === 'in').every((x) => x.side === 'left') && ov.filter((x) => x.dir === 'out').every((x) => x.side === 'right'), 'UX407 (like WhatsApp): incoming left, outgoing right');
  r.bubbles = ov.map((o) => o.id + (o.first ? '*' : '')).join(' ');

  // --- visual regression (390x844): chat open with short LTR bubble + tails + composer icons; header vs safe area
  if (vp.touch) {
    await page.mouse.move(0, 0);
    r.shots = [await compareShot(page, 'mobile-chat-short', await page.screenshot())];
    await page.evaluate(() => document.documentElement.style.setProperty('--wa-sat', '47px'));
    r.shots.push(await compareShot(page, 'mobile-header-safe-area', await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 200 } })));
    r.shots.push(await compareShot(page, 'mobile-composer', await page.screenshot({ clip: { x: 0, y: 844 - 90, width: 390, height: 90 } })));
    await page.evaluate(() => document.documentElement.style.removeProperty('--wa-sat'));
  }
  assert.deepEqual(st.other, [], 'no non-GET requests except the mocked send');
  assert.deepEqual(errors, [], errors.join('|'));
  assert.equal(await page.locator('input[type=password], [data-wa-lock], #waHistPin').count(), 0, 'UX400: no PIN UI');
  await ctx.close();
}

// prefers-reduced-motion: no slide
{
  const { ctx, page, view } = await setup({ width: 390, height: 844, touch: true }, { reduced: true });
  await view.locator(`[data-conv="${SHORT}"]`).click();
  const a = await page.evaluate(() => document.getAnimations().map((x) => x.animationName));
  assert.ok(!a.includes('waOpen'), 'reduced motion: no slide');
  report.reducedMotion = 'no slide';
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
console.log('ux404-wa-smooth OK');
