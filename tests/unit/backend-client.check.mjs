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
  // SALE-01: ON with no override now targets production nova-rx-api (mocked fetch here, never the network)
  c.setEnabled(true); c.setUrl('');
  assert.equal(c.baseUrl(), 'https://nova-rx-api.elsousypharmacy.workers.dev', 'no url -> production default');
  await c.pull();
  assert.match(f.calls[0].url, /^https:\/\/nova-rx-api\.elsousypharmacy\.workers\.dev\/api\/v1\/sync\/pull/);
}
// ON: push + pull
{
  const st = mem();
  const f = mkFetch((u) => u.includes('/push') ? res({ ok: true, results: [{ key: 'i1', status: 'applied' }] }) : res({ changes: [{ seq: 7, entity: 'sale', id: 's1', deleted: false, data: {} }], nextCursor: '7', hasMore: false }));
  const ob = createOutbox(st, 'ob'); ob.enqueue(inv('i1'));
  const c = createBackendClient({ storage: st, fetch: f, outbox: ob, getToken: () => 'tok' });
  c.setEnabled(true); c.setUrl('https://b.test/');
  const r = await c.syncAll();
  assert.equal(r.push.synced, 1); assert.equal(r.pull.items, 1);
  assert.equal(ob.pending().length, 0);
  assert.equal(f.calls[0].url, 'https://b.test/api/v1/sync/push');
  assert.equal(f.calls[0].o.headers.Authorization, 'Bearer tok');
  assert.match(f.calls[1].url, /pull\?cursor=$/);
  await c.pull(); assert.match(f.calls[2].url, /cursor=7$/);
  assert.equal(c.feed().length, 2);
}
// ON: errors stay local and queued
for (const h of [() => { throw new Error('net'); }, () => res({}, 500)]) {
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
// a permanent refusal is NOT retried forever and NOT lost: it goes to the review list with the server's code\n{\n  const st = mem(), f = mkFetch(() => res({ ok: true, results: [{ status: 'rejected', code: 'SYNC_RETURN_REJECTED', message_ar: 'x' }] }));\n  const ob = createOutbox(st, 'ob'); ob.enqueue(inv('i2'));\n  const c = createBackendClient({ storage: st, fetch: f, outbox: ob });\n  c.setEnabled(true); c.setUrl('https://b.test');\n  const r = await c.push();\n  assert.equal(r.review, 1); assert.equal(ob.pending().length, 0); assert.equal(ob.needsReview().length, 1);\n  assert.equal(ob.needsReview()[0].conflicts[0].code, 'SYNC_RETURN_REJECTED');\n}\nconsole.log('backend-client.check OK');
