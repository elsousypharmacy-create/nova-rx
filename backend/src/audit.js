// SEC-04 server audit log. Append-only rows in D1 `audit_logs` (triggers in 0003 block UPDATE/DELETE).
// Flag NOVA_AUDIT=1 (default OFF) and a D1 binding `DB`. Redaction reuses worker/security/audit-log.js rules
// (secret keys -> [REDACTED], phone/PII -> last 4, inline tokens scrubbed). Never throws: audit failure must not break requests.
import { maskSensitiveFields, scrubInlineSecrets } from '../../worker/security/audit-log.js';

export function auditEnabled(env) { return !!env && String(env.NOVA_AUDIT) === '1' && !!env.DB; }

const MAX_JSON = 4096;
// Phone numbers embedded in free text (international or local, 8+ digits) -> keep last 4.
const PHONE_RE = /(?<![\w])\+?\d[\d\s-]{6,}\d(?![\w])/g;
const maskPhones = (s) => s.replace(PHONE_RE, (m) => {
  const d = m.replace(/\D/g, '');
  return d.length < 8 ? m : '*'.repeat(d.length - 4) + d.slice(-4);
});
const clean = (s) => maskPhones(scrubInlineSecrets(String(s)));

function deepText(v) {
  if (typeof v === 'string') return clean(v);
  if (Array.isArray(v)) return v.map(deepText);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = deepText(v[k]); return o; }
  return v;
}
export function redact(value) {
  if (value === undefined || value === null) return null;
  const s = JSON.stringify(deepText(maskSensitiveFields(value)));
  return s.length > MAX_JSON ? JSON.stringify({ truncated: true }) : s;
}

export function buildRow(e, now = () => new Date()) {
  const id = 'aud_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const t = (x, n = 128) => (x == null ? null : clean(x).slice(0, n));
  return {
    id, tenant_id: t(e.tenantId, 64) || 'default', branch_id: t(e.branchId, 64), actor_id: t(e.actor, 64),
    action: t(e.action, 64) || 'unknown', entity: t(e.entity, 64), entity_id: t(e.entityId),
    detail: null, request_id: t(e.requestId, 64), outcome: t(e.outcome, 16),
    before_json: redact(e.before), after_json: redact(e.after), reason: t(e.reason, 256),
    created_at: now().toISOString(),
  };
}

// -> true when written. Off / no DB / DB error -> false (never throws).
export async function audit(env, event, opts = {}) {
  if (!auditEnabled(env)) return false;
  try {
    const r = buildRow(event, opts.now);
    await env.DB.prepare(
      'INSERT INTO audit_logs (id,tenant_id,branch_id,actor_id,action,entity,entity_id,detail,request_id,created_at,before_json,after_json,reason,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(r.id, r.tenant_id, r.branch_id, r.actor_id, r.action, r.entity, r.entity_id, r.detail, r.request_id, r.created_at,
      r.before_json, r.after_json, r.reason, r.outcome).run();
    return true;
  } catch { return false; }
}
