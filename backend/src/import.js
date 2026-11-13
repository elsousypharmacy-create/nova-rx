// N105: POST /api/v1/import/dry-run (never writes) and POST /api/v1/import (owner + reauth + confirm, empty tenant only).
// Flag NOVA_IMPORT=1 (default OFF) + NOVA_AUTH session + DB binding. No network.
// Bundle: {format:'nova-rx-export', version:1, master:{entity:[{id,...}]}, ledger:{entity:[{id,...}]}}.
import { authenticate, requireReauth } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';
import { audit } from './audit.js';

export const BUNDLE_FORMAT = 'nova-rx-export';
export const BUNDLE_VERSION = 1;
export const MAX_RECORDS = 5000;
export const CONFIRM_TEXT = 'IMPORT';
export function importEnabled(env) { return !!env && String(env.NOVA_IMPORT) === '1' && !!env.DB; }

const ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,48}$/;

// Returns {records:[{kind,entity,id,data}], errors:[{code,message_ar,entity?,id?}]}.
export function parseBundle(b) {
  const records = [], errors = [];
  const bad = (code, message_ar, extra) => errors.push({ code, message_ar, ...extra });
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) { bad('IMPORT_BAD_FORMAT', 'ملف غير صالح: ليس حزمة تصدير NOVA Rx.'); return { records, errors }; }
  if (b.version !== BUNDLE_VERSION) { bad('IMPORT_BAD_VERSION', 'إصدار الحزمة غير مدعوم.'); return { records, errors }; }
  const seen = new Set();
  for (const kind of ['master', 'ledger']) {
    const sec = b[kind];
    if (sec == null) continue;
    if (typeof sec !== 'object' || Array.isArray(sec)) { bad('IMPORT_BAD_SECTION', 'قسم غير صالح في الحزمة.', { entity: kind }); continue; }
    for (const [entity, rows] of Object.entries(sec)) {
      if (!NAME_RE.test(entity) || !Array.isArray(rows)) { bad('IMPORT_BAD_ENTITY', 'كيان غير صالح في الحزمة.', { entity }); continue; }
      for (const row of rows) {
        const id = row && typeof row === 'object' ? row.id : undefined;
        if (typeof id !== 'string' || !ID_RE.test(id) || Array.isArray(row)) { bad('IMPORT_BAD_RECORD', 'سجل بدون معرّف صالح.', { entity }); continue; }
        const key = kind + '|' + entity + '|' + id;
        if (seen.has(key)) { bad('IMPORT_DUPLICATE_ID', 'معرّف مكرر داخل الحزمة.', { entity, id }); continue; }
        seen.add(key);
        records.push({ kind, entity, id, data: JSON.stringify(row) });
      }
    }
  }
  return { records, errors };
}

const table = (kind) => (kind === 'master' ? { t: 'sync_master', col: 'data_json' } : { t: 'sync_ledger', col: 'payload_json' });

export async function tenantIsEmpty(db, tenant) {
  for (const t of ['sync_master', 'sync_ledger']) {
    const r = await db.prepare(`SELECT 1 AS x FROM ${t} WHERE tenant_id=? LIMIT 1`).bind(tenant).first();
    if (r) return false;
  }
  return true;
}

// Read-only reconciliation: per entity counts of new / identical / different; never writes.
export async function dryRun(db, tenant, records) {
  const entities = {};
  for (const r of records) {
    const { t, col } = table(r.kind);
    const e = (entities[r.kind + ':' + r.entity] ||= { kind: r.kind, entity: r.entity, total: 0, new: 0, identical: 0, different: 0, differentIds: [] });
    const ex = await db.prepare(`SELECT ${col} AS d FROM ${t} WHERE tenant_id=? AND entity=? AND id=?`).bind(tenant, r.entity, r.id).first();
    e.total++;
    if (!ex) e.new++;
    else if (ex.d === r.data) e.identical++;
    else { e.different++; if (e.differentIds.length < 20) e.differentIds.push(r.id); }
  }
  const list = Object.values(entities);
  const sum = (k) => list.reduce((n, e) => n + e[k], 0);
  return { entities: list, totals: { records: records.length, new: sum('new'), identical: sum('identical'), different: sum('different') }, tenantEmpty: await tenantIsEmpty(db, tenant) };
}

export function registerImportRoutes(route, { json, errorResponse }) {
  async function guard(ctx, sensitive) {
    const { env, requestId } = ctx;
    if (!importEnabled(env)) return { res: errorResponse('IMPORT_DISABLED', 'خدمة الاستيراد غير مفعّلة.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    if (sensitive) {
      const re = requireReauth(a.session);
      if (re.fail) return { res: errorResponse(re.fail.code, re.fail.message_ar, re.fail.status, requestId) };
    }
    let body; try { body = await ctx.request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return { res: errorResponse('IMPORT_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    const bundle = body.bundle || (body.format ? body : null);
    const p = parseBundle(bundle);
    if (p.records.length > MAX_RECORDS) return { res: errorResponse('IMPORT_TOO_LARGE', 'حجم الحزمة يتجاوز الحد المسموح.', 413, requestId) };
    return { a, body, p, tenant: String(a.session.tenant || env.NOVA_TENANT_ID || 'default') };
  }

  route('POST', '/api/v1/import/dry-run', async (ctx) => {
    const g = await guard(ctx, false);
    if (g.res) return g.res;
    const { requestId, env } = ctx;
    if (g.p.errors.length && !g.p.records.length) return errorResponse(g.p.errors[0].code, g.p.errors[0].message_ar, 422, requestId);
    const report = await dryRun(env.DB, g.tenant, g.p.records);
    return json({ ok: true, dryRun: true, written: 0, report, errors: g.p.errors, requestId }, 200, { 'X-Request-Id': requestId });
  });

  route('POST', '/api/v1/import', async (ctx) => {
    const g = await guard(ctx, true);
    if (g.res) return g.res;
    const { requestId, env } = ctx;
    if (g.body.confirm !== CONFIRM_TEXT) return errorResponse('IMPORT_CONFIRM_REQUIRED', 'يلزم تأكيد صريح للاستيراد (confirm).', 400, requestId);
    if (g.p.errors.length) return errorResponse(g.p.errors[0].code, g.p.errors[0].message_ar, 422, requestId);
    if (!g.p.records.length) return errorResponse('IMPORT_EMPTY', 'الحزمة لا تحتوي على سجلات.', 422, requestId);
    if (!(await tenantIsEmpty(env.DB, g.tenant))) return errorResponse('IMPORT_TENANT_NOT_EMPTY', 'الاستيراد مسموح فقط لمستأجر فارغ.', 409, requestId);
    let n = 0;
    try {
      for (const r of g.p.records) {
        if (r.kind === 'master') await env.DB.prepare('INSERT INTO sync_master (id,tenant_id,entity,version,data_json) VALUES (?,?,?,1,?)').bind(r.id, g.tenant, r.entity, r.data).run();
        else await env.DB.prepare('INSERT INTO sync_ledger (id,tenant_id,entity,payload_json) VALUES (?,?,?,?)').bind(r.id, g.tenant, r.entity, r.data).run();
        n++;
      }
    } catch {
      await audit(env, { actor: g.a.session.user, action: 'import.apply', entity: 'import', requestId, outcome: 'FAILED', after: { inserted: n, total: g.p.records.length } });
      return errorResponse('IMPORT_PARTIAL_FAILURE', 'فشل الاستيراد جزئياً. راجع السجل قبل إعادة المحاولة.', 500, requestId);
    }
    await audit(env, { actor: g.a.session.user, action: 'import.apply', entity: 'import', requestId, outcome: 'ALLOWED', after: { inserted: n } });
    return json({ ok: true, inserted: n, requestId }, 200, { 'X-Request-Id': requestId });
  });
}
