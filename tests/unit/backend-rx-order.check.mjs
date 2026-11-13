import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as R from '../../backend/src/rx-order.js';
import { handle } from '../../backend/src/index.js';

const sql = new DatabaseSync(':memory:');
for (const f of ['0002_catalog_inventory.sql', '0010_rx_orders.sql']) sql.exec(readFileSync(new URL('../../backend/migrations/' + f, import.meta.url), 'utf8'));
const db = { prepare: (q) => ({ bind: (...a) => ({
  run: async () => sql.prepare(q).run(...a),
  first: async () => sql.prepare(q).get(...a),
  all: async () => ({ results: sql.prepare(q).all(...a) }),
}) }) };
sql.exec("INSERT INTO products (id,tenant_id,branch_id,sku,name_ar,name_en) VALUES ('p1','t','b','S1','باراسيتامول 500','Paracetamol 500'),('p2','t','b','S2','أدول','Adol'),('p3','t','b','S3','أموكسيسيلين','Amoxicillin')");
sql.exec("INSERT INTO rx_approved_alternatives (tenant_id,product_id,alternative_product_id,approved_by) VALUES ('t','p1','p2','owner')");

// flag default OFF, zero network, route returns disabled
assert.equal(R.rxOrderEnabled(undefined), false);
assert.equal(R.rxOrderEnabled({ DB: db }), false);
assert.equal(R.rxOrderEnabled({ DB: db, NOVA_RX_ORDER: '0' }), false);
let net = 0; const realFetch = globalThis.fetch; globalThis.fetch = () => { net++; throw new Error('net'); };
const off = await handle(new Request('https://x.test/api/v1/rx-orders', { method: 'POST', body: '{}' }), { DB: db });
assert.equal(off.status, 404); const ob = await off.json();
assert.equal(ob.code, 'RX_DISABLED'); assert.ok(/[؀-ۿ]/.test(ob.message_ar)); assert.ok(ob.requestId);
assert.equal(net, 0);

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const env = { DB: db, NOVA_RX_BLOB_KEY: key, NOVA_RX_EXTRACTOR: R.mockExtractor([{ name: 'Paracetamol 500', qty: 2 }, { name: 'unknown drug' }]) };
const file = Buffer.from('fake-image-bytes-secret').toString('base64');
const base = { env, tenant: 't', user: 'u1', requestId: 'req_1' };
const err = async (p, code) => assert.rejects(p, (e) => e.code === code && /[؀-ۿ]/.test(e.message_ar) && e.requestId === 'req_1', code);

// upload: validation, cap, encryption at rest
await err(R.uploadRx({ ...base, body: { file_base64: file, mime: 'text/html' } }), 'RX_BAD_MIME');
await err(R.uploadRx({ ...base, env: { ...env, NOVA_RX_MAX_BYTES: '10' }, body: { file_base64: file, mime: 'image/png' } }), 'RX_TOO_LARGE');
await err(R.uploadRx({ ...base, env: { DB: db }, body: { file_base64: file, mime: 'image/png' } }), 'RX_NO_KEY');
const up = await R.uploadRx({ ...base, body: { file_base64: file, mime: 'image/png', customer_ref: 'c1' } });
const row = sql.prepare('SELECT * FROM rx_orders WHERE id = ?').get(up.id);
assert.ok(!row.blob_enc.includes(file) && row.size_bytes === 23);
assert.equal(Buffer.from(await R.decryptBlob(env, row.blob_iv, row.blob_enc)).toString(), 'fake-image-bytes-secret');
await err(R.decryptBlob({ NOVA_RX_BLOB_KEY: Buffer.from(new Uint8Array(32)).toString('base64') }, row.blob_iv, row.blob_enc, 'req_1').catch(() => { throw new R.RxError('RX_NO_KEY', 'req_1'); }), 'RX_NO_KEY');

// cannot skip steps
await err(R.reviewRx({ ...base, id: up.id, role: 'pharmacist', items: [] }), 'RX_BAD_STATE');
await err(R.reserveRx({ ...base, id: up.id }), 'RX_BAD_STATE');
await err(R.extractRx({ ...base, env: { ...env, NOVA_RX_EXTRACTOR: undefined }, id: up.id }), 'RX_EXTRACT_UNAVAILABLE');

// extraction + matching (suggestions only)
const ex = await R.extractRx({ ...base, id: up.id });
assert.equal(ex.extraction.needs_pharmacist_review, true);
assert.equal(ex.extraction.matches[0].candidates[0].product_id, 'p1');
assert.deepEqual(ex.extraction.matches[1].candidates, []);

// mandatory pharmacist review
await err(R.reviewRx({ ...base, id: up.id, role: 'cashier', items: [{ product_id: 'p1', qty: 2 }] }), 'RX_NOT_PHARMACIST');
await err(R.reviewRx({ ...base, id: up.id, role: 'owner', items: [{ product_id: 'p1', qty: 2 }] }), 'RX_NOT_PHARMACIST');
await err(R.reserveRx({ ...base, id: up.id }), 'RX_BAD_STATE');
await err(R.reviewRx({ ...base, id: up.id, role: 'pharmacist', items: [{ product_id: 'p1', qty: 2, alternative_product_id: 'p3' }] }), 'RX_ALT_NOT_APPROVED');
await err(R.reviewRx({ ...base, id: up.id, role: 'pharmacist', items: [{ product_id: 'nope', qty: 2 }] }), 'RX_BAD_ITEM');
const rv = await R.reviewRx({ ...base, id: up.id, role: 'pharmacist', items: [{ extracted_name: 'Paracetamol 500', product_id: 'p1', qty: 2, alternative_product_id: 'p2' }] });
assert.equal(rv.status, 'reviewed');
const it = sql.prepare('SELECT * FROM rx_order_items').all();
assert.equal(it.length, 1); assert.equal(it[0].product_id, 'p2'); assert.equal(it[0].is_alternative, 1); assert.equal(it[0].original_product_id, 'p1');

// customer approval before reservation
await err(R.reserveRx({ ...base, id: up.id }), 'RX_CUSTOMER_APPROVAL_REQUIRED');
await err(R.reserveRx({ ...base, tenant: 'other', id: up.id }), 'RX_NOT_FOUND');
await R.customerDecision({ ...base, id: up.id, approve: true });
const rs = await R.reserveRx({ ...base, id: up.id });
assert.equal(rs.status, 'reserved'); assert.deepEqual(rs.lines.map((l) => ({ ...l })), [{ product_id: 'p2', qty: 2 }]);
await err(R.reserveRx({ ...base, id: up.id }), 'RX_BAD_STATE');

// rejection blocks reservation
const up2 = await R.uploadRx({ ...base, body: { file_base64: file, mime: 'application/pdf' } });
await R.extractRx({ ...base, id: up2.id });
await R.reviewRx({ ...base, id: up2.id, role: 'pharmacist', items: [{ product_id: 'p3', qty: 1 }] });
assert.equal((await R.customerDecision({ ...base, id: up2.id, approve: false })).status, 'customer_rejected');
await err(R.reserveRx({ ...base, id: up2.id }), 'RX_BAD_STATE');

globalThis.fetch = realFetch;
console.log('backend-rx-order: ok');
