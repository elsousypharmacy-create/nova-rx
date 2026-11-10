import { createSupplierOrders } from './supplier-orders.js';
import { createSupplierCartService } from './supplier-cart-service.js';
// Supplier HTTP API for the Worker (issue Procurement 10, epic #53).
// JSON-only routes for session ingest (browser job) and the app's supplier
// search/status. Both shared secrets are compared constant-time; when an env
// secret is missing the route answers 503 not-configured (never open).
// Responses never echo request bodies and never contain session fields.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

const SEARCHES_PER_MINUTE = 40;
const MAX_FAILED_AUTH_PER_MINUTE = 8;
const RATE_WINDOW_MS = 60000;

const ROUTES = new Set([
  '/api/suppliers/session',
  '/api/suppliers/status',
  '/api/suppliers/search',
  '/api/suppliers/list',
  '/api/suppliers/sellers',
  '/api/purchases/stock',
  '/api/purchases/aumet-cart/preview',
  '/api/purchases/aumet-cart/apply',
  '/api/purchases/aumet-cart/status',
  '/api/purchases/pharmaoverseas-cart/preview',
  '/api/purchases/pharmaoverseas-cart/apply',
  '/api/purchases/pharmaoverseas-cart/status',
  '/api/purchases/orders/preview',
  '/api/purchases/orders/apply',
  '/api/purchases/orders/status',
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

export function createSupplierApi({ hub, store, env = {}, fetch: fetchImpl = globalThis.fetch }) {
  const orders=createSupplierOrders({store,hub,secret:env.NOVA_SECRET_ENCRYPTION_KEY||'',db:env.NOVA_PURCHASE_OPS,fetch:fetchImpl});
  const cart = createSupplierCartService({store,hub,secret:env.NOVA_SECRET_ENCRYPTION_KEY||'',db:env.NOVA_PURCHASE_OPS,fetch:fetchImpl});
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

  // Wrong-secret attempts are limited so a PIN cannot be guessed by trying many values.
  let failWindowStart = 0;
  let failCount = 0;
  function tooManyFailures(nowMs) {
    if (nowMs - failWindowStart >= RATE_WINDOW_MS) {
      failWindowStart = nowMs;
      failCount = 0;
    }
    return failCount >= MAX_FAILED_AUTH_PER_MINUTE;
  }
  function lockedResponse(nowMs) {
    const retry = Math.max(1, Math.ceil((failWindowStart + RATE_WINDOW_MS - nowMs) / 1000));
    return json({ error: 'too-many-attempts' }, 429, { 'Retry-After': String(retry) });
  }

  async function requirePin(request) {
    if (!env.NOVA_API_PIN) return json({ error: 'not-configured' }, 503);
    if (tooManyFailures(Date.now())) return lockedResponse(Date.now());
    if (!(await secretsEqual(request.headers.get('X-Nova-Pin'), env.NOVA_API_PIN))) {
      failCount += 1;
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
      if (tooManyFailures(Date.now())) return lockedResponse(Date.now());
      if (!(await secretsEqual(request.headers.get('X-Ingest-Secret'), env.NOVA_INGEST_SECRET))) {
        failCount += 1;
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
        // Keep the observed contract only across renewal of the same pharmacy.
        if(body.supplierId==='aumet'&&!body.session.cartRequestTemplate){
          const old=await store.load('aumet',{ignoreExpiry:true});
          const owner=body.session.searchParams?.pharmacy_id;
          if(owner!=null&&String(owner)===String(old?.session?.searchParams?.pharmacy_id))body.session.cartRequestTemplate=old.session.cartRequestTemplate||null;
        }
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

    if (path === '/api/suppliers/sellers') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const denied = await requirePin(request); if (denied) return denied;
      return json({ sellers: await hub.sellers() });
    }
    if(path.startsWith('/api/purchases/orders/')){
      if(request.method!=='POST')return json({error:'method-not-allowed'},405);
      const denied=await requirePin(request);if(denied)return denied;
      if(!env.NOVA_SECRET_ENCRYPTION_KEY)return json({error:'not-configured'},503);
      const retry=searchLimited(Date.now());if(retry)return json({error:'rate-limited'},429);
      try{return json(await (path.endsWith('/preview')?orders.preview(await readJson(request)):path.endsWith('/status')?orders.status(await readJson(request)):orders.apply(await readJson(request))));}
      catch(e){return json({ok:false,error:/^(order-|cart-|bad-request)/.test(e.message)?e.message:'order-unavailable'},409);}
    }
    if (/^\/api\/purchases\/(?:aumet|pharmaoverseas)-cart\//.test(path)) {
      if(request.method!=='POST')return json({error:'method-not-allowed'},405);
      const denied=await requirePin(request);if(denied)return denied;
      if(!env.NOVA_SECRET_ENCRYPTION_KEY)return json({error:'not-configured'},503);
      const retry=searchLimited(Date.now());if(retry)return json({error:'rate-limited'},429);
      try{const supplier=path.includes('/aumet-cart/')?'aumet':'pharmaoverseas';return json(await (path.endsWith('/preview')?cart.preview(supplier,await readJson(request)):path.endsWith('/status')?cart.status(supplier,await readJson(request)):cart.apply(supplier,await readJson(request))));}
      catch(e){return json({ok:false,error:/^(cart-|bad-request)/.test(e.message)?e.message:'cart-unavailable'},409);}
    }
    if (path === '/api/purchases/stock') {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      const denied = await requirePin(request); if (denied) return denied;
      const body = await readJson(request);
      if (!body || typeof body.dashboardPin !== 'string' || body.dashboardPin.length > 128) return json({ error: 'bad-request' }, 400);
      const retry = searchLimited(Date.now());
      if (retry) return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(retry) });
      try {
        const upstream = await fetchImpl(env.NOVA_STOCK_SOURCE_URL || 'https://script.google.com/macros/s/AKfycbyETI5UTPwpMFOu-aWoKKHqyppa7ctTVJjckmbTxegDq7E3R3p6aEBzqt275HNL8SBfWg/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'novaPurchasingFeed', pin: body.dashboardPin }),
          signal: AbortSignal.timeout(45000), redirect: 'follow',
        });
        const data = await upstream.json();
        if (data.lockError || data.pinError) return json({ ok: false, error: 'source-auth-required' }, 403);
        if (!upstream.ok || !data.ok || data.schemaVersion !== 1 || !Array.isArray(data.items)) return json({ ok: false, error: 'source-not-ready' }, 503);
        return json(data);
      } catch { return json({ ok: false, error: 'source-unavailable' }, 502); }
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
    const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds.filter(id => ['aumet', 'pharmaoverseas'].includes(id)) : undefined;
    // Fail closed: a missing or malformed selection means NO Aumet warehouse, never all of them.
    const aumetSellerIds=Array.isArray(body.aumetSellerIds)?body.aumetSellerIds.map(String):[];
    return json(await hub.search(body.query, { requestedQty, supplierIds, aumetSellerIds }));
  }

  return handle;
}

