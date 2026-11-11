// SEC-04 audit log core. Pure module: no I/O, no storage, no network; Web Crypto only (Workers and Node 22).
// Not wired into the Worker. Rules: events are built from an allowlist, secrets and PII are masked before hashing,
// and entries are chained with an HMAC whose key lives outside the database, so a writer who can edit the table
// cannot recompute the chain. A single writer per tenant must serialise appends (see docs/erp/SEC-04_AUDIT_LOG.md).

export const GENESIS_HASH = '0'.repeat(64);
const MAX_DEPTH = 20;
const MAX_CANON_DEPTH = 64;
const MAX_METADATA_BYTES = 4096;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CATEGORIES = new Set(['AUTH_SESSION', 'ACCESS_CONTROL', 'FINANCIAL_LEDGER', 'INVENTORY_SENSITIVE', 'SYSTEM_CONFIG', 'CLINICAL_CONTROLLED']);
const OUTCOMES = new Set(['ALLOWED', 'DENIED', 'FAILED']);

// ---- canonical JSON ------------------------------------------------------------------------------------------------
// Keys sorted by UTF-16 code unit; strings and keys are emitted exactly as stored (no Unicode normalisation inside the hash,
// so different bytes never hash the same); finite numbers; no undefined / functions / dates / maps; depth capped; cycles refused.
export function canonicalJson(value) {
  const stack = new Set();
  const walk = (v, depth) => {
    if (depth > MAX_CANON_DEPTH) throw new Error('canonical-json-depth');
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean': return v ? 'true' : 'false';
      case 'number': if (!Number.isFinite(v)) throw new Error('canonical-json-number'); return JSON.stringify(v);
      case 'string': return JSON.stringify(v);
      case 'object': {
        if (stack.has(v)) throw new Error('canonical-json-cycle');
        stack.add(v);
        let out;
        if (Array.isArray(v)) out = '[' + v.map(x => walk(x, depth + 1)).join(',') + ']';
        else {
          const proto = Object.getPrototypeOf(v);
          if (proto !== Object.prototype && proto !== null) throw new Error('canonical-json-unsupported');
          out = '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + walk(v[k], depth + 1)).join(',') + '}';
        }
        stack.delete(v);
        return out;
      }
      default: throw new Error('canonical-json-unsupported');
    }
  };
  return walk(value, 0);
}

// ---- secret scrubbing and masking ----------------------------------------------------------------------------------
export function scrubInlineSecrets(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED JWT]')
    .replace(/\b(?:sk|pk|rk)[-_](?:live|test)[-_][A-Za-z0-9]{8,}/g, '[REDACTED KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi, '$1[REDACTED]@')
    .replace(/\b(api[_-]?key|secret|token|password|passwd|pin)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]');
}

// Over-redaction is the safe direction: any key CONTAINING one of these words is redacted. Short names (pin, otp, cvv, cvc)
// match only exactly or followed by code/number/hash/value/digits, so shipping, mapping and spinach are kept.
const REDACT_EXACT = new Set(['xnovapin', 'novapin', 'novaapipin', 'cardnumber', 'iban']);
const REDACT_CONTAINS = ['secret', 'password', 'passwd', 'token', 'credential', 'privatekey', 'apikey', 'cookie', 'authorization', 'session', 'signature', 'jwt'];
const REDACT_SHORT = ['pin', 'otp', 'cvv', 'cvc'];
const PARTIAL = new Set(['phone', 'phonenumber', 'mobile', 'mobilenumber', 'nationalid']);
const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const isRedactedKey = nk => REDACT_EXACT.has(nk) || REDACT_CONTAINS.some(w => nk.includes(w))
  || REDACT_SHORT.some(w => nk.startsWith(w) && /^(\d*|code|number|hash|value|digits)$/.test(nk.slice(w.length)));
const keepLast4 = v => { const s = String(v); return s.length <= 4 ? '*'.repeat(s.length) : '*'.repeat(s.length - 4) + s.slice(-4); };

// Deep copy with secrets redacted by key (denylist), PII partially masked, free text scrubbed, prototype keys dropped.
export function maskSensitiveFields(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (value === null) return null;
  switch (typeof value) {
    case 'string': return scrubInlineSecrets(value);
    case 'number': case 'boolean': return value;
    case 'bigint': return String(value);
    case 'object': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[UNSUPPORTED]' : value.toISOString();
      if (Array.isArray(value)) return value.map(x => (x === undefined ? null : maskSensitiveFields(x, depth + 1)));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return '[UNSUPPORTED]';
      const out = {};
      for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key) || value[key] === undefined) continue;
        const nk = normKey(key);
        if (isRedactedKey(nk)) out[key] = '[REDACTED]';
        else if (PARTIAL.has(nk)) out[key] = keepLast4(value[key]);
        else out[key] = maskSensitiveFields(value[key], depth + 1);
      }
      return out;
    }
    default: return '[UNSUPPORTED]';
  }
}

// ---- event construction (allowlist) --------------------------------------------------------------------------------
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const RES_TYPE = /^[a-z][a-z0-9_]*$/;
const RES_ID = /^[A-Za-z0-9_./-]{1,128}$/;
const ROLE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

// IPv4 -> a.b.c.0, IPv6 -> first three groups + '::'. Returns null when not an IP.
function maskIp(ip) {
  if (typeof ip !== 'string') return null;
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return v4.slice(1).every(o => Number(o) <= 255) ? `${Number(v4[1])}.${Number(v4[2])}.${Number(v4[3])}.0` : null;
  if (!/^[0-9a-fA-F:]+$/.test(ip) || (ip.match(/::/g) || []).length > 1) return null;
  const groups = ip.split(':');
  if (groups.length < 3 || groups.length > 8 || groups.some(g => g.length > 4)) return null;
  const lead = []; for (const g of groups) { if (g === '') break; lead.push(g.toLowerCase()); if (lead.length === 3) break; }
  return lead.join(':') + '::';
}

// Text is normalised to NFC ONCE here, so the stored bytes are the hashed bytes. Two keys that collide after NFC are refused.
function nfcDeep(value) {
  let collision = false;
  const walk = x => {
    if (typeof x === 'string') return x.normalize('NFC');
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) { const nk = k.normalize('NFC'); if (Object.prototype.hasOwnProperty.call(o, nk)) collision = true; o[nk] = walk(x[k]); } return o; }
    return x;
  };
  return { value: walk(value), collision };
}
const same = (a, b) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// -> {ok:true,event} | {ok:false,errors:[codes]}. Unknown input fields are dropped, never copied.
export function buildAuditEvent(input, opts = {}) {
  if (!isPlain(input)) return { ok: false, errors: ['event-invalid'] };
  const errors = [];
  const bad = code => { if (!errors.includes(code)) errors.push(code); };
  const actorIn = isPlain(input.actor) ? input.actor : {};
  const resIn = isPlain(input.resource) ? input.resource : {};

  if (typeof input.tenantId !== 'string' || !ID.test(input.tenantId)) bad('tenantId-invalid');
  if (input.branchId !== null && input.branchId !== undefined && (typeof input.branchId !== 'string' || !ID.test(input.branchId))) bad('branchId-invalid');
  if (typeof actorIn.userId !== 'string' || !ID.test(actorIn.userId)) bad('actor.userId-invalid');
  const roles = actorIn.roles === undefined ? [] : actorIn.roles;
  if (!Array.isArray(roles) || roles.length > 10 || roles.some(r => typeof r !== 'string' || !ROLE.test(r))) bad('actor.roles-invalid');
  if (actorIn.deviceId !== undefined && (typeof actorIn.deviceId !== 'string' || !ID.test(actorIn.deviceId))) bad('actor.deviceId-invalid');
  let ip;
  if (actorIn.ipAddress !== undefined) { ip = maskIp(actorIn.ipAddress) ?? undefined; } // an unusual format must not make an audit write fail
  if (typeof input.action !== 'string' || !ACTION.test(input.action)) bad('action-invalid');
  if (!CATEGORIES.has(input.category)) bad('category-invalid');
  if (!OUTCOMES.has(input.outcome)) bad('outcome-invalid');
  if (input.statusCode !== undefined && !(Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599)) bad('statusCode-invalid');
  if (typeof input.requestId !== 'string' || !ID.test(input.requestId)) bad('requestId-invalid');
  if (typeof resIn.type !== 'string' || !RES_TYPE.test(resIn.type) || typeof resIn.id !== 'string' || !RES_ID.test(resIn.id)) bad('resource-invalid');

  // The audit time is the server's: a caller-supplied timestamp is refused (it could back-date an event or be rewritten).
  if (input.timestamp !== undefined) bad('timestamp-not-allowed');
  let timestamp = '';
  { const d = (typeof opts.now === 'function' ? opts.now : () => new Date())(); if (d instanceof Date && !Number.isNaN(d.getTime())) timestamp = d.toISOString(); else bad('timestamp-invalid'); }

  let metadata = {};
  if (input.metadata !== undefined) {
    if (!isPlain(input.metadata)) bad('metadata-invalid');
    else { const n = nfcDeep(maskSensitiveFields(input.metadata)); metadata = n.value; if (n.collision) bad('key-collision'); try { if (new TextEncoder().encode(canonicalJson(metadata)).length > MAX_METADATA_BYTES) bad('metadata-too-large'); } catch { bad('metadata-invalid'); } }
  }

  // changes: always record WHICH fields changed; record values only for fields allowlisted for this resource type (and masked).
  let changedFields = []; let changes;
  if (input.changes !== undefined) {
    if (!isPlain(input.changes) || (input.changes.before !== undefined && !isPlain(input.changes.before)) || (input.changes.after !== undefined && !isPlain(input.changes.after))) bad('changes-invalid');
    else {
      const before = input.changes.before || {}; const after = input.changes.after || {};
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !DANGEROUS_KEYS.has(k) && /^[A-Za-z0-9_.-]{1,64}$/.test(k));
      changedFields = names.filter(k => !same(before[k], after[k])).sort();
      const allow = opts.changeAllowlist && Array.isArray(opts.changeAllowlist[resIn.type]) ? opts.changeAllowlist[resIn.type] : null;
      if (allow) {
        const pick = o => maskSensitiveFields(Object.fromEntries(allow.filter(k => Object.prototype.hasOwnProperty.call(o, k)).map(k => [k, o[k]])));
        const nb = nfcDeep(pick(before)); const na = nfcDeep(pick(after));
        if (nb.collision || na.collision) bad('key-collision');
        changes = { before: nb.value, after: na.value };
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  const event = {
    tenantId: input.tenantId, branchId: input.branchId ?? null,
    actor: { userId: actorIn.userId, roles: [...roles], ...(actorIn.deviceId !== undefined ? { deviceId: actorIn.deviceId } : {}), ...(ip !== undefined ? { ipAddress: ip } : {}) },
    action: input.action, category: input.category, outcome: input.outcome,
    resource: { type: resIn.type, id: resIn.id },
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    requestId: input.requestId,
    timestamp, changedFields, metadata,
    ...(changes ? { changes } : {}),
  };
  return { ok: true, event };
}

// ---- HMAC hash chain -----------------------------------------------------------------------------------------------
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)));

async function toKey(key) {
  if (key && typeof key === 'object' && key.type === 'secret' && key.algorithm?.name === 'HMAC') return key;
  let bytes;
  if (typeof key === 'string') bytes = new TextEncoder().encode(key);
  else if (key instanceof Uint8Array) bytes = key;
  else if (key instanceof ArrayBuffer) bytes = new Uint8Array(key);
  else throw new Error('audit-key-missing');
  if (bytes.length < 32) throw new Error('audit-key-too-short');
  return globalThis.crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const sign = async (key, record) => hex(await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalJson(record))));

export function createChainState(tenantId) {
  if (typeof tenantId !== 'string' || !ID.test(tenantId)) throw new Error('tenantId-invalid');
  return { tenantId, lastSeq: 0, lastHash: GENESIS_HASH };
}

// Pure: returns a NEW state, never mutates the one passed in. opts.expectedSeq lets the (single) writer prove it holds the head.
export async function appendAuditEvent(state, input, key, opts = {}) {
  const k = await toKey(key);
  if (opts.expectedSeq === undefined) return { ok: false, error: 'expectedSeq-required' };
  const built = buildAuditEvent(input, opts);
  if (!built.ok) return { ok: false, error: 'event-invalid', errors: built.errors };
  if (built.event.tenantId !== state.tenantId) return { ok: false, error: 'tenant-mismatch' };
  const seq = state.lastSeq + 1;
  if (opts.expectedSeq !== seq) return { ok: false, error: 'chain-fork' };
  const record = { ...built.event, seq, prevHash: state.lastHash };
  const entryHash = await sign(k, record);
  return { ok: true, entry: { ...record, entryHash }, state: { tenantId: state.tenantId, lastSeq: seq, lastHash: entryHash } };
}

// Checks every entry in order. opts.anchor = {seq, hash} of the last entry before a truncated (rotated) log.
export async function verifyAuditChain(entries, key, opts = {}) {
  const k = await toKey(key);
  if (!Array.isArray(entries)) return { ok: false, index: -1, reason: 'entries-invalid' };
  const anchor = opts.anchor || { seq: 0, hash: GENESIS_HASH };
  if (!Number.isInteger(anchor.seq) || anchor.seq < 0 || !/^[0-9a-f]{64}$/.test(anchor.hash)) return { ok: false, index: -1, reason: 'anchor-invalid' };
  let seq = anchor.seq; let prev = anchor.hash;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isPlain(e) || !Number.isInteger(e.seq) || typeof e.prevHash !== 'string' || typeof e.entryHash !== 'string' || !/^[0-9a-f]{64}$/.test(e.entryHash)) return { ok: false, index: i, reason: 'entry-invalid' };
    if (e.tenantId !== opts.tenantId) return { ok: false, index: i, reason: 'tenant-mismatch' };
    if (e.seq !== seq + 1) return { ok: false, index: i, reason: 'seq-gap' };
    if (e.prevHash !== prev) return { ok: false, index: i, reason: 'prev-hash-mismatch' };
    const { entryHash, ...record } = e;
    let good = false;
    try { good = await globalThis.crypto.subtle.verify('HMAC', k, unhex(entryHash), new TextEncoder().encode(canonicalJson(record))); } catch { return { ok: false, index: i, reason: 'entry-invalid' }; }
    if (!good) return { ok: false, index: i, reason: 'hash-mismatch' };
    seq = e.seq; prev = e.entryHash;
  }
  if (opts.expectedHead && (opts.expectedHead.seq !== seq || opts.expectedHead.hash !== prev)) return { ok: false, index: entries.length - 1, reason: 'head-mismatch' };
  return { ok: true, count: entries.length, head: { seq, hash: prev } };
}
