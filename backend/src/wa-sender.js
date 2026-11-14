// UX37-11: WhatsApp Cloud API sender adapter. Flag NOVA_WA_SEND default OFF => WA_SEND_DISABLED.
// Secrets are read by NAME only from env (WA_TOKEN, WA_PHONE_ID); never logged or returned.
// Every send needs an allowed decision from the msg-policy gate (opt-in, 24h window, limits) BEFORE any fetch.
// fetch is injected; this module never touches the network on its own.

export const waSendEnabled = (env) => !!env && String(env.NOVA_WA_SEND) === '1';

export const WA_ERRORS = Object.freeze({
  WA_SEND_DISABLED: 'إرسال واتساب غير مفعّل.',
  WA_NOT_CONFIGURED: 'إعدادات واتساب غير مكتملة.',
  WA_BAD_REQUEST: 'بيانات الرسالة غير صالحة.',
  WA_BLOCKED: 'الإرسال محظور وفق سياسة المراسلة.',
  WA_PROVIDER_FAILED: 'تعذّر إرسال الرسالة عبر واتساب.',
});

const REASONS_AR = Object.freeze({
  'no-opt-in': 'لا يوجد موافقة من العميل على استلام الرسائل.',
  'service-window-closed': 'نافذة الخدمة (24 ساعة) مغلقة؛ استخدم قالباً معتمداً.',
  'daily-limit': 'تم بلوغ الحد اليومي للرسائل.',
  'monthly-limit': 'تم بلوغ الحد الشهري للرسائل.',
  'per-message-limit': 'تكلفة الرسالة تتجاوز الحد المسموح.',
  'outside-window': 'خارج ساعات الإرسال المسموحة.',
});

export class WaSendError extends Error {
  constructor(code, requestId, reason, status) {
    super(code); this.code = code; this.message_ar = WA_ERRORS[code];
    this.reason = reason || null; this.reason_ar = reason ? (REASONS_AR[reason] || null) : null;
    this.status = status || null; this.requestId = requestId || null;
  }
}

const API = 'https://graph.facebook.com/v20.0';

export function buildPayload({ to, text, template }) {
  const base = { messaging_product: 'whatsapp', to: String(to) };
  if (template && template.name) {
    return { ...base, type: 'template', template: { name: template.name, language: { code: template.lang || 'ar' }, ...(template.components ? { components: template.components } : {}) } };
  }
  return { ...base, type: 'text', text: { body: String(text) } };
}

// deps: { fetch, gate } where gate.decide(msg) is createBackendPolicy(...).decide. Returns {status, ...}; never throws on provider failure.
export function createWaSender(env, requestId, { fetch: f, gate } = {}) {
  if (!waSendEnabled(env)) throw new WaSendError('WA_SEND_DISABLED', requestId);
  return {
    async send(msg = {}) {
      const token = env.WA_TOKEN, phoneId = env.WA_PHONE_ID;
      if (!token || !phoneId || typeof f !== 'function' || !gate || typeof gate.decide !== 'function') throw new WaSendError('WA_NOT_CONFIGURED', requestId);
      if (!msg.to || !msg.customerId || (!msg.text && !(msg.template && msg.template.name))) throw new WaSendError('WA_BAD_REQUEST', requestId);
      const d = gate.decide({ ...msg, channel: 'whatsapp', freeForm: !msg.template });
      if (!d || d.allowed !== true) throw new WaSendError('WA_BLOCKED', requestId, d && d.reason);
      let res;
      try {
        res = await f(`${API}/${encodeURIComponent(phoneId)}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(msg)),
        });
      } catch { return { status: 'failed', code: 'WA_PROVIDER_FAILED', message_ar: WA_ERRORS.WA_PROVIDER_FAILED, requestId }; }
      if (!res || !res.ok) return { status: 'failed', code: 'WA_PROVIDER_FAILED', message_ar: WA_ERRORS.WA_PROVIDER_FAILED, httpStatus: (res && res.status) || null, requestId };
      let j = null; try { j = await res.json(); } catch { /* ignore */ }
      const id = j && j.messages && j.messages[0] && j.messages[0].id;
      return { status: 'sent', providerId: id || null, requestId };
    },
  };
}
