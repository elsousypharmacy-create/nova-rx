// N116 MSG-03: backend messaging policy gate. Flag NOVA_MSG_POLICY=1 (default OFF). Reuses /msg-policy.js.
// DECIDES only: never sends, never calls a channel API. Auto-send/campaigns need explicit grants (msg-policy.js).
import policyModule from '../../msg-policy.js';

export const msgPolicyEnabled = (env) => !!env && String(env.NOVA_MSG_POLICY) === '1';

export const MSG_ERRORS = Object.freeze({
  MSG_DISABLED: 'سياسة المراسلة غير مفعّلة.',
  MSG_DENIED: 'الرسالة غير مسموحة وفق سياسة المراسلة.',
  MSG_BAD_REQUEST: 'بيانات الرسالة غير صالحة.',
});

export class MsgPolicyError extends Error {
  constructor(code, requestId, reason) { super(code); this.code = code; this.message_ar = MSG_ERRORS[code]; this.reason = reason || null; this.requestId = requestId || null; }
}

const HOUR = 3600 * 1000;
// Customer-service window: free-form (non-template) reply is allowed only within `hours` of the last inbound message.
// Key COUNTRY/channel or COUNTRY/*; default 24h; unset country/channel uses the default. No inbound = closed.
export function serviceWindowOpen(lastInboundAt, now, hours = 24) {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(t)) return false;
  const age = new Date(now).getTime() - t;
  return age >= 0 && age <= hours * HOUR;
}

// store: {get():string|null, set(string)} (e.g. backed by D1 by the caller); `can` is permission check.
export function createBackendPolicy(env, requestId, { store, can, now, actor } = {}) {
  if (!msgPolicyEnabled(env)) throw new MsgPolicyError('MSG_DISABLED', requestId);
  const storage = store ? { getItem: () => store.get(), setItem: (_k, v) => store.set(v) } : undefined;
  const policy = policyModule.createPolicy({ storage, can, now, actor, key: 'msg' });
  return {
    policy,
    // msg as in msg-policy check(); extra: {freeForm, lastInboundAt, windowHours}. Never sends.
    decide(msg = {}) {
      if (!msg.customerId || !msg.channel) throw new MsgPolicyError('MSG_BAD_REQUEST', requestId);
      const n = (now || (() => new Date()))();
      if (msg.freeForm && !serviceWindowOpen(msg.lastInboundAt, n, msg.windowHours || 24)) {
        return { allowed: false, reason: 'service-window-closed', requestId };
      }
      const r = policy.check(msg);
      return { ...r, requestId };
    },
  };
}
