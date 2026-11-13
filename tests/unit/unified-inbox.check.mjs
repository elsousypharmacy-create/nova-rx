import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const I = createRequire(import.meta.url)('../../unified-inbox.js');
const mem = () => { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('conversation, assignee, handoff and links', () => {
  const b = I.create(mem());
  b.open('c1', 'منى', 1); b.receive('c1', 'عايزة دوا', 2);
  b.assign('c1', 'سارة'); b.handoff('c1'); b.link('c1', { customerId: 'C9', orderId: 'O7' });
  const c = b.get('c1');
  assert.deepEqual([c.assignee, c.mode, c.customerId, c.orderId, c.messages.length], ['سارة', 'human', 'C9', 'O7', 1]);
  assert.equal(b.list({ mode: 'bot' }).length, 0);
  assert.equal(b.list({ assignee: 'سارة' }).length, 1);
});
t('send is local only; status comes from the mock source', () => {
  const b = I.create(mem()); b.open('c1', 'x', 1);
  const m = b.send('c1', 'أهلاً', 2);
  assert.equal(m.status, 'sent');
  assert.equal(b.setStatus('c1', m.id, 'delivered').status, 'delivered');
  assert.equal(b.setStatus('c1', m.id, 'failed').status, 'failed');
  assert.throws(() => b.setStatus('c1', m.id, 'read'));
  assert.throws(() => b.send('c1', '  ', 3));
  b.receive('c1', 'رد', 4);
  assert.throws(() => b.setStatus('c1', 'm2', 'sent')); // inbound message has no delivery status
});
t('state survives refresh (reload from storage)', () => {
  const s = mem(), a = I.create(s);
  a.open('c1', 'منى', 1); const m = a.send('c1', 'hi', 2); a.setStatus('c1', m.id, 'failed'); a.handoff('c1', 'علي');
  const b = I.create(s).load();
  assert.equal(b.get('c1').messages[0].status, 'failed');
  assert.equal(b.get('c1').assignee, 'علي');
  const m2 = b.send('c1', 'again', 3); assert.notEqual(m2.id, m.id);
  s.setItem(I.KEY, '{bad'); assert.equal(I.create(s).load().list().length, 0);
});
t('render is RTL, shows status and escapes content', () => {
  const b = I.create(mem()); b.open('c1', '<i>م</i>', 1); const m = b.send('c1', '<b>x</b>', 2); b.setStatus('c1', m.id, 'failed');
  const html = I.render(b.list());
  assert.match(html, /dir="rtl"/); assert.match(html, /فشلت/); assert.match(html, /data-status="failed"/);
  assert.ok(!html.includes('<b>x</b>')); assert.match(html, /&lt;b&gt;/);
});
console.log(n + ' passed');

// N115: remote read only when the flag is on; errors keep local state
{
  const calls = [];
  const mk = (on, fetchImpl) => I.create(mem(), { enabled: () => on, baseUrl: () => 'https://api.test/', getToken: () => 'tok', fetch: (u, o) => { calls.push([u, o]); return fetchImpl(); } });
  const off = mk(false, () => { throw new Error('must not fetch'); });
  off.open('c1', 'x', 1);
  assert.deepEqual(await off.pullRemote(), { skipped: true }); assert.equal(calls.length, 0);
  assert.deepEqual(await I.create(mem()).pullRemote(), { skipped: true });
  const ok = mk(true, async () => ({ ok: true, json: async () => ({ conversations: [{ id: 's1', customer: 'س', messages: [], mode: 'human', updatedAt: 5 }] }) }));
  assert.deepEqual(await ok.pullRemote(), { skipped: false, count: 1 });
  assert.equal(calls[0][0], 'https://api.test/api/v1/inbox/conversations'); assert.equal(calls[0][1].headers.Authorization, 'Bearer tok');
  assert.equal(ok.list()[0].id, 's1');
  const fail = mk(true, async () => { throw new Error('net'); });
  fail.open('c9', 'y', 1);
  assert.ok((await fail.pullRemote()).error); assert.equal(fail.list()[0].id, 'c9');
  console.log('ok remote pull flag-gated, falls back local');
}
