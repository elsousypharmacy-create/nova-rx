import assert from 'node:assert/strict';
import * as W from '../../backend/src/wa-sender.js';
import { createBackendPolicy } from '../../backend/src/messaging.js';

const SECRET = 'SECRET_TOKEN_XYZ';
const at = new Date('2026-11-13T10:00:00Z');
let calls = [];
const okFetch = async (u, o) => { calls.push([u, o]); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; };
const env = { NOVA_WA_SEND: '1', NOVA_MSG_POLICY: '1', WA_TOKEN: SECRET, WA_PHONE_ID: '555' };
const mkGate = (optIn = true) => {
  const g = createBackendPolicy(env, 'r', { can: () => true, now: () => at });
  g.policy.setWindow('JO', '*', { from: '00:00', to: '23:59', utcOffsetMin: 0 });
  g.policy.setTemplate('t', { channel: 'whatsapp', body: 'x' });
  if (optIn) g.policy.setOptIn('c1', 'whatsapp', true, 'form');
  return g;
};
const base = { customerId: 'c1', to: '962790000000', country: 'JO', templateId: 't', text: 'مرحباً', cost: 0, lastInboundAt: '2026-11-13T09:00:00Z' };
const rej = async (p, pred) => { try { await p; } catch (e) { assert.ok(pred(e), String(e.code)); assert.ok(!JSON.stringify(e).includes(SECRET) && !String(e.stack).includes(SECRET)); return; } assert.fail('no throw'); };

// flag off
assert.equal(W.waSendEnabled({}), false);
assert.throws(() => W.createWaSender({ ...env, NOVA_WA_SEND: '0' }, 'r', { fetch: okFetch, gate: mkGate() }), (e) => e.code === 'WA_SEND_DISABLED' && /[؀-ۿ]/.test(e.message_ar));
assert.equal(calls.length, 0);

// closed window
await rej(W.createWaSender(env, 'r', { fetch: okFetch, gate: mkGate() }).send({ ...base, lastInboundAt: '2026-11-10T09:00:00Z' }),
  (e) => e.code === 'WA_BLOCKED' && e.reason === 'service-window-closed' && /[؀-ۿ]/.test(e.message_ar) && /[؀-ۿ]/.test(e.reason_ar));
// missing opt-in
await rej(W.createWaSender(env, 'r', { fetch: okFetch, gate: mkGate(false) }).send(base),
  (e) => e.code === 'WA_BLOCKED' && e.reason === 'no-opt-in' && /[؀-ۿ]/.test(e.reason_ar));
assert.equal(calls.length, 0);

// missing secrets
await rej(W.createWaSender({ ...env, WA_TOKEN: '' }, 'r', { fetch: okFetch, gate: mkGate() }).send(base), (e) => e.code === 'WA_NOT_CONFIGURED');
assert.equal(calls.length, 0);

// allowed
const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
const r = await W.createWaSender(env, 'r', { fetch: okFetch, gate: mkGate() }).send(base);
console.log = origLog;
assert.equal(r.status, 'sent'); assert.equal(r.providerId, 'wamid.1');
assert.equal(calls.length, 1);
assert.match(calls[0][0], /\/555\/messages$/);
assert.deepEqual(JSON.parse(calls[0][1].body), { messaging_product: 'whatsapp', to: '962790000000', type: 'text', text: { body: 'مرحباً' } });
assert.ok(!JSON.stringify(r).includes(SECRET) && !logs.join().includes(SECRET) && !calls[0][1].body.includes(SECRET));

// failures -> status failed
for (const bad of [async () => ({ ok: false, status: 401, json: async () => ({ error: SECRET }) }), async () => { throw new Error('net ' + SECRET); }]) {
  calls = [];
  const f = await W.createWaSender(env, 'r', { fetch: bad, gate: mkGate() }).send(base);
  assert.equal(f.status, 'failed'); assert.equal(f.code, 'WA_PROVIDER_FAILED'); assert.ok(!JSON.stringify(f).includes(SECRET));
}
console.log('backend-wa-sender: all passed');
