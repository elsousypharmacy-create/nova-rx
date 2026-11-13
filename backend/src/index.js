// NOVA Rx backend Worker skeleton (N90). No external calls; flag-gated by the client.
import { VERSION } from './version.js';
import { registerAuthRoutes, authenticate, requireReauth } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';
import { hardeningEnabled, applySecurityHeaders, checkCsrf, rateLimit, limitFor, clientId, registerExportRoute, safeLog } from './security/hardening.js';
import { registerSyncRoutes } from './sync.js';
import { registerSyncPullRoutes } from './sync-pull.js';
import { registerImportRoutes } from './import.js';
import { registerBalanceMigrationRoutes } from './balance-migration.js';
import { observabilityEnabled, registerStatusRoute, countError, logEvent } from './observability.js';
import { registerDeployRoutes } from './deploys.js';
import { registerMsgMonitorRoutes } from './msg-monitor.js';
import { scheduledBackup } from './backup.js';

export function newRequestId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return 'req_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function parseAllowList(env) {
  return String((env && env.CORS_ALLOW_ORIGINS) || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const list = parseAllowList(env);
  const h = { 'Vary': 'Origin' };
  if (origin && list.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Request-Id';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function errorResponse(code, message_ar, status, requestId, extra) {
  return json({ ok: false, code, message_ar, requestId }, status, { 'X-Request-Id': requestId, ...extra });
}

const routes = new Map();
export function route(method, path, handler) { routes.set(method + ' ' + path, handler); }

route('GET', '/api/v1/health', (ctx) => ({ ok: true, status: 'healthy', requestId: ctx.requestId }));
route('GET', '/api/v1/version', (ctx) => ({
  ok: true, name: 'nova-rx-api', version: VERSION,
  env: String((ctx.env && ctx.env.NOVA_ENV) || 'dev'), requestId: ctx.requestId,
}));

registerStatusRoute(route, { json, errorResponse });
registerMsgMonitorRoutes(route, { json, errorResponse });
registerAuthRoutes(route, { json, errorResponse });
registerSyncRoutes(route, { json, errorResponse });
registerImportRoutes(route, { json, errorResponse });
registerBalanceMigrationRoutes(route, { json, errorResponse });
registerSyncPullRoutes(route, { errorResponse }, { authenticate });
registerDeployRoutes(route, { errorResponse }, { authenticate });
registerExportRoute(route, { json, errorResponse }, { authenticate, requireReauth, normalizeRole });

export async function handle(request, env = {}) {
  const res = await handleInner(request, env);
  return hardeningEnabled(env) ? applySecurityHeaders(res) : res;
}

async function handleInner(request, env) {
  const requestId = newRequestId();
  const cors = corsHeaders(request, env);
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'X-Request-Id': requestId } });
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (hardeningEnabled(env)) {
      const bad = checkCsrf(request, env);
      if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId, cors);
      if (env.KV) {
        const [name, cfg] = limitFor(method, path);
        const rl = await rateLimit(env.KV, name + ':' + clientId(request), cfg);
        if (!rl.ok) return errorResponse('RATE_LIMITED', 'طلبات كثيرة. حاول مرة أخرى لاحقاً.', 429, requestId, { ...cors, 'Retry-After': String(rl.retryAfter) });
      }
    }
    const h = routes.get(method + ' ' + path);
    if (!h) {
      const known = [...routes.keys()].some((k) => k.split(' ')[1] === path);
      return known
        ? errorResponse('METHOD_NOT_ALLOWED', 'الطريقة غير مسموحة لهذا المسار.', 405, requestId, cors)
        : errorResponse('NOT_FOUND', 'المسار غير موجود.', 404, requestId, cors);
    }
    const out = await h({ request, env, url, requestId });
    if (out instanceof Response) {
      const r = new Response(out.body, out);
      for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
      return r;
    }
    return json(out, 200, { 'X-Request-Id': requestId, ...cors });
  } catch (e) {
    if (hardeningEnabled(env)) safeLog({ requestId, error: String(e && e.message) });
    if (observabilityEnabled(env)) { countError('INTERNAL_ERROR'); logEvent('error', 'request_failed', { requestId, error: String(e && e.message) }); }
    return errorResponse('INTERNAL_ERROR', 'حدث خطأ داخلي. حاول مرة أخرى لاحقاً.', 500, requestId, cors);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => { const p = scheduledBackup(env); if (ctx && ctx.waitUntil) ctx.waitUntil(p); return p; },
};
