// N110 INT-01: READ-ONLY bridge to the legacy Sheets/Apps Script backend. Flag NOVA_BRIDGE=1 (default OFF).
// Secrets by NAME only: env.PHARMACY_BACKEND_URL, env.PHARMACY_BRIDGE_TOKEN (NEEDS-OWNER). Never writes to legacy.
export const bridgeEnabled = (env) => !!env && String(env.NOVA_BRIDGE) === '1';

// Field ownership: which system is the source of truth per entity field.
export const FIELD_OWNERSHIP = Object.freeze({
  product: { name: 'legacy', barcode: 'legacy', price: 'legacy', stock_qty: 'legacy', reorder_level: 'nova' },
  customer: { name: 'legacy', phone: 'legacy', notes: 'nova' },
  sale: { total: 'legacy', items: 'legacy', status: 'nova' },
});

export const BRIDGE_ERRORS = Object.freeze({
  BRIDGE_DISABLED: 'الجسر غير مفعّل.',
  BRIDGE_NOT_CONFIGURED: 'إعدادات الجسر غير مكتملة.',
  BRIDGE_UPSTREAM_FAILED: 'تعذّر قراءة بيانات النظام الحالي.',
});

export class BridgeError extends Error {
  constructor(code, requestId) { super(code); this.code = code; this.message_ar = BRIDGE_ERRORS[code]; this.requestId = requestId || null; }
}

// Real adapter: GET only. Never invoked unless flag ON and configured.
export function createHttpAdapter(env, fetchImpl = globalThis.fetch) {
  return {
    async list(entity) {
      const base = String(env.PHARMACY_BACKEND_URL || '').replace(/\/+$/, '');
      const res = await fetchImpl(`${base}?action=list&entity=${encodeURIComponent(entity)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${env.PHARMACY_BRIDGE_TOKEN}` },
      });
      if (!res.ok) throw new Error('upstream ' + res.status);
      const body = await res.json();
      return Array.isArray(body) ? body : (body.rows || []);
    },
  };
}

export function mockAdapter(data = {}) {
  return { async list(entity) { return (data[entity] || []).map((r) => ({ ...r })); } };
}

export function getAdapter(env, requestId, fetchImpl) {
  if (!bridgeEnabled(env)) throw new BridgeError('BRIDGE_DISABLED', requestId);
  if (env.NOVA_BRIDGE_ADAPTER) return env.NOVA_BRIDGE_ADAPTER; // injected (tests)
  if (!env.PHARMACY_BACKEND_URL || !env.PHARMACY_BRIDGE_TOKEN) throw new BridgeError('BRIDGE_NOT_CONFIGURED', requestId);
  return createHttpAdapter(env, fetchImpl);
}

export async function mapId(db, tenant, entity, legacyId, novaId, legacyHash = null) {
  await db.prepare(
    'INSERT INTO legacy_id_map (tenant_id, entity, legacy_id, nova_id, legacy_hash) VALUES (?,?,?,?,?) ON CONFLICT (tenant_id, entity, legacy_id) DO UPDATE SET legacy_hash = excluded.legacy_hash',
  ).bind(tenant, entity, String(legacyId), String(novaId), legacyHash).run();
}

export async function lookupNovaId(db, tenant, entity, legacyId) {
  const r = await db.prepare('SELECT nova_id FROM legacy_id_map WHERE tenant_id = ? AND entity = ? AND legacy_id = ?').bind(tenant, entity, String(legacyId)).first();
  return r ? r.nova_id : null;
}

// Reconciliation: compares legacy rows with NOVA rows (both keyed by `id`) using the id map.
// Only fields owned by 'legacy' count as conflicts; report only, never writes to either side.
export async function reconcile({ adapter, db, tenant, entity, novaRows, requestId }) {
  let legacy;
  try { legacy = await adapter.list(entity); } catch { throw new BridgeError('BRIDGE_UPSTREAM_FAILED', requestId); }
  const owners = FIELD_OWNERSHIP[entity] || {};
  const byNova = new Map(novaRows.map((r) => [String(r.id), r]));
  const report = { entity, legacyCount: legacy.length, novaCount: novaRows.length, missingInNova: [], unmapped: [], conflicts: [], matched: 0, requestId: requestId || null };
  const seen = new Set();
  for (const l of legacy) {
    const nid = await lookupNovaId(db, tenant, entity, l.id);
    if (!nid) { report.unmapped.push(String(l.id)); continue; }
    seen.add(nid);
    const n = byNova.get(nid);
    if (!n) { report.missingInNova.push(String(l.id)); continue; }
    const diffs = Object.keys(owners).filter((f) => owners[f] === 'legacy' && f in l && String(l[f]) !== String(n[f]));
    if (diffs.length) report.conflicts.push({ legacyId: String(l.id), novaId: nid, fields: diffs });
    else report.matched++;
  }
  report.orphanedInNova = novaRows.map((r) => String(r.id)).filter((id) => !seen.has(id));
  return report;
}
