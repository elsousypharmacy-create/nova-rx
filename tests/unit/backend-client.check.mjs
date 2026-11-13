import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createBackendClient } = require('../../backend-client.js');
const { createOutbox } = require('../../offline-outbox.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const inv = (id) => ({ id, number: id, total: 5, lines: [{ code: 'A', qty: 1, price: 5 }] });
const mkFetch = (handler) => { const f = async (url, o) => { f.calls.push({ url, o }); return handler(url, o); }; f.calls = []; return f; };
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// default OFF: zero fetches
{
  const st = mem(), f = mkFetch(() => res({}));
  const ob = createOutbox(st, 'ob'); ob.enqueue(inv('i1'));
  const c = createBackendClient({ storage: st, fetch: f, outbox: ob });
  assert.equal(c.enabled(), false, 'default OFF');
  assert.equal((await c.syncAll()).skipped, true);
  assert.equal((await c.push()).skipped, true);
  assert.equal((await c.pull()).skipped, true);
  c.setUrl('https://b.test');
  assert.equal((await c.syncAll()).skipped, true, 'url alone does not enable');
  assert.equal(f.calls.length, 0);
  assert.equal(ob.pending().length, 1);
  c.setEnabled(true); c.setUrl('');
  assert.equal((await c.syncAll()).skipped, true, 'no url -> off');
  assert.equal(f.calls.length, 0);
}
// ON: push + pull
{
  const st = mem();
  const f = mkFetch((u) => u.includes('/push') ? res({ ok: true, results: [{ key: 'i1', status: 'applied' }] }) : res({ items: [{ id: 1 }], cursor: 7 }));
  const ob = createOutbox(st, 'ob'); ob.enqueue(inv('i1'));
  const c = createBackendClient({ storage: st, fetch: f, outbox: ob, getToken: () => 'tok' });
  c.setEnabled(true); c.setUrl('https://b.test/');
  const r = await c.syncAll();
  assert.equal(r.push.synced, 1); assert.equal(r.pull.items, 1);
  assert.equal(ob.pending().length, 0);
  assert.equal(f.calls[0].url, 'https://b.test/api/v1/sync/push');
  assert.equal(f.calls[0].o.headers.Authorization, 'Bearer tok');
  assert.match(f.calls[1].url, /feed\?since=$/);
  await c.pull(); assert.match(f.calls[2].url, /since=7$/);
  assert.equal(c.feed().length, 2);
}
// ON: errors stay local and queued
for (const h of [() => { throw new Error('net'); }, () => res({}, 500), () => res({ ok: true, results: [{ status: 'rejected', code: 'X' }] })]) {
  const st = mem(), f = mkFetch(h);
  const ob = createOutbox(st, 'ob'); ob.enqueue(inv('i1'));
  const c = createBackendClient({ storage: st, fetch: f, outbox: ob });
  c.setEnabled(true); c.setUrl('https://b.test');
  const r = await c.syncAll();
  assert.equal(r.push.synced, 0);
  assert.equal(ob.pending().length, 1, 'still queued');
  assert.equal(r.pull.items, 0); assert.ok(r.pull.error);
  assert.equal(c.feed().length, 0);
}
console.log('backend-client.check OK');
