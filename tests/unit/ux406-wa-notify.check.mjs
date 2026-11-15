// UX406: unread tracker (per chat + total), document.title badge, permission/mute control HTML, list badge wiring,
// storage never holds chat ids, permission requested only from the button. Run: node tests/unit/ux406-wa-notify.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const mem = () => { const d = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const T0 = 1_000_000;
const conv = (id, msgs, extra) => ({ id, customer: 'عميل ' + id, updatedAt: 0, history: true, messages: msgs, ...extra });
const m = (id, dir, at, kind) => ({ id, dir, at, text: 'نص ' + id, kind: kind || (dir === 'in' ? 'in' : 'pharm') });

// UX408 (design review defect 1): the first-open baseline no longer hides chats that are WAITING for a reply. A history chat never opened on
// this device counts its trailing customer messages (after the last staff/bot reply), even when they are older than the first open.
t('UX408: never-opened chats count the waiting customer messages, also before the first open; replied chats count 0', () => {
  const u = U.createUnread(mem(), T0);
  const a = conv('wa_201', [m('1', 'in', T0 - 10), m('2', 'in', T0 + 5), m('3', 'in', T0 + 6)]);
  const b = conv('wa_202', [m('4', 'in', T0 - 5)]);
  const r = conv('wa_203', [m('5', 'in', T0 - 9), m('6', 'out', T0 - 8)]);
  assert.equal(u.count(a), 3); assert.equal(u.count(b), 1); assert.equal(u.count(r), 0);
  assert.equal(u.chats([a, b, r]), 2); assert.equal(u.messages([a, b, r]), 4);
  u.markSeen('wa_201', T0 + 6); assert.equal(u.count(a), 0, 'opened => only messages after the open count');
});
t('bot/pharmacist/system/outbound messages are not unread', () => {
  const u = U.createUnread(mem(), T0);
  const c = conv('wa_1', [m('1', 'out', T0 + 1), m('2', 'in', T0 + 2, 'bot'), m('3', 'in', T0 + 3, 'sys'), m('4', 'out', T0 + 4, 'pharm')]);
  assert.equal(u.count(c), 0);
});
t('markSeen clears one chat and survives reload; storage holds hashes only', () => {
  const s = mem(), u = U.createUnread(s, T0);
  const a = conv('wa_201555', [m('1', 'in', T0 + 5)]), b = conv('wa_202666', [m('2', 'in', T0 + 6)]);
  u.markSeen('wa_201555', T0 + 10);
  assert.deepEqual([u.count(a), u.count(b), u.chats([a, b])], [0, 1, 1]);
  const raw = s.d['nova.wa.seen.v1'];
  assert.ok(raw && !raw.includes('201555') && !raw.includes('wa_'), 'no chat id / phone in storage');
  const u2 = U.createUnread(s, T0 + 999999);
  assert.equal(u2.base(), T0, 'base kept across reloads');
  assert.deepEqual([u2.count(a), u2.count(b)], [0, 1]);
  const a2 = conv('wa_201555', [m('1', 'in', T0 + 5), m('9', 'in', T0 + 20)]);
  assert.equal(u2.count(a2), 1, 'a newer message after seen is unread again');
});
t('local (non-history) chats keep the trailing-inbound rule until opened', () => {
  const u = U.createUnread(mem(), T0);
  const c = { id: 'loc-1', customer: 'x', messages: [m('1', 'in', 1), m('2', 'out', 2), m('3', 'in', 3), m('4', 'in', 4)] };
  assert.equal(u.count(c), 2);
  u.markSeen('loc-1', 5); assert.equal(u.count(c), 0);
});
t('corrupt storage starts fresh', () => { const s = mem(); s.setItem('nova.wa.seen.v1', '{bad'); const u = U.createUnread(s, T0); assert.equal(u.base(), T0); });
t('bump (push hook) counts before data arrives; markSeen resets it', () => {
  const u = U.createUnread(mem(), T0);
  u.bump('wa_9'); u.bump('wa_9', 2);
  assert.equal(u.count(conv('wa_9', [])), 3);
  assert.equal(u.chats([]), 1, 'bumped chat not in list still counts');
  assert.equal(u.messages([]), 3);
  u.markSeen('wa_9', T0 + 1); assert.equal(u.count(conv('wa_9', [])), 0);
});
t('observe: first call is a silent baseline, later calls report only new inbound', () => {
  const u = U.createUnread(mem(), T0);
  const v1 = [conv('a', [m('1', 'in', T0 + 1)]), conv('b', [m('2', 'in', T0 - 1)])];
  assert.deepEqual(u.observe(v1).fresh, []);
  assert.deepEqual(u.observe(v1).fresh, [], 'no change => nothing');
  const v2 = [conv('a', [m('1', 'in', T0 + 1), m('3', 'out', T0 + 3)]), conv('b', [m('2', 'in', T0 - 1), m('4', 'in', T0 + 4)]), conv('c', [m('5', 'in', T0 + 5)])];
  const f = u.observe(v2).fresh;
  assert.deepEqual(f.map((x) => x.id), ['b', 'c']);
  assert.equal(f[0].text, 'نص 4');
  u.markSeen('d', T0 + 100);
  assert.deepEqual(u.observe(v2.concat([conv('d', [m('6', 'in', T0 + 50)])])).fresh, [], 'already seen chat => silent');
});
t('observe: partial history chat (only last loaded) accumulates arrivals', () => {
  const u = U.createUnread(mem(), T0);
  u.observe([conv('p', [m('1', 'in', T0 + 1)], { count: 5 })]);
  u.observe([conv('p', [m('2', 'in', T0 + 2)], { count: 6 })]);
  u.observe([conv('p', [m('3', 'in', T0 + 3)], { count: 7 })]);
  assert.equal(u.count(conv('p', [m('3', 'in', T0 + 3)], { count: 7 })), 2);
});
t('titleBadge adds, replaces and removes the count', () => {
  assert.equal(U.titleBadge('NOVA Rx', 3), '(3) NOVA Rx');
  assert.equal(U.titleBadge('(3) NOVA Rx', 5), '(5) NOVA Rx');
  assert.equal(U.titleBadge('(5) NOVA Rx', 0), 'NOVA Rx');
  assert.equal(U.titleBadge('NOVA Rx', 0), 'NOVA Rx');
  assert.equal(U.titleBadge('NOVA Rx', 150), '(99+) NOVA Rx');
  assert.equal(U.titleBadge('(99+) NOVA Rx', 0), 'NOVA Rx');
});
t('notifyHtml: UX409 single bell, default/granted/denied/unsupported/muted', () => {
  const d = U.notifyHtml('default', false);
  assert.match(d, /data-wa-notify="default"/); assert.match(d, /aria-label="تفعيل إشعارات/); assert.match(d, /aria-pressed="false"/);
  assert.equal((d.match(/<button/g) || []).length, 1, 'one button only');
  const g = U.notifyHtml('granted', false);
  assert.match(g, /data-wa-notify="granted"[^>]*aria-pressed="true"/); assert.ok(!/الإشعارات شغّالة/.test(g));
  assert.match(U.notifyHtml('granted', true), /aria-pressed="false"/);
  assert.match(U.notifyHtml('denied', true), /الإشعارات مقفولة/);
  assert.match(U.notifyHtml('weird', false), /data-wa-notify="unsupported"[^>]*aria-disabled="true"/);
  assert.match(U.noteHtml('<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/, 'note escaped');
});
t('chat list uses the unread hook for per-chat badges; renderWa shows the controls', () => {
  const cs = [conv('a', [m('1', 'in', T0 + 1)]), conv('b', [m('2', 'in', T0 + 2)])];
  const html = U.chatListHtml(cs, null, '', T0 + 10, false, { unread: (c) => (c.id === 'a' ? 4 : 0) });
  assert.equal((html.match(/data-unread="4"/g) || []).length, 1);
  // UX408: the hook decides the badge; an opened chat still waiting for a reply (hook 0) keeps state noreply + the green dot
  assert.equal((html.match(/data-unread=/g) || []).length, 1);
  assert.equal((html.match(/data-wa-wait/g) || []).length, 1);
  assert.match(html, /data-conv="a" data-state="unread"/); assert.match(html, /data-conv="b" data-state="noreply"/);
  assert.equal((U.chatListHtml(cs, null, '', T0 + 10).match(/data-unread="1"/g) || []).length, 2, 'history chats waiting for a reply show a badge without the hook too');
  const rep = [conv('c', [m('1', 'in', T0 + 1), m('2', 'out', T0 + 2)])];
  assert.ok(!/data-unread=/.test(U.chatListHtml(rep, null, '', T0 + 10, false, { unread: () => 0 })), 'replied chat: no badge');
  const w = U.renderWa(cs, { notifHead: U.notifyHtml('default', false) });
  assert.ok(w.indexOf('data-wa-notify="') > w.indexOf('class="wa-title"') && w.indexOf('data-wa-notify="') < w.indexOf('</div>', w.indexOf('class="wa-side-head"')), 'bell sits in the header after the title');
  assert.ok(!w.includes('wa-notifbar'));
  assert.ok(w.includes('.wa-nbtn{'));
  assert.ok(!U.renderWa(cs, {}).includes('.wa-nbtn{'));
  const hinted = U.renderWa(cs, { notifHead: U.notifyHtml('granted', false), notifNote: 'إشعارات الخلفية لسه مش متفعلة على السيرفر. الصوت والعداد شغالين والصفحة مفتوحة.' });
  assert.ok(!hinted.includes('إشعارات الخلفية لسه مش متفعلة على السيرفر'), 'hint is not baked into the list as a row');
  assert.ok(!hinted.includes('wa-nnote-row'));
  assert.match(U.noteHtml('إشعارات الخلفية لسه مش متفعلة على السيرفر'), /wa-nnote-toast/);
});
t('index.html: permission only from the button, SW message hooks, title/tab wiring', () => {
  const h = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.equal((h.match(/Notification\.requestPermission\(/g) || []).length, 1);
  const ask = /function nAsk\(\)\{[\s\S]*?\nbox\.addEventListener/.exec(h)[0];
  assert.ok(ask.includes('requestPermission'));
  assert.ok(!/nAsk\(\)(?!\{)/.test(h.replace(/return\}nAsk\(\);return\}/, '')), 'nAsk is called only from the button click');
  for (const s of ["d.type==='nova-wa-push'", "d.type==='nova-wa-open'", 'U.titleBadge(document.title', 'data-wa-tab-unread', 'nt.markSeen(wa.sel', 'window.NovaWaNotify', "'nova.wa.mute'", 'function nShowToast(', 'wa-nnote-toast']) assert.ok(h.includes(s), s);
  assert.ok(!h.includes('notifNote:nNote'), 'draw no longer mounts a persistent hint row');
  assert.ok(!h.includes('wa-nnote-row'));
});
console.log('ux406-wa-notify.check:', n, 'passed');
