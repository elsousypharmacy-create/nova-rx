// The module Worker artifact must serve the price list same-origin (GET/HEAD), prices only, no secrets.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
const art = process.argv[2] || 'worker/live/nova-rx-preview.ui-real-prices5.js';
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-')), 'w.mjs'); fs.copyFileSync(art, tmp);
const m = await import(tmp); const env = { NOVA_SECRETS_KV: {}, NOVA_PURCHASE_OPS: {} }, ctx = { waitUntil() {}, passThroughOnException() {} };
const get = (u, method = 'GET') => m.default.fetch(new Request('https://x' + u, { method }), env, ctx);
let r = await get('/emergency/stock.json'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/json/);
const j = await r.json(); assert.ok(j.items.length >= 4000); for (const it of j.items.slice(0, 200)) { assert.ok(it.code && it.price > 0); assert.ok(!('stock' in it)); }
const src = JSON.stringify(j); assert.ok(!/secret|token|pin/i.test(Object.keys(j).join(',')));
r = await get('/emergency/stock.json', 'HEAD'); assert.equal(r.status, 200);
r = await get('/'); assert.equal(r.status, 200); assert.ok((await r.text()).includes('loadRealPrices'));
r = await get('/emergency/stock.json?x=1'); assert.equal(r.status, 200);
console.log('PASS stock route: GET/HEAD served, prices only, app still served');
