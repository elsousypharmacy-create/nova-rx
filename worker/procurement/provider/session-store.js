// Encrypted supplier session store (issue Procurement 10, epic #53).
// Sessions (login cookies/tokens captured by the browser job) are stored in
// Cloudflare KV encrypted with AES-GCM; the key derives from the Worker secret
// NOVA_SECRET_ENCRYPTION_KEY via SHA-256. This module never logs sessions and
// never sees credentials.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

const ALLOWED_SUPPLIERS = new Set(['pharmaoverseas', 'aumet']);
const KEY_PREFIX = 'supplier-session:';

function assertSupplierId(supplierId) {
  if (!ALLOWED_SUPPLIERS.has(supplierId)) {
    throw new Error(`unknown supplier id: ${String(supplierId)}`);
  }
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// kv: Cloudflare KV-style { get(key), put(key, value, { expirationTtl }), delete(key) }.
// now: injectable clock (ms epoch) for tests.
export function createSessionStore({ kv, secret, now = () => Date.now() }) {
  let keyPromise = null;
  const getKey = () => (keyPromise ??= importKey(secret));

  async function save(supplierId, session, expiresAt) {
    assertSupplierId(supplierId);
    const record = {
      session,
      expiresAt: expiresAt ?? null,
      savedAt: new Date(now()).toISOString(),
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(record));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), plaintext);
    const payload = JSON.stringify({ v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) });
    const expMs = Date.parse(record.expiresAt ?? '');
    const opts = Number.isFinite(expMs)
      ? { expirationTtl: Math.max(1, Math.floor((expMs - now()) / 1000)) }
      : undefined;
    await kv.put(KEY_PREFIX + supplierId, payload, opts);
  }

  // Returns { session, expiresAt, savedAt } or null when missing, expired
  // (unless ignoreExpiry), or undecryptable (e.g. wrong secret).
  async function load(supplierId, { ignoreExpiry = false } = {}) {
    assertSupplierId(supplierId);
    const raw = await kv.get(KEY_PREFIX + supplierId);
    if (typeof raw !== 'string') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed?.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') {
      return null;
    }
    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) },
        await getKey(),
        base64ToBytes(parsed.ct),
      );
    } catch {
      return null;
    }
    let record;
    try {
      record = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return null;
    }
    if (!record || typeof record !== 'object') return null;
    const expMs = Date.parse(record.expiresAt ?? '');
    if (!ignoreExpiry && Number.isFinite(expMs) && expMs <= now()) return null;
    return {
      session: record.session ?? null,
      expiresAt: record.expiresAt ?? null,
      savedAt: record.savedAt ?? null,
    };
  }

  async function remove(supplierId) {
    assertSupplierId(supplierId);
    await kv.delete(KEY_PREFIX + supplierId);
  }

  return { save, load, remove };
}
