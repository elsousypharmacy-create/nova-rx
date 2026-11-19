// UX402: realtime conversations like WhatsApp Web. Pure helpers in unified-inbox.js (poll cadence/backoff, no duplicate bubbles,
// which bubbles animate in, mute-if-already-viewing toast rule, Arabic toast + browser Notification content) and the index.html
// wiring (self-scheduling poll, no setInterval, visibilitychange resume, header badge = live count, Notification fallback).
// Run: node tests/unit/ux402-wa-realtime.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const h = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('pollDelay: 4s on screen, 15s on another screen, paused when the tab is hidden', () => {
  assert.equal(U.pollDelay({}), 4000);
  assert.equal(U.pollDelay({ screenHidden: true }), 15000);
  assert.equal(U.pollDelay({ docHidden: true }), null, 'hidden tab => paused');
  assert.equal(U.pollDelay({ docHidden: true, screenHidden: true }), null);
  assert.equal(U.pollDelay({ docHidden: true, notifyBg: true }), 30000, 'Notification granted without Web Push => slow 30s');
});
t('pollDelay: exponential backoff on errors, capped at 60s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 20].map((f) => U.pollDelay({ fails: f })), [4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(U.pollDelay({ screenHidden: true, fails: 1 }), 30000);
  assert.equal(U.pollDelay({ fails: -3 }), 4000); assert.equal(U.pollDelay({ fails: 'x' }), 4000);
  assert.ok(U.POLL_FG >= 3000, 'never hammers the API');
});
t('mergeLive: server thread + pending local bubbles, no duplicates', () => {
  const srv = [{ id: 'm1' }, { id: 'm2', clientId: 'abc' }];
  const loc = [{ id: 'tmp_abc', status: 'sending' }, { id: 'tmp_zzz', status: 'failed' }, { id: 'm1' }];
  assert.deepEqual(U.mergeLive(srv, loc).map((m) => m.id), ['m1', 'm2', 'tmp_zzz'], 'confirmed tmp dropped, failed kept, non-tmp ignored');
  assert.deepEqual(U.mergeLive(srv, [{ id: 'tmp_q', clientId: 'abc' }]).map((m) => m.id), ['m1', 'm2'], 'clientId match');
  assert.deepEqual(U.mergeLive(null, [{ id: 'tmp_a' }, { id: 'tmp_a' }]).map((m) => m.id), ['tmp_a'], 'tmp listed twice => once');
  assert.deepEqual(U.mergeLive(srv, null).length, 2);
  assert.notEqual(U.mergeLive(srv, []), srv, 'returns a new array');
  const at = 1000000, s2 = [{ id: 'ps_1', dir: 'out', text: 'تمام', at: at + 3000 }];
  assert.deepEqual(U.mergeLive(s2, [{ id: 'tmp_x', dir: 'out', text: 'تمام', at, status: 'sending' }]).map((m) => m.id), ['ps_1'], 'server row already there while sending => one bubble');
  assert.deepEqual(U.mergeLive(s2, [{ id: 'tmp_x', dir: 'out', text: 'تمام', at, status: 'sending' }, { id: 'tmp_y', dir: 'out', text: 'تمام', at: at + 1, status: 'sending' }]).map((m) => m.id), ['ps_1', 'tmp_y'], 'two sends of the same text => the second still shows');
  assert.deepEqual(U.mergeLive(s2, [{ id: 'tmp_x', dir: 'out', text: 'تمام', at, status: 'failed' }]).map((m) => m.id), ['ps_1', 'tmp_x'], 'a failed bubble is never hidden');
  assert.deepEqual(U.mergeLive(s2, [{ id: 'tmp_x', dir: 'out', text: 'تمام', at: at + 300000, status: 'sending' }]).map((m) => m.id), ['ps_1', 'tmp_x'], 'old same text is a different message');
  assert.deepEqual(U.mergeLive([{ id: 'ps_2', dir: 'out', text: '[صورة] روشتة', at }], [{ id: 'tmp_p', dir: 'out', text: 'روشتة', at, status: 'sending' }]).map((m) => m.id), ['ps_2'], 'photo caption matches its [صورة] row');
  assert.deepEqual(U.mergeLive([{ id: 'wa_9', dir: 'in', text: 'تمام', at }], [{ id: 'tmp_x', dir: 'out', text: 'تمام', at, status: 'sending' }]).map((m) => m.id), ['wa_9', 'tmp_x'], 'the customer saying the same word is not a twin');
});
t('newIds: first render none, later only ids not on screen before', () => {
  assert.deepEqual(U.newIds(null, ['a', 'b']), []);
  assert.deepEqual(U.newIds({ a: 1 }, ['a', 'b', 'c']), ['b', 'c']);
  assert.deepEqual(U.newIds({ a: 1, b: 1 }, ['a', 'b']), []);
});
t('toastFor: mute if already viewing that chat; toast for other chats / other screens', () => {
  const fr = [{ id: 'A', text: 'x' }, { id: 'B', text: 'y' }];
  assert.deepEqual(U.toastFor(fr, { screenVisible: true, selected: 'A' }).map((f) => f.id), ['B'], 'chat on screen is muted');
  assert.deepEqual(U.toastFor(fr, { screenVisible: true, selected: null }), [], 'chat list on screen => the list row itself updates, no toast');
  assert.deepEqual(U.toastFor(fr, { screenVisible: false, selected: 'A' }).map((f) => f.id), ['A', 'B'], 'another screen => toast');
  assert.deepEqual(U.toastFor(fr, { screenVisible: true, docHidden: true, selected: 'A' }).map((f) => f.id), ['A', 'B'], 'tab hidden => not viewing');
  assert.deepEqual(U.toastFor([null, { id: null }], {}), []);
});
t('toastHtml: Arabic, escaped, one toast, open + close buttons', () => {
  assert.equal(U.toastHtml([]), '');
  const x = U.toastHtml([{ id: 'A', customer: '<b>منى</b>', text: 'عايزة\n  بنادول' }]);
  assert.match(x, /رسالة جديدة من &lt;b&gt;منى&lt;\/b&gt;/); assert.ok(!x.includes('<b>'));
  assert.match(x, /data-wa-toast-open="A"/); assert.match(x, /data-wa-toast-x/); assert.match(x, /عايزة بنادول/);
  const y = U.toastHtml([{ id: 'A', customer: 'منى', text: 'a' }, { id: 'B', customer: 'سعيد', text: 'z'.repeat(200) }]);
  assert.match(y, /data-wa-toast-open="B"/); assert.match(y, /رسالة جديدة من سعيد/); assert.match(y, /و1 محادثة تانية/);
  assert.ok(y.includes('…') && !y.includes('z'.repeat(91)), 'long text truncated');
  assert.match(U.toastHtml([{ id: 'C' }]), /رسالة جديدة من عميل/);
});
t('notifContent: short Arabic title, never a phone number in the title, tag per chat', () => {
  assert.equal(U.notifContent([]), null);
  const a = U.notifContent([{ id: 'wa_201000000402', customer: 'منى', text: 'محتاجة روشتة' }]);
  assert.equal(a.title, 'رسالة جديدة من منى'); assert.equal(a.body, 'محتاجة روشتة'); assert.equal(a.chat, 'wa_201000000402');
  assert.ok(a.tag.startsWith('nova-wa-') && !a.tag.includes('201000000402'), 'tag hashes the chat id');
  assert.equal(U.notifContent([{ id: 'x', customer: '+20 100 000 0402', text: 'a' }]).title, 'رسالة جديدة من عميل');
  assert.equal(U.notifContent([{ id: 'x' }, { id: 'y' }]).title, '2 رسائل جديدة على واتساب');
  assert.ok(U.notifContent([{ id: 'x', text: 'q'.repeat(300) }]).body.length <= 120);
});
t('TOAST_CSS: RTL, 44px targets, reduced motion, mobile full width', () => {
  for (const s of ['direction:rtl', 'min-height:44px', 'prefers-reduced-motion', 'max-width:780px', '#novaWaToast[hidden]']) assert.ok(U.TOAST_CSS.includes(s), s);
  assert.ok(U.renderWa([], {}).includes('.wa-msg[data-live]{animation:waPop'), 'live bubble slide-in CSS');
});
t('index.html inline copy has the same UX402 helpers as unified-inbox.js', () => {
  const src = readFileSync(new URL('../../unified-inbox.js', import.meta.url), 'utf8');
  for (const fn of ['function pollDelay(o)', 'function mergeLive(server, local)', 'function toastFor(fresh, o)', 'function notifContent(items)']) {
    const body = (s) => { const i = s.indexOf(fn); assert.ok(i >= 0, fn); return s.slice(i, s.indexOf('\n  }', i)); };
    assert.equal(body(h), body(src), fn + ' in sync');
  }
});
t('index.html wiring: self-scheduling poll (no 4s setInterval), resume on visibilitychange, backoff counter, dedupe', () => {
  assert.ok(!h.includes('setInterval(hPoll'), 'no setInterval pile-up');
  assert.ok(h.includes('function hSched(){') && h.includes('U.pollDelay({docHidden:document.hidden,screenHidden:box.hidden,notifyBg:hBgN(),fails:hist.fails})'));
  assert.ok(/visibilitychange',function\(\)\{if\(!document\.hidden\)hPoll\(\);hSched\(\)\}/.test(h));
  assert.ok(h.includes('hist.fails=(hist.fails||0)+1') && h.includes('hist.fails=0'));
  assert.ok(h.includes('U.mergeLive(r.conversation.messages,loc)'));
  assert.ok(/function hPoll\(\)\{if\(\(document\.hidden&&!hBgN\(\)\)/.test(h), 'hPoll pauses when the tab is hidden');
  assert.ok(!/function hPoll\(\)\{if\(box\.hidden/.test(h), 'hPoll keeps running on another screen (badges + toast)');
});
t('index.html wiring: toast + Notification fallback, header badge, smooth insert', () => {
  for (const s of ['nToast(U.toastFor(fresh,{screenVisible:!box.hidden,docHidden:hid,selected:wa.sel}))', 'new Notification(c.title,o)', 'showNotification(c.title,o)', 'function lMark(pm)', "x.setAttribute('data-live','')", 'window.NovaWaBadge.paint(n)', 'L.live()', 'toast:nToast,notify:nSys']) assert.ok(h.includes(s), s);
  const sys = /function nSys\(f\)\{[\s\S]*?\n/.exec(h)[0];
  assert.ok(sys.includes('try{var n=new Notification') && sys.includes('catch(e)'), 'Notification constructor guarded (fallback)');
  assert.ok(/if\(hid&&g\)nSys\(f\)/.test(h), 'system notification only when hidden + granted');
  assert.ok(!/fetch\([^)]*method:'POST'[^)]*inbox\/history\/(?:conversations|conversation\?)/.test(h), 'poll stays GET');
});
console.log('ux402-wa-realtime.check:', n, 'passed');
