// UX414: sw.js push + notificationclick (run in a vm with a fake ServiceWorker scope; no network, no real push).
// Run: node tests/unit/ux414-sw-push.check.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const mk = (clients) => {
  const h = {}, shown = [], opened = [], self = { location: { origin: 'https://x.test' }, addEventListener: (t, f) => { h[t] = f; }, skipWaiting() {}, clients: { matchAll: async () => clients, claim() {}, openWindow: async (u) => { opened.push(u); return {}; } }, registration: { showNotification: async (t, o) => { shown.push({ t, o }); } } };
  vm.runInNewContext(src, { self, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [] }, URL, fetch: async () => ({}) });
  const run = async (type, ev) => { let p; ev.waitUntil = (x) => { p = x; }; h[type](ev); await p; };
  return { run, shown, opened };
};
const push = (d) => ({ data: { json: () => d } });
{
  const t = mk([]);
  await t.run('push', push({ title: 'منى', body: 'عايز بنادول', chat: 'wa_1', tag: 'nova-wa-wa_1' }));
  assert.equal(t.shown.length, 1); assert.equal(t.shown[0].t, 'منى'); assert.equal(t.shown[0].o.data.url, '/whatsapp?app=whatsapp#wa'); assert.equal(t.shown[0].o.data.chat, 'wa_1');
  console.log('ok push shows a notification with the /whatsapp target');
}
{
  const msgs = [], c = { url: 'https://x.test/', visibilityState: 'visible', focused: true, postMessage: (m) => msgs.push(m) };
  const t = mk([c]); await t.run('push', push({ title: 'a', chat: 'wa_2' }));
  assert.equal(t.shown.length, 1, 'focused tab still gets a system notification (iOS drops subscriptions after silent pushes)'); assert.equal(msgs[0].type, 'nova-wa-push');
  console.log('ok focused tab gets the message AND a notification (no silent push)');
}
{
  const t = mk([]); let closed = 0;
  await t.run('notificationclick', { notification: { close: () => closed++, data: { chat: 'wa_3' } } });
  assert.deepEqual([closed, t.opened], [1, ['/whatsapp?app=whatsapp#wa']]);
  const msgs = [], c = { url: 'https://x.test/whatsapp?app=whatsapp', focus: async () => {}, postMessage: (m) => msgs.push(m) };
  const t2 = mk([c]); await t2.run('notificationclick', { notification: { close() {}, data: { chat: 'wa_3' } } });
  assert.deepEqual([t2.opened.length, msgs[0].type, msgs[0].chat], [0, 'nova-wa-open', 'wa_3']);
  console.log('ok notificationclick opens /whatsapp?app=whatsapp#wa or focuses the open app and opens that chat');
}
console.log('ALL PASS');
