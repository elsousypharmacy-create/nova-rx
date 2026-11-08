// Supplier HTTP API for the Worker (issue Procurement 10, epic #53).
// JSON-only routes for session ingest (browser job) and the app's supplier
// search/status. Both shared secrets are compared constant-time; when an env
// secret is missing the route answers 503 not-configured (never open).
// Responses never echo request bodies and never contain session fields.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

const SEARCHES_PER_MINUTE = 40;
const RATE_WINDOW_MS = 60000;

const ROUTES = new Set([
  '/api/suppliers/session',
  '/api/suppliers/status',
  '/api/suppliers/search',
  '/api/suppliers/list',
]);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

// Constant-time even for different lengths: both sides are hashed first.
async function secretsEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a ?? ''))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b ?? ''))),
  ]);
  const xa = new Uint8Array(ha);
  const xb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ xb[i];
  return diff === 0;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function createSupplierApi({ hub, store, env = {} }) {
  let windowStart = 0;
  let windowCount = 0;

  // Fixed 1-minute window; returns seconds-until-reset when limited, else 0.
  function searchLimited(nowMs) {
    if (nowMs - windowStart >= RATE_WINDOW_MS) {
      windowStart = nowMs;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount <= SEARCHES_PER_MINUTE) return 0;
    return Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - nowMs) / 1000));
  }

  async function requirePin(request) {
    if (!env.NOVA_API_PIN) return json({ error: 'not-configured' }, 503);
    if (!(await secretsEqual(request.headers.get('X-Nova-Pin'), env.NOVA_API_PIN))) {
      return json({ error: 'unauthorized' }, 401);
    }
    return null;
  }

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!ROUTES.has(path)) return null;

    if (path === '/api/suppliers/session') {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      if (!env.NOVA_INGEST_SECRET) return json({ error: 'not-configured' }, 503);
      if (!(await secretsEqual(request.headers.get('X-Ingest-Secret'), env.NOVA_INGEST_SECRET))) {
        return json({ error: 'unauthorized' }, 401);
      }
      const body = await readJson(request);
      if (
        !body ||
        typeof body.supplierId !== 'string' ||
        !body.session ||
        typeof body.session !== 'object' ||
        typeof body.expiresAt !== 'string' ||
        Number.isNaN(Date.parse(body.expiresAt))
      ) {
        return json({ error: 'bad-request' }, 400);
      }
      try {
        await store.save(body.supplierId, body.session, body.expiresAt);
      } catch {
        return json({ error: 'bad-request' }, 400);
      }
      return json({ ok: true });
    }

    if (path === '/api/suppliers/status') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const denied = await requirePin(request);
      if (denied) return denied;
      return json({ suppliers: await hub.status() });
    }

    if (path === '/api/suppliers/list') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const denied = await requirePin(request);
      if (denied) return denied;
      const suppliers = (await hub.status()).map(({ id, name }) => ({ id, name }));
      return json({ suppliers });
    }

    // path === '/api/suppliers/search'
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    const denied = await requirePin(request);
    if (denied) return denied;
    const body = await readJson(request);
    if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
      return json({ error: 'bad-request' }, 400);
    }
    const retryAfter = searchLimited(Date.now());
    if (retryAfter > 0) {
      return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const requestedQty = Number.isFinite(Number(body.requestedQty)) && Number(body.requestedQty) >= 1
      ? Math.floor(Number(body.requestedQty))
      : 1;
    return json(await hub.search(body.query, { requestedQty }));
  }

  return handle;
}
