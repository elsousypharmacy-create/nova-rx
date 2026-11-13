import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as H from '../../backend/src/http/idempotency.js';

// flag defaults OFF
assert.equal(H.contractEnabled(undefined), false);
assert.equal(H.contractEnabled({}), false);
assert.equal(H.contractEnabled({ NOVA_API_CONTRACT: '0' }), false);
assert.equal(H.contractEnabled({ NOVA_API_CONTRACT: '1' }), true);

const mk = (body, key, method = 'POST') => new Request('https://x.test/api/v1/sales', {
  method, body: method === 'GET' ? undefined : body, headers: key ? { 'Idempotency-Key': key } : {},
});
const store = H.memoryStore();
let calls = 0;
const handler = async () => ({ status: 201, body: { ok: true, n: ++calls } });
const run = (req) => H.withIdempotency({ request: req, store, requestId: 'req_1', handler });

let r = await run(mk('{"a":1}', null));
assert.equal(r.status, 400); assert.equal(r.body.code, 'IDEMPOTENCY_KEY_REQUIRED'); assert.ok(/[؀-ۿ]/.test(r.body.message_ar)); assert.equal(r.body.requestId, 'req_1');
r = await run(mk('{"a":1}', 'bad'));
assert.equal(r.body.code, 'IDEMPOTENCY_KEY_INVALID');
r = await run(mk('{"a":1}', 'key-00000001'));
assert.equal(r.status, 201); assert.equal(r.replayed, false); assert.equal(calls, 1);
r = await run(mk('{"a":1}', 'key-00000001'));
assert.equal(r.replayed, true); assert.equal(r.body.n, 1); assert.equal(calls, 1);
r = await run(mk('{"a":2}', 'key-00000001'));
assert.equal(r.status, 422); assert.equal(r.body.code, 'IDEMPOTENCY_KEY_REUSED'); assert.equal(calls, 1);
r = await run(mk(null, null, 'GET'));
assert.equal(r.status, 201); assert.equal(calls, 2); // reads need no key
// 5xx not stored
let c5 = 0;
const h5 = async () => (++c5 === 1 ? { status: 500, body: { ok: false } } : { status: 201, body: { ok: true } });
const s5 = H.memoryStore();
const run5 = () => H.withIdempotency({ request: mk('{}', 'key-5xx-0001'), store: s5, requestId: 'r', handler: h5 });
assert.equal((await run5()).status, 500); assert.equal((await run5()).status, 201);

// pagination
const u = (q) => new URL('https://x.test/a' + q);
assert.equal(H.parsePagination(u('')).limit, 50);
assert.equal(H.parsePagination(u('?limit=9999')).limit, 200);
assert.equal(H.parsePagination(u('?limit=0')).error.code, 'PAGINATION_INVALID');
assert.equal(H.parsePagination(u('?limit=abc')).error.status, 400);
assert.equal(H.parsePagination(u('?cursor=@@')).error.code, 'CURSOR_INVALID');
const cur = H.encodeCursor({ id: 'ص1', t: 5 });
assert.deepEqual(H.parsePagination(u('?cursor=' + cur)).cursor, { id: 'ص1', t: 5 });
const rows = Array.from({ length: 4 }, (_, i) => ({ id: i }));
let p = H.paginate(rows, 3, (x) => ({ id: x.id }));
assert.equal(p.items.length, 3); assert.deepEqual(H.decodeCursor(p.nextCursor), { id: 2 });
p = H.paginate(rows.slice(0, 3), 3, (x) => x);
assert.equal(p.nextCursor, null);

// timeouts
assert.equal(await H.withTimeout(async () => 7, 100), 7);
let aborted = false;
await assert.rejects(H.withTimeout((sig) => new Promise(() => sig.addEventListener('abort', () => { aborted = true; })), 20), (e) => e instanceof H.TimeoutError);
assert.ok(aborted);
assert.equal(H.timeoutErrorBody('r').status, 504);

// openapi covers required areas
const y = readFileSync(new URL('../../docs/backend/openapi.yaml', import.meta.url), 'utf8');
for (const p of ['/health:', '/auth/login:', '/sync/push:', '/sales:', '/stock:', 'Idempotency-Key', 'maximum: 200']) assert.ok(y.includes(p), p);
console.log('backend-http OK');
