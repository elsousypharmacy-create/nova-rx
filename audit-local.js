/* NOVA Rx — SEC-04 local append-only audit log (pure logic, no DOM, no network, frontend/local only).
   Each row: seq, at, actor, action, category, entity, before, after, reason, requestId, prev, hash (tamper-evident chain).
   Append only: no update/delete API; FINANCIAL rows can never be removed (even by prune). Secrets/PII fields are redacted
   before storage. Works as <script> (window.NovaAudit) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var FINANCIAL = ['financial', 'sale', 'payment', 'shift', 'ledger', 'refund', 'credit'];
  var SENSITIVE = /(pass(word|wd)?|pin|token|secret|api[-_]?key|authorization|cookie|otp|cvv|card[-_]?number|iban|private[-_]?key|session)/i;
  var KEY_PIN = /^pin$|[-_]pin$|^pin[-_]|[a-z]Pin$/i;
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  function sensitiveKey(k) { return /pin/i.test(k) ? KEY_PIN.test(k) : SENSITIVE.test(k); }
  function scrub(s) {
    return s.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/\b(password|passwd|token|secret|api[-_]?key|pin|otp)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  }
  function redact(v, depth) {
    depth = depth || 0;
    if (typeof v === 'string') return scrub(v);
    if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'undefined' ? null : v;
    if (depth > 8) return '[TRUNCATED]';
    if (Array.isArray(v)) return v.map(function (x) { return redact(x, depth + 1); });
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = sensitiveKey(k) ? '[REDACTED]' : redact(v[k], depth + 1); });
    return o;
  }
  function hash(s) { // FNV-1a x2 (non-cryptographic; tamper-evidence against accidental edits only)
    var a = 0x811c9dc5, b = 0x01000193 ^ 0xabcdef;
    for (var i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 16777619) >>> 0; b = (Math.imul(b ^ s.charCodeAt(i), 2246822519) + 374761393) >>> 0; }
    return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
  }
  function body(r) { return JSON.stringify([r.seq, r.at, r.actor, r.action, r.category, r.entity, r.before, r.after, r.reason, r.requestId, r.prev]); }

  function createAudit(storage, key, opts) {
    key = key || 'nova.audit';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { rows: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('audit-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.rows)) fail('audit-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('audit-write-failed'); } }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    function append(input) {
      if (!input || typeof input !== 'object') fail('bad-entry');
      var s = load(), last = s.rows[s.rows.length - 1];
      var row = {
        seq: s.rows.length + 1, at: now(),
        actor: str(input.actor, 'actor-required'), action: str(input.action, 'action-required'),
        category: typeof input.category === 'string' && input.category.trim() ? input.category.trim().toLowerCase() : 'general',
        entity: input.entity == null ? null : redact(input.entity),
        before: input.before === undefined ? null : redact(input.before),
        after: input.after === undefined ? null : redact(input.after),
        reason: scrub(str(input.reason, 'reason-required')),
        requestId: str(input.requestId, 'request-id-required'),
        prev: last ? last.hash : '0'
      };
      row.financial = FINANCIAL.indexOf(row.category) >= 0;
      row.hash = hash(body(row));
      s.rows.push(row);
      save(s);
      return copy(row);
    }
    function list(filter) {
      var rows = load().rows;
      if (filter) rows = rows.filter(function (r) { return Object.keys(filter).every(function (k) { return r[k] === filter[k]; }); });
      return copy(rows);
    }
    function verify() {
      var rows = load().rows, prev = '0';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.seq !== i + 1 || r.prev !== prev || r.hash !== hash(body(r))) return { ok: false, brokenAt: i + 1 };
        prev = r.hash;
      }
      return { ok: true, count: rows.length };
    }
    // No deletion at all: remove/prune always throw, so financial rows can never be deleted.
    function prune() { fail('audit-append-only'); }
    function remove() { fail('audit-append-only'); }
    return { append: append, list: list, verify: verify, remove: remove, prune: prune };
  }

  var api = { createAudit: createAudit, redact: redact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaAudit = api;
})(typeof window !== 'undefined' ? window : globalThis);
