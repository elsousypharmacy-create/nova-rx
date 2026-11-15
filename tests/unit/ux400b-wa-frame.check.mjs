// UX400b: WhatsApp Web frame (pure HTML): pin/archive list meta, row options menu, wallpaper, intro pane, composer shell, no PIN UI.
// Also guards that unified-inbox.js is byte-identical to the inline lib in index.html (the page runs the inline copy).
// Run: node tests/unit/ux400b-wa-frame.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const file = readFileSync(new URL('../../unified-inbox.js', import.meta.url), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('unified-inbox.js == inline fix43-inbox-lib', () => assert.equal(page.match(/<script id="fix43-inbox-lib">([\s\S]*?)<\/script>/)[1], file));

const NOW = new Date(2026, 10, 15, 12, 0).getTime();
const C = [
  { id: 'a', customer: 'أحمد', updatedAt: NOW - 1000, messages: [{ id: 'a1', dir: 'in', text: 'مرحبا', at: NOW - 1000 }] },
  { id: 'b', customer: 'بسمة', updatedAt: NOW - 2000, messages: [{ id: 'b1', dir: 'out', text: 'تمام', at: NOW - 2000, status: 'delivered' }] },
  { id: 'c"<x', customer: 'سامي', updatedAt: NOW - 3000, messages: [{ id: 'c1', dir: 'in', text: 'فين الطلب', at: NOW - 3000 }] },
];
const ids = (h) => (h.match(/data-conv="([^"]+)"/g) || []).map((x) => x.slice(11, -1));

t('no meta => old behaviour (newest first, no archived row)', () => {
  const h = U.chatListHtml(C, null, '', NOW);
  assert.deepEqual(ids(h), ['a', 'b', 'c&quot;&lt;x']);
  assert.ok(!h.includes('data-wa-arch-open'));
  assert.ok(!h.includes('data-wa-pinned'));
});
t('each row: avatar, name, time, preview, unread badge, options button', () => {
  const h = U.chatListHtml(C, 'a', '', NOW);
  assert.match(h, /<div class="wa-item" data-wa-item><button type="button" class="wa-chat active unread" data-conv="a" aria-current="true">/);
  assert.match(h, /class="wa-avatar" aria-hidden="true">أ</);
  assert.match(h, /class="wa-ctime">11:59</);
  assert.match(h, /data-unread="1"/);
  assert.match(h, /data-wa-menu="a" aria-haspopup="menu" aria-expanded="false" aria-label="خيارات المحادثة مع أحمد"/);
  assert.ok(!/<button[^>]*data-conv[^>]*>[^]*?<button[^>]*data-wa-menu[^>]*>[^]*?<\/button><\/button>/.test(h.split('data-wa-item')[1]), 'menu button is not nested in the chat button');
});
t('pinned chats sort first and show a pin icon', () => {
  const h = U.chatListHtml(C, null, '', NOW, false, { pinned: { 'c"<x': 1 } });
  assert.deepEqual(ids(h), ['c&quot;&lt;x', 'a', 'b']);
  assert.equal((h.match(/data-wa-pinned/g) || []).length, 1);
  assert.match(h, /class="wa-item pinned" data-wa-item data-pinned>/);
});
t('two pinned keep recency order among themselves', () => {
  assert.deepEqual(ids(U.chatListHtml(C, null, '', NOW, false, { pinned: { b: 1, 'c"<x': 1 } })), ['b', 'c&quot;&lt;x', 'a']);
});
t('archived chats leave the main list into one counted «المؤرشفة» row', () => {
  const h = U.chatListHtml(C, null, '', NOW, false, { archived: { b: 1 } });
  assert.deepEqual(ids(h), ['a', 'c&quot;&lt;x']);
  assert.match(h, /^<button type="button" class="wa-archrow" data-wa-arch-open>/);
  assert.match(h, /data-arch-count="1">1</);
});
t('archived view lists only archived chats with a back row', () => {
  const h = U.chatListHtml(C, null, '', NOW, false, { archived: { b: 1 }, showArchived: true });
  assert.deepEqual(ids(h), ['b']);
  assert.match(h, /^<button type="button" class="wa-archhead" data-wa-arch-close aria-label="رجوع إلى كل المحادثات">/);
  assert.match(h, /class="wa-item archived" data-wa-item data-archived>/);
});
t('archived view with nothing archived falls back to the main list', () => {
  assert.deepEqual(ids(U.chatListHtml(C, null, '', NOW, false, { archived: {}, showArchived: true })), ['a', 'b', 'c&quot;&lt;x']);
});
t('search looks across archived chats too and hides the archived row', () => {
  const h = U.chatListHtml(C, null, 'بسمه', NOW, false, { archived: { b: 1 } });
  assert.deepEqual(ids(h), ['b']);
  assert.ok(!h.includes('data-wa-arch-open'));
  assert.ok(U.chatListHtml(C, null, 'zz', NOW, false, { archived: { b: 1 } }).startsWith('<div class="wa-empty" data-wa-noresult>'));
});
t('all archived => archived row + empty note', () => {
  const h = U.chatListHtml(C, null, '', NOW, false, { archived: { a: 1, b: 1, 'c"<x': 1 } });
  assert.match(h, /data-arch-count="3"/);
  assert.match(h, /لا توجد محادثات<\/div>$/);
});
t('open menu: pin/archive menuitems with toggled labels, ids escaped', () => {
  let h = U.chatListHtml(C, null, '', NOW, false, { menu: 'c"<x' });
  assert.match(h, /data-wa-menu="c&quot;&lt;x" aria-haspopup="menu" aria-expanded="true"/);
  assert.match(h, /<div class="wa-menu" role="menu" data-wa-menu-for="c&quot;&lt;x"><button type="button" role="menuitem" data-wa-pin="c&quot;&lt;x">/);
  assert.match(h, />تثبيت المحادثة</); assert.match(h, />أرشفة المحادثة</);
  assert.equal((h.match(/role="menu"/g) || []).length, 1, 'only one menu open');
  h = U.chatListHtml(C, null, '', NOW, false, { menu: 'b', pinned: { b: 1 }, archived: { b: 1 }, showArchived: true });
  assert.match(h, />إلغاء تثبيت المحادثة</); assert.match(h, />إلغاء أرشفة المحادثة</);
});
t('renderWa passes list meta, no selection => intro pane', () => {
  const h = U.renderWa(C, { now: NOW, list: { archived: { a: 1 } } });
  assert.match(h, /data-wa-arch-open/);
  assert.match(h, /<section class="wa-main wa-noselect"><div class="wa-empty wa-intro" data-wa-intro>/);
  assert.match(h, /اختر محادثة لعرضها/);
  assert.ok(!h.includes('data-wa-composer'), 'no composer without a chat');
});
t('selected chat: header, wallpaper, composer shell; RTL root', () => {
  const h = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: true });
  assert.match(h, /<div class="wa-root" dir="rtl" data-wa-root data-wa-inbox-open data-view="chat">/);
  assert.match(h, /<div class="wa-head"><button type="button" class="wa-back" data-wa-back aria-label="رجوع إلى المحادثات">/);
  assert.match(h, /class="wa-head-name">أحمد</);
  assert.match(h, /<div class="wa-msgs" id="waMsgs" data-wa-wallpaper role="log"/);
  assert.match(h, /<div class="wa-composer" id="waComposer" data-wa-composer role="group" aria-label="كتابة رسالة"><div class="wa-pill">.*?<input type="text" id="waInput"/ /* UX404 pill; UX407: not a <form> (no iOS prev/next bar) */);
  assert.ok(!/<form/.test(h), 'UX407: no <form> in the conversations frame');
  assert.match(h, /\.wa-msgs\{background-color:#0b0d10;background-image:url\("data:image\/svg\+xml,%3Csvg/);
});
t('UX400 stays: no PIN UI anywhere in the frame', () => {
  const h = U.renderWa(C, { now: NOW, selected: 'a' }) + U.renderWa([], { now: NOW, loading: true });
  assert.ok(!/PIN|type="password"|waHistPin|data-wa-lock/.test(h));
});
t('touch: options button is a 44px target; desktop: hover-revealed', () => {
  const h = U.renderWa(C, { now: NOW });
  assert.match(h, /@media\(pointer:coarse\),\(max-width:700px\)\{\.wa-item \.wa-chat\{padding-inline-end:56px\}[^@]*\.wa-rowmenu\{width:44px;height:44px;/);
  assert.match(h, /@media\(hover:hover\) and \(pointer:fine\)\{\.wa-rowmenu\{opacity:0\}/);
});
t('controller keeps pin/archive in memory only (never storage)', () => {
  const ctl = page.slice(page.indexOf('var wa={sel:null'), page.indexOf("<style id=\"ux209-wa-target\">"));
  assert.match(ctl, /pin:\{\},arch:\{\},showArch:false,menu:null/);
  assert.ok(!/(localStorage|sessionStorage)\.setItem\([^)]*(wa\.pin|wa\.arch)/.test(ctl));
  assert.match(ctl, /U\.chatListHtml\(convs\(\),wa\.sel,wa\.q,Date\.now\(\),false,listMeta\(\)\)/);
});
console.log(`ux400b-wa-frame.check: ${n} passed`);
