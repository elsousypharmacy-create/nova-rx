// WA-CUSTHIST: GET history/customer-history (mocked bot, no network, no D1 writes). Run: node tests/unit/backend-customer-history.check.mjs
import assert from 'node:assert/strict';
import { handle } from '../../backend/src/index.js';
import { cleanHistory } from '../../backend/src/inbox-customer-history.js';

const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const PIN = 'pin-123456789012', TOKEN = 'x'.repeat(64), URL_ = 'https://script.test/exec';
const calls = []; let bot = { ok: true, purchases: [], debt: null }, botThrow = false, botHttp = 200;
const NOVA_FETCH = async (u, o) => { const p = JSON.parse(o.body); calls.push(p); if (botThrow) throw new Error('timeout'); return { ok: botHttp === 200, status: botHttp, async json() { return bot; } }; };
const DB = { prepare: () => { throw new Error('history must not touch D1'); } };
const env = { DB, KV, NOVA_API_PIN: PIN, WA_BACKEND_URL: URL_, NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_FETCH, CORS_ALLOW_ORIGINS: 'https://p.test' };
let ipn = 0;
const get = async (id, pin = PIN, e = env) => {
  const h = { 'CF-Connecting-IP': '10.3.0.' + (++ipn), Origin: 'https://p.test' }; if (pin != null) h['X-Nova-Pin'] = pin;
  const r = await handle(new Request('https://x.test/api/v1/inbox/history/customer-history?id=' + encodeURIComponent(id), { method: 'GET', headers: h }), e);
  return [r.status, await r.json()];
};
// pure
assert.deepEqual(cleanHistory({ purchases: [{ date: '2026-11-10T00:00', invoice: '12', total: '10.5', discount: '1', points: '4', items: [{ name: 'a', qty: '2', price: '3' }, { name: 5, qty: 'x' }], secret: 1 }, { invoice: '13', points: null }], debt: { net: '3' }, points: { total: '41.6' }, partial: 1, x: 1 }),
  { purchases: [{ date: '2026-11-10', invoice: '12', total: 10.5, discount: 1, items: [{ name: 'a', qty: 2, price: 3 }, { name: '', qty: 0, price: 0 }], points: 4 }, { date: '', invoice: '13', total: 0, discount: 0, items: [] }], debt: { net: 3 }, points: { total: 42 }, partial: true });
assert.deepEqual(cleanHistory(null), { purchases: [], debt: null, points: null, partial: false });
// gate
let [s, j] = await get('wa_201001112222', 'wrong'); assert.equal(s, 401); assert.equal(calls.length, 0);
[s, j] = await get('wa_201001112222', null); assert.equal(s, 401);
// no phone in the id (username chat) / bad id: no bot call
[s, j] = await get('wa_user_name'); assert.deepEqual([s, j.ok, j.available, j.reason], [200, true, false, 'no-phone']); assert.equal(calls.length, 0);
[s, j] = await get('../x'); assert.equal(j.available, false); assert.equal(calls.length, 0);
// happy path + the exact bot request
bot = { ok: true, purchases: [{ date: '2026-11-10', invoice: '1234', total: 150.5, discount: 5, points: 7, items: [{ name: 'بنادول', qty: 2, price: 30 }] }], debt: { net: 40 }, points: { total: 42 }, partial: false };
[s, j] = await get('wa_201001112222');
assert.deepEqual([s, j.ok, j.available, j.cached], [200, true, true, false]);
assert.deepEqual(calls, [{ action: 'novaWhatsAppBridge', bridgeToken: TOKEN, operation: 'customerHistory', chatId: 'wa_201001112222' }]);
assert.equal(j.purchases[0].invoice, '1234'); assert.equal(j.purchases[0].items[0].name, 'بنادول'); assert.deepEqual(j.debt, { net: 40 }); assert.deepEqual(j.points, { total: 42 }); assert.deepEqual([j.purchases[0].discount, j.purchases[0].points, j.purchases[0].items[0].price], [5, 7, 30]);
// cached (second call does not hit the bot)
[s, j] = await get('wa_201001112222'); assert.deepEqual([j.cached, j.purchases.length], [true, 1]); assert.equal(calls.length, 1);
// bot failure / http error -> Arabic error, not cached
bot = { ok: false, error: 'boom' }; [s, j] = await get('wa_201009998888'); assert.deepEqual([s, j.ok, j.code], [502, false, 'HIST_FAILED']);
botThrow = true; [s, j] = await get('wa_201007776666'); assert.equal(s, 502); botThrow = false;
bot = { ok: true, purchases: [] }; [s, j] = await get('wa_201009998888'); assert.deepEqual([s, j.ok, j.purchases.length], [200, true, 0]); // failures were not cached
// not configured
[s, j] = await get('wa_201005554444', PIN, { ...env, NOVA_WA_BRIDGE_TOKEN: '' }); assert.deepEqual([s, j.code], [503, 'HIST_NOT_CONFIGURED']);
console.log('backend-customer-history: all passed');
