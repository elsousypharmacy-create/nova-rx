// UX400b: conversations screen = WhatsApp Web frame. Desktop 1366x768 split list+pane, mobile 390x844 list OR chat with back.
// Covers: avatar/name/preview/time/unread, search, pin/archive affordances (row menu), header, wallpaper, composer shell, RTL,
// no horizontal overflow, stable frame (no layout jump on select), no PIN UI. Fake data only: history API mocked (401 if a PIN
// header is sent), one local chat seeded in localStorage. Every non-GET request is aborted and must stay at zero.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux400b-wa-frame.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.now() - 3600e3;
const CONVS = [
  { id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T + 3000, count: 2, last: { id: 'h1_2', dir: 'out', kind: 'bot', text: 'متوفر يا فندم', at: T + 3000, status: 'delivered' } },
  { id: 'wa_201000000002', customer: 'كريم الاختبار', updatedAt: T + 2000, count: 1, last: { id: 'h2_1', dir: 'in', kind: 'in', text: 'محتاج روشتة الضغط', at: T + 2000, status: null } },
  { id: 'wa_201000000003', customer: 'سارة النموذجية', updatedAt: T + 1000, count: 1, last: { id: 'h3_1', dir: 'in', kind: 'in', text: 'شكراً', at: T + 1000, status: null } },
];
const FULL = Object.fromEntries(CONVS.map((c) => [c.id, { id: c.id, customer: c.customer, updatedAt: c.updatedAt, messages: [
  { id: c.id + '_0', dir: 'in', kind: 'in', text: 'السلام عليكم', at: c.updatedAt - 500, status: null }, c.last] }]));
const LOCAL = { seq: 3, conversations: [{ id: 'loc-1', customer: 'هالة المحلية', mode: 'bot', assignee: null, updatedAt: T + 4000, messages: [
  { id: 'm1', dir: 'out', text: 'أهلاً', at: T + 3500, status: 'delivered' },
  { id: 'm2', dir: 'in', text: 'عايزة أسأل عن فيتامين د', at: T + 3800, status: null },
  { id: 'm3', dir: 'in', text: 'متاح؟', at: T + 4000, status: null }] }] };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const out = {};
const noOverflow = (page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))); // UX404: let the 200ms slide finish
  const d = document.documentElement, r = document.querySelector('#novaInboxView .wa-root');
  return { doc: d.scrollWidth - d.clientWidth, root: r ? r.scrollWidth - r.clientWidth : -1 };
});
for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch });
  const blocked = [], pinHdr = [];
  await ctx.addInitScript((local) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('nova.inbox.v1', local); sessionStorage.setItem('__seeded', '1'); } }, JSON.stringify(LOCAL));
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { blocked.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== undefined) { pinHdr.push(u); return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"ok":false,"code":"PIN_INVALID"}' }); }
      const id = decodeURIComponent((u.match(/[?&]id=([^&]+)/) || u.match(/conversation\/([^/?]+)/) || [])[1] || '');
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL[id] || FULL[CONVS[0].id] };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  const root = view.locator('.wa-root');
  await view.locator('[data-conv="wa_201000000003"]').waitFor();
  const info = {};

  // RTL + no PIN UI
  assert.equal(await root.getAttribute('dir'), 'rtl');
  assert.equal(await root.getAttribute('data-wa-inbox-open'), '');
  assert.equal(await view.locator('input[type=password], [data-wa-lock], #waHistPin').count(), 0, 'UX400: no PIN UI');

  // list rows: avatar, name, preview, time; unread badge on the local chat; newest first
  const ids = await view.locator('#waList [data-conv]').evaluateAll((bs) => bs.map((b) => b.dataset.conv));
  assert.deepEqual(ids, ['loc-1', 'wa_201000000001', 'wa_201000000002', 'wa_201000000003'], 'newest first');
  const row = view.locator('#waList [data-conv="loc-1"]');
  assert.equal(await row.locator('.wa-avatar').innerText(), 'ه');
  assert.equal(await row.locator('.wa-name').innerText(), 'هالة المحلية');
  assert.match(await row.locator('.wa-preview').innerText(), /متاح؟/);
  assert.match(await row.locator('.wa-ctime').innerText(), /^\d\d:\d\d$/);
  assert.equal(await row.locator('.wa-badge').getAttribute('data-unread'), '2');
  // RTL row: avatar on the right, time on the left of the name
  const av = await row.locator('.wa-avatar').boundingBox(), nm = await row.locator('.wa-name').boundingBox(), tm = await row.locator('.wa-ctime').boundingBox();
  assert.ok(av.x > nm.x && nm.x > tm.x, 'RTL row order: avatar | name | time');

  if (!vp.touch) {
    // desktop split: list on the right (RTL start), pane on the left, both visible, intro pane before a chat is chosen
    const side = await view.locator('.wa-side').boundingBox(), main = await view.locator('.wa-main').boundingBox();
    assert.ok(side.x > main.x, 'list at RTL start (right)');
    assert.ok(side.width >= 280 && side.width <= 420, 'list width ' + side.width);
    assert.ok(main.width > side.width, 'pane wider than list');
    assert.ok(await view.locator('[data-wa-intro]').isVisible(), 'intro pane');
    assert.match(await view.locator('.wa-main .wa-empty').innerText(), /اختر محادثة لعرضها/);
    // row menu is hover-revealed on desktop (opacity), never shifts the layout
    const mb = view.locator('[data-wa-menu="wa_201000000002"]');
    assert.equal(await mb.evaluate((e) => getComputedStyle(e).opacity), '0', 'menu hidden until hover');
    await view.locator('[data-conv="wa_201000000002"]').hover();
    await page.waitForTimeout(200);
    assert.equal(await mb.evaluate((e) => getComputedStyle(e).opacity), '1', 'menu shows on hover');
    info.side = Math.round(side.width);
  } else {
    // mobile: list only
    assert.equal(await view.locator('.wa-main').isVisible(), false, 'mobile list view hides pane');
    const sb = await view.locator('.wa-side').boundingBox();
    assert.ok(Math.abs(sb.width - (await root.boundingBox()).width) <= 2, 'list is full width');
    const mb = await view.locator('[data-wa-menu="wa_201000000002"]').boundingBox();
    assert.ok(mb.width >= 44 && mb.height >= 44, `touch menu ${mb.width}x${mb.height}`);
    assert.equal(await view.locator('[data-wa-menu="wa_201000000002"]').evaluate((e) => getComputedStyle(e).opacity), '1');
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux400b-${vp.name}-list.png` });

  // search: Arabic-insensitive, clear restores the list
  await view.locator('#waSearch').fill('كريم');
  assert.deepEqual(await view.locator('#waList [data-conv]').evaluateAll((bs) => bs.map((b) => b.dataset.conv)), ['wa_201000000002']);
  await view.locator('#waSearchClear').click();
  assert.equal(await view.locator('#waList [data-conv]').count(), 4);

  // pin: options menu -> «تثبيت المحادثة» moves the chat to the top with a pin icon
  await view.locator('[data-wa-menu="wa_201000000003"]').click();
  const menu = view.locator('[data-wa-menu-for="wa_201000000003"]');
  assert.ok(await menu.isVisible(), 'menu open');
  assert.equal(await view.locator('[data-wa-menu="wa_201000000003"]').getAttribute('aria-expanded'), 'true');
  const mbox = await menu.boundingBox(), lbox = await view.locator('#waList').boundingBox();
  assert.ok(mbox.x >= lbox.x - 1 && mbox.x + mbox.width <= lbox.x + lbox.width + 1, 'menu inside the list horizontally');
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0, 'Escape closes menu');
  await view.locator('[data-wa-menu="wa_201000000003"]').click();
  await view.locator('[data-wa-pin="wa_201000000003"]').click();
  assert.equal(await view.locator('#waList [data-conv]').first().getAttribute('data-conv'), 'wa_201000000003', 'pinned first');
  assert.equal(await view.locator('[data-wa-item][data-pinned] [data-wa-pinned]').count(), 1, 'pin icon');
  // archive: chat leaves the main list, «المؤرشفة» row appears with a count; open/close the archived view
  await view.locator('[data-wa-menu="wa_201000000001"]').click();
  await view.locator('[data-wa-arch="wa_201000000001"]').click();
  assert.equal(await view.locator('#waList [data-conv="wa_201000000001"]').count(), 0, 'archived chat hidden');
  assert.equal(await view.locator('[data-wa-arch-open] [data-arch-count]').innerText(), '1');
  await view.locator('[data-wa-arch-open]').click();
  assert.deepEqual(await view.locator('#waList [data-conv]').evaluateAll((bs) => bs.map((b) => b.dataset.conv)), ['wa_201000000001'], 'archived view');
  await view.locator('[data-wa-arch-close]').click();
  assert.equal(await view.locator('#waList [data-conv]').count(), 3);
  // search still finds archived chats
  await view.locator('#waSearch').fill('منى');
  assert.deepEqual(await view.locator('#waList [data-conv]').evaluateAll((bs) => bs.map((b) => b.dataset.conv)), ['wa_201000000001']);
  await view.locator('#waSearchClear').click();

  // open a chat: header, wallpaper, composer shell
  const sideBefore = vp.touch ? null : await view.locator('.wa-side').boundingBox();
  await view.locator('[data-conv="wa_201000000002"]').click();
  await view.locator('[data-mid="h2_1"]').waitFor();
  const head = view.locator('.wa-head');
  assert.equal(await head.locator('.wa-avatar').innerText(), 'ك');
  assert.equal(await head.locator('.wa-head-name').innerText(), 'كريم الاختبار');
  const msgs = view.locator('#waMsgs');
  assert.equal(await msgs.getAttribute('data-wa-wallpaper'), '');
  assert.match(await msgs.evaluate((e) => getComputedStyle(e).backgroundImage), /^url\("data:image\/svg\+xml/, 'wallpaper image');
  const comp = view.locator('[data-wa-composer]');
  const cb = await comp.boundingBox(), mn = await view.locator('.wa-main').boundingBox(), hb = await head.boundingBox(), mb2 = await msgs.boundingBox();
  assert.ok(Math.abs(cb.y + cb.height - (mn.y + mn.height)) <= 2, 'composer pinned to the pane bottom');
  assert.ok(hb.y < mb2.y && mb2.y + mb2.height <= cb.y + 1, 'header | messages | composer stacked');
  assert.ok(cb.y + cb.height <= vp.height + 1, 'composer inside the viewport');
  assert.equal(await comp.locator('#waInput').count(), 1);
  assert.equal(await comp.locator('.wa-send').count(), 1);
  const ib = await comp.locator('#waInput').boundingBox(), sbtn = await comp.locator('.wa-send').boundingBox();
  assert.ok(ib.x > sbtn.x, 'RTL composer: input then send on the left');
  if (!vp.touch) {
    const sideAfter = await view.locator('.wa-side').boundingBox();
    assert.deepEqual([sideAfter.x, sideAfter.width], [sideBefore.x, sideBefore.width], 'frame stable on select (no jump)');
    assert.ok(await view.locator('.wa-side').isVisible(), 'list stays visible on desktop');
    assert.equal(await head.locator('[data-wa-back]').isVisible(), false, 'no back on desktop');
  } else {
    assert.equal(await view.locator('.wa-side').isVisible(), false, 'mobile chat view hides list');
    const bk = head.locator('[data-wa-back]');
    const bb = await bk.boundingBox();
    assert.ok(bb.width >= 44 && bb.height >= 44 && bb.x > hb.x + hb.width / 2, 'back 44px at RTL start');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux400b-mobile-chat.png` });
    await bk.click();
    await view.locator('#waList [data-conv="wa_201000000002"]').waitFor();
    assert.ok(await view.locator('.wa-side').isVisible(), 'back -> list');
    assert.equal(await view.locator('.wa-main').isVisible(), false);
    await view.locator('[data-conv="wa_201000000002"]').click();
  }
  if (SHOTS && !vp.touch) await page.screenshot({ path: `${SHOTS}/ux400b-desktop-chat.png` });
  const ov = await noOverflow(page);
  assert.ok(ov.doc <= 0 && ov.root <= 0, 'no horizontal overflow ' + JSON.stringify(ov));
  // pin/archive never written to storage (chat ids can be phone numbers)
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('wa_201000000003') || JSON.stringify(sessionStorage).includes('wa_201000000003')), false, 'no chat ids in storage');
  assert.deepEqual(blocked, [], 'no non-GET'); assert.deepEqual(pinHdr, [], 'no PIN header'); assert.deepEqual(errors, []);
  out[vp.name] = Object.assign(info, { overflow: ov });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out));
console.log('ux400b-wa-frame OK');
