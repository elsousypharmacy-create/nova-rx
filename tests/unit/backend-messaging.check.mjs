import assert from 'node:assert/strict';
import * as M from '../../backend/src/messaging.js';

// flag default OFF
assert.equal(M.msgPolicyEnabled(undefined), false);
assert.equal(M.msgPolicyEnabled({}), false);
assert.equal(M.msgPolicyEnabled({ NOVA_MSG_POLICY: '0' }), false);
assert.throws(() => M.createBackendPolicy({}, 'req_1'), (e) => e.code === 'MSG_DISABLED' && /[؀-ۿ]/.test(e.message_ar) && e.requestId === 'req_1');

const env = { NOVA_MSG_POLICY: '1' };
let saved = null;
const store = { get: () => saved, set: (v) => { saved = v; } };
const now = () => new Date('2026-11-13T10:00:00Z');
const perms = new Set(['messaging.settings']);
const b = M.createBackendPolicy(env, 'req_2', { store, can: (a) => perms.has(a), now, actor: 'owner' });
const p = b.policy;
p.setTemplate('t1', { channel: 'whatsapp', body: 'مرحبا {name}', kind: 'service' });
p.setTemplate('m1', { channel: 'whatsapp', body: 'عرض', kind: 'marketing' });
p.setWindow('EG', '*', { from: '09:00', to: '21:00', utcOffsetMin: 120 });
p.setLimits({ perMessage: 1, daily: 2 });
assert.ok(saved, 'state persisted via store');
const base = { customerId: 'c1', channel: 'whatsapp', country: 'EG', templateId: 't1', cost: 0.5 };

assert.equal(b.decide(base).reason, 'no-opt-in');
p.setOptIn('c1', 'whatsapp', true, 'in-store form');
const ok = b.decide(base);
assert.equal(ok.allowed, true); assert.equal(ok.requestId, 'req_2');
assert.equal(b.decide({ ...base, mode: 'auto' }).reason, 'auto-send-not-permitted');
assert.equal(b.decide({ ...base, mode: 'campaign', templateId: 'm1' }).reason, 'campaigns-not-permitted');
assert.equal(b.decide({ ...base, templateId: 'm1' }).reason, 'marketing-needs-campaign');
assert.equal(b.decide({ ...base, cost: 5 }).reason, 'per-message-limit');
assert.equal(b.decide({ ...base, country: 'SA' }).reason, 'outside-window');
p.recordSpend(1.8);
assert.equal(b.decide(base).reason, 'daily-limit');
assert.throws(() => b.decide({}), (e) => e.code === 'MSG_BAD_REQUEST');

// grants need explicit permission
assert.throws(() => p.grant('autoSend', true), (e) => e.code === 'not-permitted');

// 24h service window
assert.equal(M.serviceWindowOpen('2026-11-12T11:00:00Z', now()), true);
assert.equal(M.serviceWindowOpen('2026-11-12T09:00:00Z', now()), false);
assert.equal(M.serviceWindowOpen(null, now()), false);
assert.equal(M.serviceWindowOpen('2026-11-13T09:00:00Z', now(), 0.5), false);
const fresh = { ...base, templateId: 't1' };
p.setLimits({ daily: 0 });
assert.equal(b.decide({ ...fresh, freeForm: true }).reason, 'service-window-closed');
assert.equal(b.decide({ ...fresh, freeForm: true, lastInboundAt: '2026-11-13T08:00:00Z' }).allowed, true);

// state reloads from store
const b2 = M.createBackendPolicy(env, 'r3', { store, can: () => false, now });
assert.equal(b2.policy.hasOptIn('c1', 'whatsapp'), true);
console.log('backend-messaging OK');
