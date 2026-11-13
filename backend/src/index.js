// NOVA Rx backend Worker skeleton (N90). No external calls; flag-gated by the client.
import { VERSION } from './version.js';

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

export async function handle(request, env = {}) {
  const requestId = newRequestId();
  const cors = corsHeaders(request, env);
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'X-Request-Id': requestId } });
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const h = routes.get(method + ' ' + path);
    if (!h) {
      const known = [...routes.keys()].some((k) => k.split(' ')[1] === path);
      return known
        ? errorResponse('METHOD_NOT_ALLOWED', 'الطريقة غير مسموحة لهذا المسار.', 405, requestId, cors)
        : errorResponse('NOT_FOUND', 'المسار غير موجود.', 404, requestId, cors);
    }
    const out = await h({ request, env, url, requestId });
    return json(out, 200, { 'X-Request-Id': requestId, ...cors });
  } catch (e) {
    return errorResponse('INTERNAL_ERROR', 'حدث خطأ داخلي. حاول مرة أخرى لاحقاً.', 500, requestId, cors);
  }
}

export default { fetch: (request, env) => handle(request, env) };
