import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createPolicy } = createRequire(import.meta.url)('../../msg-policy.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const at = new Date('2026-11-13T10:00:00Z'); // 12:00 at +120
const mem = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const ALL = new Set(['messaging.settings', 'messaging.campaigns.grant', 'messaging.autoSend.grant', 'messaging.campaign.run', 'messaging.autoSend.run']);
const mk = (o = {}) => {
  const p = createPolicy({ can: a => ALL.has(a), now: () => at, ...o });
  p.setTemplate('rdy', { channel: 'sms', body: 'مرحباً {name}، طلبك جاهز' });
  p.setTemplate('promo', { channel: 'sms', body: 'عرض {name}', kind: 'marketing' });
  p.setWindow('JO', '*', { from: '09:00', to: '21:00', utcOffsetMin: 120 });
  p.setOptIn('c1', 'sms', true, 'form-17');
  return p;
};
const msg = (o = {}) => ({ customerId: 'c1', channel: 'sms', country: 'JO', templateId: 'rdy', cost: 1, ...o });

t('settings need permission (default deny)', () => {
  const p = createPolicy(); assert.throws(() => p.setOptIn('c', 'sms', true, 's'), { code: 'not-permitted' });
  assert.throws(() => p.grant('campaigns', true), { code: 'not-permitted' });
});
t('manual send allowed with opt-in, window, template; render Arabic', () => {
  const p = mk(); assert.deepEqual(p.check(msg()), { allowed: true, reason: 'ok' });
  assert.equal(p.render('rdy', { name: 'سارة' }), 'مرحباً سارة، طلبك جاهز');
});
t('no opt-in / withdrawn opt-in / opt-in needs source', () => {
  const p = mk(); assert.equal(p.check(msg({ customerId: 'c2' })).reason, 'no-opt-in');
  assert.throws(() => p.setOptIn('c2', 'sms', true), { code: 'opt-in-needs-source' });
  p.setOptIn('c1', 'sms', false); assert.equal(p.check(msg()).reason, 'no-opt-in');
});
t('windows: outside, overnight, unknown country fail closed', () => {
  const p = mk(); p.setWindow('JO', 'sms', { from: '13:00', to: '14:00', utcOffsetMin: 120 });
  assert.equal(p.check(msg()).reason, 'outside-window');
  p.setWindow('JO', 'sms', { from: '20:00', to: '13:00', utcOffsetMin: 120 }); assert.equal(p.check(msg()).allowed, true);
  assert.equal(p.check(msg({ country: 'XX' })).reason, 'outside-window');
});
t('campaign and auto-send blocked without explicit grant, even with permission', () => {
  const p = mk(); p.setOptIn('c1', 'sms', true, 'f');
  assert.equal(p.check(msg({ mode: 'campaign', templateId: 'promo' })).reason, 'campaigns-not-permitted');
  assert.equal(p.check(msg({ mode: 'auto' })).reason, 'auto-send-not-permitted');
  assert.equal(p.check(msg({ templateId: 'promo' })).reason, 'marketing-needs-campaign');
  p.grant('campaigns', true); p.grant('autoSend', true);
  assert.equal(p.check(msg({ mode: 'campaign', templateId: 'promo' })).allowed, true);
  assert.equal(p.check(msg({ mode: 'auto' })).allowed, true);
  p.grant('campaigns', false); assert.equal(p.check(msg({ mode: 'campaign', templateId: 'promo' })).allowed, false);
});
t('grant on but runtime permission missing still denies', () => {
  const p = mk({ can: a => a !== 'messaging.autoSend.run' && ALL.has(a) }); p.grant('autoSend', true);
  assert.equal(p.check(msg({ mode: 'auto' })).reason, 'auto-send-not-permitted');
});
t('spend limits: per-message, daily, monthly', () => {
  const p = mk(); p.setLimits({ perMessage: 2, daily: 3, monthly: 4 });
  assert.equal(p.check(msg({ cost: 3 })).reason, 'per-message-limit');
  p.recordSpend(2); assert.equal(p.check(msg({ cost: 2 })).reason, 'daily-limit');
  p.recordSpend(1); p.setLimits({ daily: 0 }); assert.equal(p.check(msg({ cost: 2 })).reason, 'monthly-limit');
  assert.equal(p.check(msg({ cost: 1 })).allowed, true);
});
t('settings persist in storage and defaults are safe', () => {
  const st = mem(); mk({ storage: st });
  const q = createPolicy({ storage: st, now: () => at }); assert.equal(q.hasOptIn('c1', 'sms'), true);
  const snap = createPolicy().snapshot(); assert.equal(snap.campaigns.enabled, false); assert.equal(snap.autoSend.enabled, false);
});
console.log(n + ' passed');
