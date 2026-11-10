import assert from 'node:assert/strict';
import { createSupplierApi } from '../../worker/procurement/provider/http.js';
import { createSupplierHub } from '../../worker/procurement/provider/hub.js';
// The client entry point must never widen an Aumet search: a missing or malformed warehouse
// selection becomes [] (no Aumet warehouse), not "all warehouses".
const PIN = 'unit-test-pin';
const post = (api, body) => api(new Request('https://nova.test/api/suppliers/search', {
  method: 'POST', headers: { 'X-Nova-Pin': PIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
let seen;
const spyHub = { search: async (q, opts) => { seen = opts; return { fetchedAt: 'x', results: [], suppliers: [] }; }, status: async () => [], sellers: async () => [] };
const api = createSupplierApi({ hub: spyHub, store: { load: async () => null }, env: { NOVA_API_PIN: PIN } });
for (const [label, value, expected] of [
  ['missing', undefined, []], ['string', 'abc', []], ['object', { a: 1 }, []], ['null', null, []],
  ['empty array', [], []], ['numbers become strings', [7, '8'], ['7', '8']],
]) {
  const body = { query: 'Panadol Extra 24 tabs', supplierIds: ['aumet'] };
  if (value !== undefined) body.aumetSellerIds = value;
  assert.equal((await post(api, body)).status, 200, label);
  assert.deepEqual(JSON.parse(JSON.stringify(seen.aumetSellerIds)), expected, label);
}
// End to end through the real hub: with NO selection sent, no Aumet offer comes back at all,
// even when the request also leaves supplierIds out (which searches every supplier).
const offer = id => ({ supplierId: 'aumet', supplierProductId: id, sellerId: id, productName: 'Panadol Extra 24 tabs', unitPrice: 40, netEffectivePrice: null, publicPrice: 60, stockStatus: 'in_stock', lastUpdated: new Date().toISOString() });
const realHub = createSupplierHub({ store: { load: async id => (id === 'aumet' ? { session: {} } : null) }, connectors: { aumet: { search: async () => ({ offers: [offer('a'), offer('b')], totalPages: 1 }), toOffer: r => r } } });
const real = createSupplierApi({ hub: realHub, store: { load: async () => null }, env: { NOVA_API_PIN: PIN } });
for (const body of [{ query: 'Panadol Extra 24 tabs' }, { query: 'Panadol Extra 24 tabs', supplierIds: ['aumet'] }, { query: 'Panadol Extra 24 tabs', supplierIds: ['aumet'], aumetSellerIds: 'a' }]) {
  const out = await (await post(real, body)).json();
  assert.equal(out.results[0].offers.length, 0, 'no selection must not return any Aumet offer: ' + JSON.stringify(body));
}
const scoped = await (await post(real, { query: 'Panadol Extra 24 tabs', supplierIds: ['aumet'], aumetSellerIds: ['a'] })).json();
assert.equal(scoped.results[0].offers.length, 1);
console.log('PASS search route fails closed: missing/malformed Aumet warehouse selection returns no Aumet offers');
