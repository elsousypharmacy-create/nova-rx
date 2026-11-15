// UX413: standalone PWA conversations list is flush on the bottom edge (no near-black band)
// and content sits ~16px + safe-area away from the left/right edges (WhatsApp iOS spacing).
// 390x844, iPhone UA, display-mode: standalone, --wa-sat 47 / --wa-sab 34. Fake data only; every non-GET aborted.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux413-wa-bottom.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T00:50:00+03:00');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const origin = new URL(BASE).origin;
const convs = Array.from({ length: 12 }, (_, i) => {
  const id = 'wa_2010000004' + String(13 + i).padStart(2, '0');
  return {
    id,
    customer: 'تجربة ' + (i + 1),
    updatedAt: NOW - i * 3600000,
    count: 1,
    last: { id: 'm' + i, dir: 'in', kind: 'in', text: 'رسالة ' + (i + 1), at: NOW - i * 3600000 },
  };
});
const msgs = [
  { id: 'm1', dir: 'in', kind: 'in', text: 'ازيك', at: NOW - 120000 },
  { id: 'm2', dir: 'out', kind: 'pharm', text: 'الحمد لله', at: NOW - 60000, status: 'read' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh',
  serviceWorkers: 'block', hasTouch: true, isMobile: true, userAgent: IPHONE_UA,
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    if (String(q).includes('display-mode: standalone')) {
      return {
        matches: true, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false; },
      };
    }
    return real(q);
  };
});
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (q.method() === 'OPTIONS' && u.includes('/api/v1/inbox/history/')) return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type,accept' } });
  if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
  if (u.includes('/api/v1/inbox/history/')) {
    const body = u.includes('/conversations')
      ? { ok: true, conversations: convs }
      : { ok: true, conversation: { id: convs[0].id, customer: convs[0].customer, updatedAt: NOW, messages: msgs } };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE + '?app=whatsapp', { waitUntil: 'load' });
await page.evaluate(() => {
  document.documentElement.style.setProperty('--wa-sat', '47px');
  document.documentElement.style.setProperty('--wa-sab', '34px');
  document.documentElement.style.setProperty('--wa-sal', '0px');
  document.documentElement.style.setProperty('--wa-sar', '0px');
  if (window.NovaWaFitAppHeight) window.NovaWaFitAppHeight();
});
await page.waitForTimeout(400);
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${convs[0].id}"]`).waitFor();

const listGeom = await page.evaluate(() => {
  const v = document.getElementById('novaInboxView');
  const root = document.querySelector('[data-wa-root]');
  const side = document.querySelector('.wa-side');
  const list = document.getElementById('waList');
  const head = document.querySelector('.wa-side-head');
  const search = document.querySelector('.wa-search');
  const chips = document.querySelector('.wa-chips');
  const row = document.querySelector('.wa-chat');
  const title = document.querySelector('.wa-title');
  const vr = v.getBoundingClientRect(), lr = list.getBoundingClientRect(), sr = side.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const insetOf = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return { pl: cs.paddingLeft, pr: cs.paddingRight, pb: cs.paddingBottom, left: box.left, right: box.right, bg: cs.backgroundColor };
  };
  const contentBoxes = [...document.querySelectorAll('.wa-title, .wa-chat-body, .wa-search input, .wa-chip, .wa-avatar')]
    .filter((el) => el && el.getBoundingClientRect().height > 0)
    .map((el) => {
      const b = el.getBoundingClientRect();
      return { tag: el.className, left: b.left, right: b.right };
    });
  return {
    vh: innerHeight, vw: innerWidth,
    appH: getComputedStyle(document.documentElement).getPropertyValue('--wa-app-h').trim(),
    viewTop: vr.top, viewBottom: vr.bottom, viewH: vr.height,
    rootBottom: rr.bottom, sideBottom: sr.bottom,
    listBottom: lr.bottom, listPadB: getComputedStyle(list).paddingBottom, listBg: getComputedStyle(list).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    viewMaxH: getComputedStyle(v).maxHeight,
    standalone: !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)),
    head: insetOf(head), search: insetOf(search), chips: insetOf(chips), row: insetOf(row),
    contentBoxes,
    titleLeft: title ? title.getBoundingClientRect().left : null,
    titleRight: title ? title.getBoundingClientRect().right : null,
  };
});

assert.equal(listGeom.standalone, true, 'simulated standalone');
assert.equal(listGeom.appH, '844px', 'JS set --wa-app-h to window.innerHeight');
assert.equal(listGeom.viewTop, 0, 'inbox starts at the top');
assert.ok(Math.abs(listGeom.viewBottom - listGeom.vh) <= 1, 'inbox reaches the bottom ' + JSON.stringify({ viewBottom: listGeom.viewBottom, vh: listGeom.vh, maxH: listGeom.viewMaxH }));
assert.ok(Math.abs(listGeom.sideBottom - listGeom.vh) <= 1, 'list pane reaches the bottom');
assert.ok(Math.abs(listGeom.listBottom - listGeom.vh) <= 1, 'list scroll area reaches the bottom (no dark band / spacer)');
assert.equal(listGeom.listPadB, '34px', 'safe-area padding is inside the list scroll area');
assert.equal(listGeom.listBg, 'rgb(20, 23, 28)', 'list background #14171c');
assert.equal(listGeom.bodyBg, 'rgb(20, 23, 28)', 'body uses the list colour (not near-black #050607)');
assert.equal(listGeom.htmlBg, 'rgb(20, 23, 28)', 'html uses the list colour');
assert.ok(!listGeom.viewMaxH || listGeom.viewMaxH === 'none' || listGeom.viewMaxH === '844px', 'no 100dvh max-height cap ' + listGeom.viewMaxH);

function assertPad16(name, box) {
  assert.ok(box, name + ' exists');
  assert.equal(box.pl, '16px', name + ' padding-left 16px, got ' + box.pl);
  assert.equal(box.pr, '16px', name + ' padding-right 16px, got ' + box.pr);
}
assertPad16('header', listGeom.head);
assertPad16('search', listGeom.search);
assertPad16('chips', listGeom.chips);
assertPad16('list row', listGeom.row);

const EDGE = 16;
for (const b of listGeom.contentBoxes) {
  assert.ok(b.left + 0.5 >= EDGE, `content ${b.tag} left ${b.left} touches the edge`);
  assert.ok(b.right - 0.5 <= listGeom.vw - EDGE, `content ${b.tag} right ${b.right} touches the edge (vw=${listGeom.vw})`);
}

const list = page.locator('#waList');
await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(100);
const scrolled = await page.evaluate(() => {
  const list = document.getElementById('waList');
  const last = list && list.querySelector('.wa-chat:last-of-type, [data-conv]:last-of-type');
  const lr = list.getBoundingClientRect();
  const lastR = last ? last.getBoundingClientRect() : null;
  return { listBottom: lr.bottom, vh: innerHeight, lastBottom: lastR && lastR.bottom, lastRight: lastR && lastR.right, lastLeft: lastR && lastR.left };
});
assert.ok(Math.abs(scrolled.listBottom - scrolled.vh) <= 1, 'scrolled list still flush with the bottom ' + JSON.stringify(scrolled));
assert.ok(scrolled.lastBottom <= scrolled.vh + 1, 'last row is not below the viewport');

// --- open chat: composer flush on the bottom, horizontal inset, bubbles inset ---
await view.locator(`[data-conv="${convs[0].id}"]`).click();
await page.locator('#waComposer').waitFor();
await page.waitForFunction(() => {
  const main = document.querySelector('.wa-main');
  if (!main) return false;
  const tr = getComputedStyle(main).transform;
  return !tr || tr === 'none' || tr === 'matrix(1, 0, 0, 1, 0, 0)';
}, { timeout: 3000 });
const chatGeom = await page.evaluate(() => {
  const v = document.getElementById('novaInboxView');
  const root = document.querySelector('[data-wa-root]');
  const comp = document.querySelector('[data-wa-composer]') || document.getElementById('waComposer');
  const head = document.querySelector('.wa-head');
  const msgs = document.querySelector('.wa-msgs');
  const bubbles = [...document.querySelectorAll('.wa-bubble')].map((el) => el.getBoundingClientRect());
  const vr = v.getBoundingClientRect(), cr = comp.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const cs = getComputedStyle(comp);
  const hs = head ? getComputedStyle(head) : null;
  const ms = msgs ? getComputedStyle(msgs) : null;
  return {
    vh: innerHeight, vw: innerWidth,
    viewBottom: vr.bottom, rootBottom: rr.bottom,
    compTop: cr.top, compBottom: cr.bottom, compH: cr.height,
    padB: cs.paddingBottom, padL: cs.paddingLeft, padR: cs.paddingRight, marginB: cs.marginBottom, bg: cs.backgroundColor,
    headPL: hs && hs.paddingLeft, headPR: hs && hs.paddingRight,
    msgsPL: ms && ms.paddingLeft, msgsPR: ms && ms.paddingRight,
    kbd: root && root.getAttribute('data-kbd'),
    bubbles: bubbles.map((b) => ({ left: b.left, right: b.right })),
  };
});
assert.ok(Math.abs(chatGeom.viewBottom - chatGeom.vh) <= 1, 'chat container reaches the bottom ' + JSON.stringify(chatGeom));
assert.ok(Math.abs(chatGeom.compBottom - chatGeom.vh) <= 1, 'composer sits flush on the bottom edge ' + JSON.stringify(chatGeom));
assert.equal(chatGeom.padB, '42px', 'composer padding-bottom is 8 + 34 (safe-area inside the bar)');
assert.equal(chatGeom.padL, '16px', 'composer padding-left 16px');
assert.equal(chatGeom.padR, '16px', 'composer padding-right 16px');
assert.equal(chatGeom.headPL, '16px', 'chat header padding-left 16px');
assert.equal(chatGeom.headPR, '16px', 'chat header padding-right 16px');
assert.equal(chatGeom.msgsPL, '16px', 'message column padding-left 16px');
assert.equal(chatGeom.msgsPR, '16px', 'message column padding-right 16px');
assert.equal(chatGeom.marginB, '0px', 'no extra margin under the composer');
assert.ok(!chatGeom.kbd, 'keyboard not open: UX407 data-kbd is off');
for (const b of chatGeom.bubbles) {
  assert.ok(b.left + 0.5 >= EDGE, 'bubble left ' + b.left + ' touches the edge');
  assert.ok(b.right - 0.5 <= chatGeom.vw - EDGE, 'bubble right ' + b.right + ' touches the edge');
}

// safe-area left/right are added on top of the 16px inset
await page.evaluate(() => {
  document.documentElement.style.setProperty('--wa-sal', '12px');
  document.documentElement.style.setProperty('--wa-sar', '12px');
});
await page.waitForTimeout(50);
const withSafe = await page.evaluate(() => {
  const comp = document.querySelector('[data-wa-composer]') || document.getElementById('waComposer');
  const head = document.querySelector('.wa-head');
  const msgs = document.querySelector('.wa-msgs');
  const cs = getComputedStyle(comp), hs = getComputedStyle(head), ms = getComputedStyle(msgs);
  return { cL: cs.paddingLeft, cR: cs.paddingRight, hL: hs.paddingLeft, hR: hs.paddingRight, mL: ms.paddingLeft, mR: ms.paddingRight };
});
for (const [k, v] of Object.entries(withSafe)) assert.equal(v, '28px', k + ' should be 16+12, got ' + v);

assert.deepEqual(errors, []);
await browser.close();
console.log('ux413-wa-bottom OK');
