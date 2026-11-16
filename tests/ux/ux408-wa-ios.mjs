// UX408: conversations screen vs WhatsApp iOS (owner iPhone shots .nova/inbox/ux408-iphone-*.jpg + design review ux408-*.png).
// 390x844 with an iPhone user agent, touch, and simulated safe-area insets (--wa-sat 47px / --wa-sab 34px, the CSS fallbacks for
// env(safe-area-inset-*), which headless Chrome reports as 0) + 1366x768 desktop. Fake data only: every /inbox/history/ call is answered
// by page.route; EVERY non-GET request is aborted and recorded (must stay zero: no WhatsApp send, no POST at all). No PIN.
// Data mirrors the staging read-only check: 33 chats, incl. October 2026 chats sorted at the bottom, one 174-message thread from 25 Oct.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux408-wa-ios.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T18:17:00+03:00'), H = 3600e3, D = 24 * H;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600" viewBox="0 0 300 600"><rect width="300" height="600" fill="#d8e1e8"/><rect x="20" y="20" width="260" height="60" fill="#4a90a4"/><rect x="20" y="520" width="260" height="60" fill="#a44a4a"/></svg>';

// --- fake history (ids wa_*, like staging) ---
const LONG = 'wa_201000000408';
const longMsgs = [];
{ // 174 messages from 25 Oct 2026 to today, runs of 1-3 bubbles per side
  const start = Date.parse('2026-10-25T10:00:00+03:00'), span = (NOW - 2 * D) - start;
  for (let i = 0; i < 174; i++) {
    const at = Math.round(start + span * Math.pow(i / 173, 0.6));
    const dir = Math.floor(i / 2) % 2 === 0 ? 'in' : 'out';
    longMsgs.push({ id: 'L' + i, dir, kind: dir === 'in' ? 'in' : 'pharm', text: (dir === 'in' ? 'سؤال رقم ' : 'رد رقم ') + i + (i % 7 === 0 ? ' — رسالة أطول شوية عشان تلف على سطرين أو أكتر جوه الفقاعة' : ''), at, status: dir === 'out' ? 'read' : null });
  }
  // today: yesterday + today groups, a tall prescription photo, last message from the pharmacy (replied)
  longMsgs.push({ id: 'Ly1', dir: 'in', kind: 'in', text: 'مساء الخير', at: NOW - D - 2 * H, status: null });
  longMsgs.push({ id: 'Ly2', dir: 'out', kind: 'pharm', text: 'مساء النور', at: NOW - D - H, status: 'read' });
  longMsgs.push({ id: 'Limg', dir: 'in', kind: 'in', text: '[صورة] الروشتة', at: NOW - 3 * H, media: { type: 'image', cached: true, caption: 'الروشتة' } });
  longMsgs.push({ id: 'Lt1', dir: 'in', kind: 'in', text: 'متوفر؟', at: NOW - 2 * H, status: null });
  longMsgs.push({ id: 'Lt2', dir: 'out', kind: 'pharm', text: 'أيوه متوفر', at: NOW - 90 * 60e3, status: 'delivered' });
  longMsgs.push({ id: 'Lt3', dir: 'out', kind: 'pharm', text: 'تحب نوصله؟', at: NOW - 80 * 60e3, status: 'sent' });
  longMsgs.sort((a, b) => a.at - b.at);
}
const TOTAL_LONG = longMsgs.length; // 180 (174 + 6)
const thread = (id) => {
  if (id === LONG) return longMsgs;
  if (id === 'wa_201000000001') return [{ id: 's1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 30 * 60e3 }, { id: 's2', dir: 'in', kind: 'in', text: '[صورة]', at: NOW - 20 * 60e3 }];
  if (id === 'wa_201000000002') return [{ id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - 50 * 60e3 }];
  const c = convList.find((x) => x.id === id);
  return [{ id: id + '_a', dir: 'in', kind: 'in', text: 'رسالة قديمة', at: c.updatedAt - 60e3 }, c.last];
};
const convList = [
  { id: 'wa_201000000001', customer: 'سارة علي', updatedAt: NOW - 20 * 60e3, count: 2, last: { id: 's2', dir: 'in', kind: 'in', text: '[صورة]', at: NOW - 20 * 60e3 } },
  { id: 'wa_201000000002', customer: 'منى حسن', updatedAt: NOW - 50 * 60e3, count: 1, last: { id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - 50 * 60e3 } },
  { id: LONG, customer: 'دكتور احمد', updatedAt: longMsgs[longMsgs.length - 1].at, count: TOTAL_LONG, last: longMsgs[longMsgs.length - 1] },
];
for (let i = 0; i < 30; i++) { // 30 more chats, older and older; the last 7 are October 2026 (25 Oct and before)
  const at = i < 23 ? NOW - (i + 1) * 9 * H : Date.parse('2026-10-25T20:00:00+03:00') - (i - 23) * D;
  const out = i % 3 === 0;
  convList.push({ id: 'wa_2011000' + String(i).padStart(5, '0'), customer: (i >= 23 ? 'عميل أكتوبر ' : 'عميل ') + (i + 1), updatedAt: at, count: 2, last: { id: 'x' + i, dir: out ? 'out' : 'in', kind: out ? 'pharm' : 'in', text: out ? 'تمام يا فندم' : 'شكراً', at, status: out ? 'delivered' : null } });
}
assert.equal(convList.length, 33);
const OLDEST = convList[convList.length - 1];
const waitingIds = convList.filter((c) => c.last.dir === 'in').map((c) => c.id);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

async function setup(vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1, userAgent: vp.touch ? IPHONE_UA : undefined });
  const st = { other: [], gets: [] };
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); } // never fulfil a send
    if (u.includes('/api/v1/inbox/history/')) {
      st.gets.push(u);
      if (u.includes('/media?')) return r.fulfill({ status: 200, headers: cors, contentType: 'image/svg+xml', body: TALL_SVG });
      if (u.includes('/conversations')) {
        const list = opts.list ? opts.list(u) : convList;
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: list }) });
      }
      if (u.includes('/conversation?')) {
        const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]), c = convList.find((x) => x.id === id) || { id, customer: id, updatedAt: NOW };
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: { id, customer: c.customer, updatedAt: c.updatedAt, messages: thread(id) } }) });
      }
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  // simulated iPhone insets (set after load: the page rewrites the <html> style attribute while booting)
  if (vp.touch) await page.evaluate(() => { document.documentElement.style.setProperty('--wa-sat', '47px'); document.documentElement.style.setProperty('--wa-sab', '34px'); });
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${opts.first || convList[0].id}"]`).waitFor();
  return { ctx, page, view, st, errors };
}
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux408-after-${name}.png` }); };
const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const report = {};
for (const vp of [{ width: 390, height: 844, name: 'iphone', touch: true }, { width: 1366, height: 768, name: 'desktop', touch: false }]) {
  const r = report[vp.name] = {};
  const { ctx, page, view, st, errors } = await setup(vp);
  const mob = vp.touch;
  await settle(page);

  // H) viewport-fit=cover; ONE solid header below the status bar; no tab strip / second bar on the phone
  assert.match(await page.getAttribute('meta[name=viewport]', 'content'), /viewport-fit=cover/);
  const hd = await page.evaluate(() => { const nav = document.querySelector('.nova-nav-row'), sh = document.querySelector('.wa-side-head'), t = sh.querySelector('.wa-title'), c = getComputedStyle(sh);
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    return { navVisible: vis(nav), tabsVisible: vis(document.querySelector('.nova-nav')), headTop: sh.getBoundingClientRect().top, padTop: c.paddingTop, bg: c.backgroundColor, titleTop: t.getBoundingClientRect().top, titles: [...document.querySelectorAll('.wa-side h1,.wa-side .wa-title')].length,
      sideText: sh.textContent, homeVisible: vis(sh.querySelector('[data-wa-home]')), wordCount: (sh.textContent.match(/المحادثات/g) || []).length }; });
  assert.equal(hd.titles, 1, 'one title'); assert.equal(hd.wordCount, 1, 'title «المحادثات» not duplicated: ' + hd.sideText);
  if (mob) {
    assert.ok(!hd.navVisible && !hd.tabsVisible, 'no app tab strip under the status bar on the phone');
    assert.equal(hd.headTop, 0); assert.equal(hd.padTop, '47px', 'header padded by the safe-area top'); assert.ok(hd.titleTop >= 47, 'title below the status bar');
    assert.equal(hd.bg, 'rgb(26, 30, 36)', 'solid header'); assert.ok(hd.homeVisible, 'way back to the app');
  } else assert.ok(hd.navVisible, 'desktop keeps the app nav');
  r.header = hd;

  // I) row state: unread / لم يُرد => green badge + bold name + green time; replied => grey ticks, no badge; E) «📷 صورة»; F) no ▾ chevron
  const rows = await page.evaluate(() => [...document.querySelectorAll('#waList [data-conv]')].map((b) => { const bd = b.querySelector('.wa-badge'), nm = b.querySelector('.wa-name'), tm = b.querySelector('.wa-ctime');
    return { id: b.dataset.conv, state: b.dataset.state, badge: bd ? bd.textContent : '', badgeBg: bd ? getComputedStyle(bd).backgroundColor : '', fw: getComputedStyle(nm).fontWeight, timeColor: getComputedStyle(tm).color, preview: b.querySelector('.wa-preview').textContent.trim(), tick: !!b.querySelector('.wa-preview .wa-tick'), tickColor: b.querySelector('.wa-preview .wa-tick') ? getComputedStyle(b.querySelector('.wa-preview .wa-tick')).color : '' }; }));
  assert.equal(rows.length, 33, 'every chat from the API is a row');
  const row = Object.fromEntries(rows.map((x) => [x.id, x]));
  for (const id of ['wa_201000000001', 'wa_201000000002']) {
    const x = row[id];
    assert.ok(x.badge === '1' && x.badgeBg === 'rgb(37, 211, 102)', 'green count badge ' + id + JSON.stringify(x));
    assert.ok(Number(x.fw) >= 700, 'bold name ' + id); assert.equal(x.timeColor, 'rgb(37, 211, 102)', 'green time ' + id);
    assert.ok(x.state === 'unread' || x.state === 'noreply');
  }
  const rep = row[LONG];
  assert.ok(!rep.badge && rep.state === 'replied' && rep.tick && Number(rep.fw) < 700 && rep.timeColor !== 'rgb(37, 211, 102)', 'replied row: ticks, no badge ' + JSON.stringify(rep));
  assert.equal(rows.filter((x) => x.state !== 'replied' && x.badge).length, waitingIds.length, 'every waiting chat has a badge');
  assert.equal(row.wa_201000000001.preview, '📷 صورة'); assert.ok(!rows.some((x) => x.preview.includes('[صورة]')), 'no raw [صورة] in the list');
  assert.equal(await page.locator('#waList .wa-rowmenu, #waList [data-wa-menu]').count(), 0, 'no ▾ row chevron');
  r.rows = { total: rows.length, waiting: waitingIds.length, sample: [row.wa_201000000001, rep] };
  await shot(page, vp.name + '-list');

  // I) filter chips الكل / لم يُرد / غير مقروء
  const chipIds = async () => page.evaluate(() => [...document.querySelectorAll('#waList [data-conv]')].map((b) => b.dataset.conv));
  await view.locator('[data-wa-filter="noreply"]').click();
  assert.deepEqual((await chipIds()).sort(), [...waitingIds].sort(), 'لم يُرد = last message from the customer');
  assert.equal(await view.locator('[data-wa-filter="noreply"]').getAttribute('aria-pressed'), 'true');
  await view.locator('[data-wa-filter="unread"]').click();
  const un = await chipIds(); assert.ok(un.length > 0 && un.every((id) => waitingIds.includes(id)), 'غير مقروء: unseen customer messages only');
  await view.locator('[data-wa-filter="all"]').click();
  assert.equal((await chipIds()).length, 33);
  r.chips = { noreply: waitingIds.length, unread: un.length, all: 33 };

  // J) the list scrolls to the oldest (October) chat; the list fills the viewport (no short clip)
  const sc = await page.evaluate((oid) => { const l = document.getElementById('waList'); l.scrollTop = l.scrollHeight; const b = [...l.querySelectorAll('[data-conv]')].find((x) => x.dataset.conv === oid), rr = b.getBoundingClientRect(), lr = l.getBoundingClientRect();
    return { scrollable: l.scrollHeight > l.clientHeight, top: rr.top, bottom: rr.bottom, listBottom: lr.bottom, vh: innerHeight, time: b.querySelector('.wa-ctime').textContent, el: document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2) === b || b.contains(document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2)) }; }, OLDEST.id);
  assert.ok(sc.scrollable && sc.top >= 0 && sc.bottom <= sc.vh + 0.5 && sc.el, 'oldest chat scrolled into view and tappable ' + JSON.stringify(sc));
  assert.ok(/أكتوبر/.test(sc.time), 'October chat reached: ' + sc.time);
  if (mob) assert.ok(Math.abs(sc.listBottom - sc.vh) <= 1, 'list fills the viewport down to the bottom ' + sc.listBottom);
  r.listScroll = sc;
  await page.evaluate(() => { document.getElementById('waList').scrollTop = 0; });

  // open the long October thread
  await view.locator(`[data-conv="${LONG}"]`).click();
  await view.locator('[data-mid="Lt3"]').waitFor();
  await settle(page); await page.waitForTimeout(150);
  // A + 8) chat header below the status bar, 17px name, «آخر ظهور», call/video on the trailing side
  const ch = await page.evaluate(() => { const h = document.querySelector('.wa-head'), b = h.querySelector('[data-wa-back]'), n = h.querySelector('.wa-head-name'), c = getComputedStyle(h);
    return { top: h.getBoundingClientRect().top, pad: c.paddingTop, backTop: b.getBoundingClientRect().top, backVis: getComputedStyle(b).display !== 'none', nameTop: n.getBoundingClientRect().top, nameSize: getComputedStyle(n).fontSize, sub: h.querySelector('[data-wa-sub]').textContent,
      call: !!h.querySelector('[data-wa-call]'), video: !!h.querySelector('[data-wa-video]'), callLeft: h.querySelector('[data-wa-call]').getBoundingClientRect().left, nameLeft: n.getBoundingClientRect().left }; });
  assert.equal(ch.nameSize, '17px'); assert.ok(ch.sub.startsWith('آخر ظهور') && !/رسالة/.test(ch.sub), 'status line, not message counts: ' + ch.sub);
  assert.ok(ch.call && ch.video && ch.callLeft < ch.nameLeft, 'call/video on the trailing (left) side');
  if (mob) { assert.equal(ch.top, 0); assert.equal(ch.pad, '47px'); assert.ok(ch.backVis && ch.backTop >= 47 && ch.nameTop >= 47, 'back + name below the status bar ' + JSON.stringify(ch)); }
  r.chatHeader = ch;

  // 4) no sender label; 11) 17px / 16px; 3) tails at the bottom of the last bubble of each run
  const bub = await page.evaluate(() => { const out = { who: document.querySelectorAll('#waMsgs .wa-who').length, labels: 0, runsOk: true, bad: [], size: '', radius: '' };
    const kids = [...document.querySelectorAll('#waMsgs > *')];
    kids.forEach((el, i) => { if (!el.classList.contains('wa-msg')) return; const b = el.querySelector('.wa-bubble'); if (/^(الصيدلي|البوت)/.test(b.textContent.trim())) out.labels++;
      const nx = kids[i + 1], last = !nx || !nx.classList.contains('wa-msg') || nx.dataset.dir !== el.dataset.dir; const pse = getComputedStyle(b, '::before'), has = pse.content !== 'none' && pse.content !== 'normal';
      const edge = el.dataset.dir === 'out' ? getComputedStyle(b).borderBottomRightRadius : getComputedStyle(b).borderBottomLeftRadius;
      if (last !== el.classList.contains('wa-last') || has !== last || (last && (pse.bottom !== '0px' || pse.top === '0px' && b.offsetHeight > 13 || edge !== '0px'))) { out.runsOk = false; out.bad.push(el.dataset.mid + ':' + last + ':' + has + ':' + pse.bottom + ':' + edge); } });
    const tb = document.querySelector('#waMsgs .wa-msg:not([data-media]) .wa-bubble'); out.size = getComputedStyle(tb).fontSize; out.radius = getComputedStyle(tb).borderTopLeftRadius; return out; });
  assert.equal(bub.who, 0); assert.equal(bub.labels, 0, 'no «الصيدلي»/«البوت» label');
  assert.ok(bub.runsOk, 'tail only on the last bubble of a run, at the bottom, edge corner squared: ' + bub.bad.slice(0, 5).join(' '));
  if (mob) assert.equal(bub.size, '17px'); assert.equal(bub.radius, '16px');
  r.bubbles = bub;

  // 7) time + ticks in the bottom-RIGHT corner (RTL text), never over the text
  // only rows inside the visible thread (off-screen rows use content-visibility placeholder heights)
  const meta = await page.evaluate(() => { const mr = document.getElementById('waMsgs').getBoundingClientRect(); return [...document.querySelectorAll('#waMsgs .wa-msg:not([data-media])')].filter((m) => { const q = m.getBoundingClientRect(); return q.top >= mr.top && q.bottom <= mr.bottom; }).map((m) => { const b = m.querySelector('.wa-bubble').getBoundingClientRect(), t = m.querySelector('.wa-meta').getBoundingClientRect(), x = m.querySelector('.wa-text').getBoundingClientRect();
    return { id: m.dataset.mid, dr: b.right - t.right, db: b.bottom - t.bottom, overlap: Math.max(0, Math.min(x.right, t.right) - Math.max(x.left, t.left)) * Math.max(0, Math.min(x.bottom, t.bottom) - Math.max(x.top, t.top)), tick: !!m.querySelector('.wa-meta .wa-tick'), dir: m.dataset.dir, rb: m.querySelector('.wa-rbtn') ? getComputedStyle(m.querySelector('.wa-rbtn')).display + ':' + m.querySelector('.wa-rbtn').getBoundingClientRect().height : '-', dbg: [b.top, b.bottom, t.top, t.bottom, x.top, x.bottom, m.getBoundingClientRect().height, m.querySelector('.wa-bubble').className, [...m.querySelector('.wa-bubble').children].map((c) => c.className + ':' + c.getBoundingClientRect().height + ':' + getComputedStyle(c).display).join(';'), getComputedStyle(m.querySelector('.wa-bubble')).paddingBottom, getComputedStyle(m.querySelector('.wa-bubble')).minHeight].join(',') }; }); });
  assert.ok(meta.length >= 2, 'visible bubbles measured ' + vp.name + ' ' + meta.length + ' ' + await page.evaluate(() => { const m = document.getElementById('waMsgs'); return [m.scrollTop, m.scrollHeight, m.clientHeight, m.getBoundingClientRect().top, m.getBoundingClientRect().bottom].join(','); }));
  for (const x of meta) { assert.ok(x.dr >= 0 && x.dr <= 14 && x.db >= 0 && x.db <= 10, 'meta bottom-right ' + JSON.stringify(x)); assert.equal(x.overlap, 0, 'time never over text ' + x.id); if (x.dir === 'out') assert.ok(x.tick); }
  r.meta = meta.slice(-3);

  // 5) the tall prescription photo keeps its aspect ratio (no square crop)
  const img = view.locator('[data-wa-mimg][data-wa-mid="Limg"]');
  await img.scrollIntoViewIfNeeded(); await page.waitForFunction(() => { const i = document.querySelector('[data-wa-mimg][data-wa-mid="Limg"]'); return i && i.complete && i.naturalWidth > 0; });
  const ir = await img.evaluate((i) => { const r2 = i.getBoundingClientRect(); return { w: r2.width, h: r2.height, nw: i.naturalWidth, nh: i.naturalHeight, fit: getComputedStyle(i).objectFit, thread: document.getElementById('waMsgs').clientWidth }; });
  assert.ok(Math.abs(ir.h / ir.w - ir.nh / ir.nw) < 0.03, 'aspect ratio kept ' + JSON.stringify(ir)); assert.ok(ir.w <= ir.thread * 0.72 + 1, 'max ~70% of the thread');
  r.image = ir;

  // 2) C) date chips: at rest no floating chip; inline chips never overlap each other or a bubble; while scrolling exactly one chip at the top
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = m.scrollHeight; m.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(1400);
  const chips = async () => page.evaluate(() => { const m = document.getElementById('waMsgs'), mr = m.getBoundingClientRect(), vis = (el) => { const s = getComputedStyle(el), r2 = el.getBoundingClientRect(); return s.visibility !== 'hidden' && Number(s.opacity) > 0.5 && r2.bottom > mr.top && r2.top < mr.bottom && r2.height > 0; };
    const inl = [...m.querySelectorAll('[data-date-sep] span')].filter(vis).map((s) => s.getBoundingClientRect()), fl = m.querySelector('[data-wa-dfloat]'), fs = fl.querySelector('span');
    const flVis = vis(fs) && fs.textContent.trim() !== '', all = inl.concat(flVis ? [fs.getBoundingClientRect()] : []), bubs = [...m.querySelectorAll('.wa-bubble')].map((b) => b.getBoundingClientRect());
    let chipOverlap = 0, bubOverlap = 0; for (let i = 0; i < all.length; i++) { for (let j = i + 1; j < all.length; j++) chipOverlap += Math.max(0, Math.min(all[i].right, all[j].right) - Math.max(all[i].left, all[j].left)) * Math.max(0, Math.min(all[i].bottom, all[j].bottom) - Math.max(all[i].top, all[j].top)); }
    inl.forEach((c) => bubs.forEach((b) => { bubOverlap += Math.max(0, Math.min(c.right, b.right) - Math.max(c.left, b.left)) * Math.max(0, Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top)); }));
    const topBand = all.filter((c) => c.top < mr.top + 44).length, centred = all.every((c) => Math.abs((c.left + c.right) / 2 - (mr.left + mr.right) / 2) < 3);
    return { inline: inl.length, float: flVis, floatText: fs.textContent, chipOverlap, bubOverlap, topBand, centred, today: [...m.querySelectorAll('[data-date-sep]')].filter((d) => d.textContent === 'اليوم').length }; });
  const rest = await chips();
  assert.ok(!rest.float, 'no floating chip at rest'); assert.equal(rest.chipOverlap, 0); assert.equal(rest.bubOverlap, 0, 'a date chip never covers a bubble'); assert.equal(rest.today, 1, 'one «اليوم» chip'); assert.ok(rest.centred);
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = Math.round(m.scrollHeight * 0.35); m.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(250); // fade-in done, before the 1.2s auto-hide
  const mid = await chips();
  assert.ok(mid.topBand <= 1 && mid.chipOverlap === 0 && mid.centred, 'while scrolling at most one chip at the top, never stacked ' + JSON.stringify(mid));
  assert.ok(mid.float || mid.topBand === 1, 'the current day is shown at the top while scrolling ' + JSON.stringify(mid));
  r.dateChips = { rest, scrolling: mid };

  // J) messages older than the last 80: «رسائل أقدم (N)» and scrolling up reveal them all, down to 25 October
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(100);
  const painted0 = await page.locator('#waMsgs .wa-msg').count();
  assert.equal(painted0, 80, 'newest 80 painted first');
  assert.equal(await page.locator('[data-wa-older]').textContent(), `رسائل أقدم (${TOTAL_LONG - 80})`);
  const older = view.locator('[data-wa-older]');
  if (mob) await older.tap(); else await older.click();
  await page.waitForTimeout(150);
  const painted1 = await page.locator('#waMsgs .wa-msg').count();
  assert.ok(painted1 >= 160, 'older batch revealed ' + painted1);
  for (let k = 0; k < 6 && (await page.locator('#waMsgs .wa-msg').count()) < TOTAL_LONG; k++) { await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(150); }
  const all = await page.evaluate(() => ({ n: document.querySelectorAll('#waMsgs .wa-msg').length, first: document.querySelector('#waMsgs .wa-msg').dataset.mid, firstDate: document.querySelector('#waMsgs [data-date-sep]').textContent, older: !!document.querySelector('[data-wa-older]') }));
  assert.equal(all.n, TOTAL_LONG, 'all messages reachable'); assert.equal(all.first, 'L0'); assert.match(all.firstDate, /25|٢٥/); assert.ok(!all.older);
  r.older = { painted0, painted1, all };
  await page.evaluate(() => { const m = document.getElementById('waMsgs'); m.scrollTop = m.scrollHeight; });
  await shot(page, vp.name + '-chat');

  // B + G + 6) composer: not a <form>, enterkeyhint=send, + at the start (right), field in the middle, mic/send at the trailing end (left);
  // Send only with text; nothing (emoji/attach) inside the field; A) safe-area bottom padding
  const cp = async () => page.evaluate(() => { const c = document.querySelector('[data-wa-composer]'), i = document.getElementById('waInput'), p = c.querySelector('.wa-pill'), s = c.querySelector('[data-wa-send]'), mic = c.querySelector('[data-wa-mic]'), plus = c.querySelector('[data-wa-attach]');
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0, R = (el) => el.getBoundingClientRect();
    return { form: !!i.closest('form'), forms: document.querySelectorAll('#novaInboxView form').length, ekh: i.getAttribute('enterkeyhint'), pillKids: p.children.length, pillBtns: p.querySelectorAll('button').length, sendVis: vis(s), micVis: vis(mic), camVis: vis(c.querySelector('[data-wa-camera]')), emoji: !!c.querySelector('[data-wa-emoji]'),
      plusRight: R(plus).left >= R(p).right - 1, trailLeft: (vis(s) ? R(s) : R(mic)).right <= R(p).left + 1, padB: getComputedStyle(c).paddingBottom }; });
  const c0 = await cp();
  assert.ok(!c0.form && c0.forms === 0 && c0.ekh === 'send', 'no <form>, enterkeyhint=send');
  assert.ok(c0.pillKids === 1 && c0.pillBtns === 0 && !c0.emoji, 'nothing but the text field inside the pill');
  assert.ok(!c0.sendVis && c0.micVis && c0.plusRight && c0.trailLeft, 'empty: + right, mic at the trailing end, no send ' + JSON.stringify(c0));
  if (mob) assert.equal(c0.padB, '34px', 'safe-area bottom padding max(8, 34)');
  const input = view.locator('#waInput');
  if (mob) await input.tap(); else await input.click();
  await page.keyboard.type('تمام');
  const c1 = await cp();
  assert.ok(c1.sendVis && !c1.micVis && !c1.camVis && c1.trailLeft, 'text: send replaces mic at the trailing end ' + JSON.stringify(c1));
  await shot(page, vp.name + '-composer');
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  const c2 = await cp(); assert.ok(!c2.sendVis && c2.micVis, 'cleared: mic again');
  await input.blur();
  r.composer = { empty: c0, typing: c1 };

  // 9) lightbox: solid black, full viewport, only photo + close + download
  await img.scrollIntoViewIfNeeded();
  await view.locator('[data-wa-media-open][data-wa-mid="Limg"]').click();
  const lb = await page.evaluate(() => { const l = document.querySelector('[data-wa-lightbox]'), r2 = l.getBoundingClientRect(), pts = [[2, 2], [innerWidth - 2, 2], [2, innerHeight - 2], [innerWidth - 2, innerHeight - 2]];
    return { bg: getComputedStyle(l).backgroundColor, x: r2.left, y: r2.top, w: r2.width, h: r2.height, vw: innerWidth, vh: innerHeight, cover: pts.every(([x, y]) => l.contains(document.elementFromPoint(x, y))), ctrls: [...l.querySelectorAll('button,a')].map((b) => b.getAttribute('aria-label')) }; });
  assert.equal(lb.bg, 'rgb(0, 0, 0)'); assert.ok(lb.x === 0 && lb.y === 0 && lb.w === lb.vw && lb.h === lb.vh && lb.cover, 'fullscreen ' + JSON.stringify(lb));
  assert.deepEqual(lb.ctrls, ['إغلاق', 'تحميل الصورة']);
  await shot(page, vp.name + '-lightbox');
  await page.keyboard.press('Escape');
  r.lightbox = lb;

  assert.deepEqual(st.other, [], 'no non-GET request at all (no WhatsApp send)');
  assert.deepEqual(errors, [], 'no page errors');
  r.nonGet = st.other.length;
  await ctx.close();
}

// load-more before the 300 cap: a full first page shows «تحميل محادثات أقدم»; the next page (before=<oldest>) is appended, GET only
{
  const big = Array.from({ length: 300 }, (_, i) => ({ id: 'wa_2012' + String(i).padStart(6, '0'), customer: 'عميل ' + i, updatedAt: NOW - i * H, count: 1, last: { id: 'b' + i, dir: 'in', kind: 'in', text: 'سلام', at: NOW - i * H } }));
  const extra = Array.from({ length: 5 }, (_, i) => ({ id: 'wa_2013' + String(i).padStart(6, '0'), customer: 'أقدم ' + i, updatedAt: NOW - (300 + i) * H, count: 1, last: { id: 'e' + i, dir: 'out', kind: 'pharm', text: 'تمام', at: NOW - (300 + i) * H, status: 'read' } }));
  const { ctx, page, view, st, errors } = await setup({ width: 390, height: 844, touch: true }, { list: (u) => (/before=/.test(u) ? extra : big), first: big[0].id });
  assert.equal(await page.locator('#waList [data-conv]').count(), 300);
  await page.evaluate(() => { const l = document.getElementById('waList'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => document.querySelectorAll('#waList [data-conv]').length === 305);
  await page.waitForSelector('[data-wa-more-done]');
  const before = st.gets.filter((u) => /conversations\?before=\d+&limit=300/.test(u));
  assert.equal(before.length, 1, 'one cursor GET for the older page');
  assert.equal(new Set(await page.evaluate(() => [...document.querySelectorAll('#waList [data-conv]')].map((b) => b.dataset.conv))).size, 305, 'no duplicates');
  assert.deepEqual(st.other, []); assert.deepEqual(errors, []);
  report.loadMore = { first: 300, after: 305, cursorGets: before.length, nonGet: st.other.length };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.log('ux408-wa-ios: ALL PASS (390x844 iPhone UA + safe-area, 1366x768, load-more; 0 non-GET requests)');
