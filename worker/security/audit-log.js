// SEC-04 audit log core. Pure module: no I/O, no storage choice, no secrets, no network.
// WebCrypto only (crypto.subtle), so it runs the same in Node 22 and in a Cloudflare Worker.
//
// What it gives:
//   canonicalJson        deterministic serialisation (strict: refuses anything ambiguous)
//   maskSensitiveFields  recursive redaction of secrets / PII before an event is hashed or stored
//   appendAuditEvent     builds the next entry of a per-tenant HMAC chain and stores it with compare-and-swap
//   verifyAuditChain     recomputes the whole chain; detects edit, delete, reorder, truncation, splice, wrong key
//
// What it does NOT give (be honest about it):
//   - It does not make a database append-only. The store contract has no update/delete, but real storage must enforce
//     that (FND-02 is undecided).
//   - The HMAC key must live OUTSIDE the audit storage (a Worker secret). Anyone who holds the key can forge a chain.
//   - Truncation of the newest entries is only detectable if the verifier knows the expected head (`expectedHead`).
//   - Redaction is by key name and by string pattern. It is defence in depth, not a substitute for logging fewer fields.

const enc = new TextEncoder();
const MAX_DEPTH = 32;
const REDACTED = '[REDACTED]';
const GENESIS = 'hmac-sha256:' + '0'.repeat(64);

export const AUDIT_CATEGORIES = Object.freeze(['AUTH_SESSION', 'ACCESS_CONTROL', 'FINANCIAL_LEDGER', 'INVENTORY_SENSITIVE', 'CLINICAL_CONTROLLED', 'SYSTEM_CONFIG']);
export const AUDIT_OUTCOMES = Object.freeze(['ALLOWED', 'DENIED', 'ERROR']);
const ID = /^[A-Za-z0-9_-]{1,64}$/; // no ':' so tenant/branch can be used in namespaced keys without ambiguity
const ACTION = /^[a-z][a-z0-9_.]{2,80}$/;

// ---------------------------------------------------------------------------------------------------------------
// canonical JSON
// ---------------------------------------------------------------------------------------------------------------

const isPlain = v => {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

// Sorted keys (UTF-16 code unit order), no whitespace. Throws on undefined, functions, symbols, bigint, NaN/Infinity,
// Date/Map/Set/class instances and on depth > 32 (which also stops cycles). Strictness is the point: two different
// inputs must never serialise to the same bytes, and the same input must always serialise to the same bytes.
export function canonicalJson(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('canonical-too-deep');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonical-number');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object': break;
    default: throw new Error(`canonical-type:${typeof value}`);
  }
  if (Array.isArray(value)) return '[' + value.map(v => canonicalJson(v, depth + 1)).join(',') + ']';
  if (!isPlain(value)) throw new Error('canonical-object');
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k], depth + 1)).join(',') + '}';
}

// ---------------------------------------------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------------------------------------------

const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const EXACT_SECRET = new Set(['pin', 'pincode', 'pinhash', 'adminpin', 'novapin', 'xnovapin', 'otp', 'cvv', 'cvc', 'iban', 'pwd', 'sig', 'signature']);
const SUBSTR_SECRET = ['password', 'passwd', 'passphrase', 'secret', 'token', 'apikey', 'authorization', 'cookie', 'credential', 'privatekey', 'cardnumber', 'accesskey', 'sessionid', 'bearer'];
const PARTIAL = ['phone', 'mobile', 'whatsapp', 'nationalid', 'nid'];

const isSecretKey = k => { const n = normKey(k); return EXACT_SECRET.has(n) || SUBSTR_SECRET.some(s => n.includes(s)); };
const isPartialKey = k => { const n = normKey(k); return PARTIAL.some(s => n.includes(s)); };

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi,
  /\b(?:password|passwd|pin|token|secret|api[_-]?key|authorization)\s*[=:]\s*\S+/gi,
];

// Replaces known secret shapes inside free text.
export function scrubInlineSecrets(text) {
  let s = String(text);
  for (const re of SECRET_PATTERNS) s = s.replace(re, REDACTED);
  return s;
}

const maskPartial = v => {
  const s = String(v);
  return s.length <= 4 ? '*'.repeat(s.length) : '*'.repeat(s.length - 4) + s.slice(-4);
};

const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); // safe for "__proto__"

// Returns a NEW structure; the input is never modified. Unsupported values become markers instead of throwing, so an
// unexpected payload can never stop an audit write.
export function maskSensitiveFields(value, depth = 0) {
  if (value === null || value === undefined) return value === undefined ? undefined : null;
  switch (typeof value) {
    case 'string': return scrubInlineSecrets(value);
    case 'boolean': return value;
    case 'number': return Number.isFinite(value) ? value : null;
    case 'bigint': return String(value);
    case 'function': case 'symbol': return undefined;
    default: break;
  }
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map(v => { const m = maskSensitiveFields(v, depth + 1); return m === undefined ? null : m; });
  if (!isPlain(value)) return '[UNSUPPORTED]';
  const out = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (v === undefined) continue;
    if (isSecretKey(k)) { setOwn(out, k, REDACTED); continue; }
    if (isPartialKey(k) && (typeof v === 'string' || typeof v === 'number')) { setOwn(out, k, maskPartial(v)); continue; }
    const m = maskSensitiveFields(v, depth + 1);
    if (m !== undefined) setOwn(out, k, m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------------------------------------------

const toBytes = key => (typeof key === 'string' ? enc.encode(key) : key instanceof Uint8Array ? key : null);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmac(key, text) {
  const bytes = toBytes(key);
  if (!bytes || bytes.length < 32) throw new Error('key-too-short (need at least 32 bytes)');
  const k = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

const sameText = (a, b) => { // constant-time for equal lengths
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const hashEntry = async (key, entryWithoutHash) => 'hmac-sha256:' + await hmac(key, canonicalJson(entryWithoutHash));

// ---------------------------------------------------------------------------------------------------------------
// building an entry
// ---------------------------------------------------------------------------------------------------------------

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const isoOk = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s) && !Number.isNaN(Date.parse(s));
const nonEmpty = s => typeof s === 'string' && s.trim() !== '';

// Validates the caller's event and returns { ok:true, event } (already masked) or { ok:false, error }.
export async function prepareEvent(input, key, { now = () => new Date().toISOString(), newId = () => 'aud_' + crypto.randomUUID() } = {}) {
  const e = input && typeof input === 'object' ? input : {};
  if (!ID.test(String(e.tenantId ?? ''))) return { ok: false, error: 'tenantId-invalid' };
  if (e.branchId !== undefined && e.branchId !== null && !ID.test(String(e.branchId))) return { ok: false, error: 'branchId-invalid' };
  if (!ACTION.test(String(e.action ?? ''))) return { ok: false, error: 'action-invalid' };
  if (!AUDIT_CATEGORIES.includes(e.category)) return { ok: false, error: 'category-invalid' };
  if (!AUDIT_OUTCOMES.includes(e.outcome)) return { ok: false, error: 'outcome-invalid' };
  if (!nonEmpty(e.requestId)) return { ok: false, error: 'requestId-missing' };
  const actor = e.actor && typeof e.actor === 'object' ? e.actor : {};
  if (!nonEmpty(actor.userId)) return { ok: false, error: 'actor-missing' };
  const res = e.resource && typeof e.resource === 'object' ? e.resource : {};
  if (!nonEmpty(res.type) || res.id === undefined || res.id === null || String(res.id) === '') return { ok: false, error: 'resource-missing' };
  const timestamp = e.timestamp ?? now();
  if (!isoOk(timestamp)) return { ok: false, error: 'timestamp-invalid' };
  if (e.statusCode !== undefined && !(Number.isInteger(e.statusCode) && e.statusCode >= 100 && e.statusCode <= 599)) return { ok: false, error: 'statusCode-invalid' };

  const event = {
    eventId: newId(), timestamp, tenantId: String(e.tenantId),
    branchId: e.branchId === undefined || e.branchId === null ? null : String(e.branchId),
    actor: {
      userId: String(actor.userId),
      roles: Array.isArray(actor.roles) ? actor.roles.map(String).sort() : [],
      deviceId: actor.deviceId === undefined ? null : String(actor.deviceId),
      // The raw IP is personal data in an immutable log: keep only a keyed hash (same source -> same value).
      ipHash: actor.ipAddress ? (await hmac(key, 'ip|' + String(actor.ipAddress))).slice(0, 16) : null,
    },
    action: e.action, category: e.category, outcome: e.outcome,
    statusCode: e.statusCode ?? null, requestId: String(e.requestId),
    resource: { type: String(res.type), id: String(res.id) },
    changes: e.changes === undefined ? null : maskSensitiveFields(e.changes),
    metadata: e.metadata === undefined ? null : maskSensitiveFields(e.metadata),
  };
  return { ok: true, event };
}

export async function buildEntry(event, head, key) {
  const body = { v: 1, ...event, seq: head.seq + 1, prevHash: head.hash };
  const entryHash = await hashEntry(key, body);
  return deepFreeze({ ...body, entryHash });
}

// ---------------------------------------------------------------------------------------------------------------
// store contract + in-memory implementation (tests and local use)
// ---------------------------------------------------------------------------------------------------------------
// A real store must provide exactly these operations and NO update/delete:
//   head(tenantId)            -> { seq, hash }   ({ seq: 0, hash: GENESIS } for an empty chain)
//   append(entry)             -> { ok:true } | { ok:false, error:'stale-head' }   atomic compare-and-swap on (seq, prevHash)
//   list(tenantId, fromSeq?)  -> entries in seq order

export function createMemoryAuditStore() {
  const chains = new Map();
  const chain = t => { if (!chains.has(t)) chains.set(t, []); return chains.get(t); };
  const headOf = t => { const c = chain(t); return c.length ? { seq: c[c.length - 1].seq, hash: c[c.length - 1].entryHash } : { seq: 0, hash: GENESIS }; };
  return Object.freeze({
    async head(tenantId) { return headOf(String(tenantId)); },
    async append(entry) {
      const h = headOf(entry.tenantId);
      if (entry.seq !== h.seq + 1 || entry.prevHash !== h.hash) return { ok: false, error: 'stale-head' };
      chain(entry.tenantId).push(entry);
      return { ok: true };
    },
    async list(tenantId, fromSeq = 1) { return chain(String(tenantId)).filter(e => e.seq >= fromSeq); },
  });
}

// Builds and stores the next entry. A stale head (another writer got there first) is retried with the new head, so
// concurrent writers produce one linear chain and never a fork.
export async function appendAuditEvent({ store, key, event, maxRetries = 25, now, newId }) {
  const p = await prepareEvent(event, key, { now, newId });
  if (!p.ok) return p;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const head = await store.head(p.event.tenantId);
    const entry = await buildEntry(p.event, head, key);
    const r = await store.append(entry);
    if (r.ok) return { ok: true, entry };
    if (r.error !== 'stale-head') return { ok: false, error: r.error || 'store-error' };
  }
  return { ok: false, error: 'contention' };
}

// ---------------------------------------------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------------------------------------------

// entries: the chain in seq order. opts.tenantId is required. opts.startAfter = { seq, hash } verifies a slice that begins
// after a known-good entry. opts.expectedHead = { seq, hash } (kept outside the audit store) is what detects truncation.
export async function verifyAuditChain(entries, key, { tenantId, startAfter = { seq: 0, hash: GENESIS }, expectedHead } = {}) {
  if (!ID.test(String(tenantId ?? ''))) return { ok: false, error: 'tenantId-invalid', index: -1 };
  if (!Array.isArray(entries)) return { ok: false, error: 'entries-invalid', index: -1 };
  let prev = startAfter;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') return { ok: false, error: 'entry-invalid', index: i };
    if (e.tenantId !== tenantId) return { ok: false, error: 'tenant-mismatch', index: i };
    if (e.seq !== prev.seq + 1) return { ok: false, error: 'seq-gap', index: i };
    if (e.prevHash !== prev.hash) return { ok: false, error: 'prev-hash-mismatch', index: i };
    const { entryHash, ...body } = e;
    let expected;
    try { expected = await hashEntry(key, body); } catch { return { ok: false, error: 'entry-unhashable', index: i }; }
    if (!sameText(entryHash, expected)) return { ok: false, error: 'entry-hash-mismatch', index: i };
    prev = { seq: e.seq, hash: e.entryHash };
  }
  if (expectedHead && (expectedHead.seq !== prev.seq || !sameText(expectedHead.hash, prev.hash))) return { ok: false, error: 'truncated-or-head-mismatch', index: entries.length };
  return { ok: true, count: entries.length, head: prev };
}
