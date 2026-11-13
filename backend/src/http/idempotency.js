// FND-04: idempotency, pagination, timeouts. Pure helpers, no network, no deps.
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_TIMEOUT_MS = 10000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

// Feature flag: defaults OFF unless env.NOVA_API_CONTRACT === '1'.
export function contractEnabled(env) {
  return !!env && String(env.NOVA_API_CONTRACT) === '1';
}

export function isWriteMethod(m) { return WRITE_METHODS.has(String(m).toUpperCase()); }

function err(code, message_ar, status, requestId) {
  return { ok: false, code, message_ar, requestId, status };
}

export function memoryStore() {
  const m = new Map();
  return { async get(k) { return m.get(k) || null; }, async put(k, v) { m.set(k, v); } };
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

// Wraps a write handler. handler(request) -> {status, body}. Returns {status, body, replayed}.
export async function withIdempotency({ request, store, scope = '', requestId, handler }) {
  if (!isWriteMethod(request.method)) return { ...(await handler(request)), replayed: false };
  const key = request.headers.get('Idempotency-Key');
  if (!key) {
    const e = err('IDEMPOTENCY_KEY_REQUIRED', 'رأس Idempotency-Key مطلوب لعمليات الكتابة.', 400, requestId);
    return { status: 400, body: e, replayed: false };
  }
  if (!KEY_RE.test(key)) {
    const e = err('IDEMPOTENCY_KEY_INVALID', 'قيمة Idempotency-Key غير صالحة.', 400, requestId);
    return { status: 400, body: e, replayed: false };
  }
  const url = new URL(request.url);
  const fp = await sha256(request.method + ' ' + url.pathname + '\n' + (await request.clone().text()));
  const sk = scope + '|' + key;
  const hit = await store.get(sk);
  if (hit) {
    if (hit.fingerprint !== fp) {
      const e = err('IDEMPOTENCY_KEY_REUSED', 'تم استخدام مفتاح التكرار مع طلب مختلف.', 422, requestId);
      return { status: 422, body: e, replayed: false };
    }
    return { status: hit.status, body: hit.body, replayed: true };
  }
  const res = await handler(request);
  if (res.status < 500) await store.put(sk, { fingerprint: fp, status: res.status, body: res.body });
  return { status: res.status, body: res.body, replayed: false };
}

function b64(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }
export function encodeCursor(obj) { return b64(JSON.stringify(obj)); }
export function decodeCursor(c) {
  try { const v = JSON.parse(unb64(c)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

// Returns {limit, cursor} or {error:{code,message_ar,status}}.
export function parsePagination(url) {
  const u = url instanceof URL ? url : new URL(url);
  let limit = DEFAULT_PAGE_SIZE;
  const raw = u.searchParams.get('limit');
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return { error: { code: 'PAGINATION_INVALID', message_ar: 'قيمة limit غير صالحة.', status: 400 } };
    limit = Math.min(Number(raw), MAX_PAGE_SIZE);
  }
  const c = u.searchParams.get('cursor');
  let cursor = null;
  if (c) {
    cursor = decodeCursor(c);
    if (!cursor) return { error: { code: 'CURSOR_INVALID', message_ar: 'قيمة cursor غير صالحة.', status: 400 } };
  }
  return { limit, cursor };
}

// rows fetched with limit+1; lastKey(row) builds the cursor payload.
export function paginate(rows, limit, lastKey) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(lastKey(items[items.length - 1])) : null };
}

export class TimeoutError extends Error { constructor(ms) { super('timeout ' + ms); this.code = 'REQUEST_TIMEOUT'; this.timeoutMs = ms; } }

export async function withTimeout(fn, ms = DEFAULT_TIMEOUT_MS) {
  const ac = new AbortController();
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new TimeoutError(ms)); }, ms); });
  try { return await Promise.race([fn(ac.signal), timer]); } finally { clearTimeout(t); }
}

export function timeoutErrorBody(requestId) {
  return err('REQUEST_TIMEOUT', 'انتهت مهلة الطلب. حاول مرة أخرى.', 504, requestId);
}
