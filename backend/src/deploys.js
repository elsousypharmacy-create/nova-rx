// N108 deploy record: GET /api/v1/deploys?env=&limit= . Flag NOVA_DEPLOYS=1 (default OFF) + D1 binding DB + auth.
import { compareVersions } from './version.js';

export const deploysEnabled = (env) => !!env && String(env.NOVA_DEPLOYS) === '1';

export async function listDeploys(db, { env, limit = 20 }) {
  const n = Math.min(100, Math.max(1, limit | 0 || 20));
  const { results } = await db.prepare(
    'SELECT id, version, sha, env, status, cf_version_id, note, deployed_at FROM deploy_records WHERE env = ? ORDER BY id DESC LIMIT ?',
  ).bind(env, n).all();
  return results || [];
}

// Newest record (id DESC order) that is not the live one, not failed/rolled_back, and not newer than live.
export function previousGood(rows) {
  const live = rows.find((r) => r.status === 'live');
  if (!live) return null;
  return rows.find((r) => r.id !== live.id && (r.status === 'superseded') && compareVersions(r.version, live.version) <= 0) || null;
}

export function registerDeployRoutes(route, { errorResponse }, { authenticate }) {
  route('GET', '/api/v1/deploys', async (ctx) => {
    const { env, requestId, url, request } = ctx;
    if (!deploysEnabled(env) || !env.DB || !env.KV) return errorResponse('DEPLOYS_DISABLED', 'سجل الإصدارات غير مفعّل.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const lim = url.searchParams.get('limit');
    if (lim !== null && !/^\d{1,3}$/.test(lim)) return errorResponse('DEPLOYS_BAD_LIMIT', 'حد الصفحة غير صالح.', 400, requestId);
    const e = url.searchParams.get('env') || String(env.NOVA_ENV || 'dev');
    try {
      const deploys = await listDeploys(env.DB, { env: e, limit: lim === null ? 20 : Number(lim) });
      const prev = previousGood(deploys);
      return { ok: true, deploys, previousGood: prev ? { version: prev.version, sha: prev.sha } : null, requestId };
    } catch {
      return errorResponse('DEPLOYS_FAILED', 'تعذّر قراءة سجل الإصدارات.', 503, requestId);
    }
  });
}
