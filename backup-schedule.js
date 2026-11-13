/* NOVA Rx — OFF-04 scheduled encrypted local backup + periodic restore drill (no DOM, no network, no backend).
   Wraps the existing sales backup JSON (index.html exportBackup/parseBackup) in AES-256-GCM (PBKDF2-SHA256 key from a passphrase).
   The drill decrypts the newest snapshot, validates it with the SAME parser used by import, and measures RPO/RTO. It never writes live data.
   Download of a snapshot is gated: needs the data.export permission AND a fresh re-auth (sensitiveAllowed) — decided by the caller-supplied gate.
   Works as a <script> (window.NovaBackup) and in Node (module.exports). */
(function (root) {
  'use strict';
  var RPO_MS = 15 * 60 * 1000, RTO_MS = 60 * 60 * 1000, KEEP = 5, ITER = 150000;
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function cry() { var c = root.crypto || (typeof require === 'function' && require('node:crypto').webcrypto); if (!c || !c.subtle) fail('no-webcrypto'); return c; }
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var r = atob(s), b = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; }
  function key(pass, salt, iter) {
    var c = cry();
    return c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (m) {
      return c.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function encrypt(text, pass, iter) {
    if (typeof pass !== 'string' || pass.length < 8) return Promise.reject(Object.assign(new Error('weak-passphrase'), { code: 'weak-passphrase' }));
    iter = iter || ITER; var c = cry(), salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return key(pass, salt, iter).then(function (k) { return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(text)); })
      .then(function (ct) { return { format: 'nova-rx-encrypted-backup', version: 1, iter: iter, salt: b64(salt), iv: b64(iv), data: b64(ct) }; });
  }
  function decrypt(env, pass) {
    if (!env || env.format !== 'nova-rx-encrypted-backup' || env.version !== 1) return Promise.reject(Object.assign(new Error('wrong-format'), { code: 'wrong-format' }));
    return key(pass, unb64(env.salt), env.iter).then(function (k) { return cry().subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, k, unb64(env.data)); })
      .then(function (pt) { return new TextDecoder().decode(pt); }, function () { fail('bad-passphrase-or-tampered'); });
  }

  /* opts: { storage, key, now(): ms, intervalMs: 600000 (<= RPO), passphrase(): string, exportText(): string, parse(text): {ok,...} } */
  function createScheduler(o) {
    var KEYN = o.key || 'nova.backups', now = o.now || Date.now, interval = o.intervalMs || 10 * 60 * 1000;
    if (interval > RPO_MS) fail('interval-exceeds-rpo');
    function list() { var r = o.storage.getItem(KEYN); if (!r) return []; try { var a = JSON.parse(r); if (Array.isArray(a)) return a; } catch (e) {} fail('backups-corrupt'); }
    function put(a) { try { o.storage.setItem(KEYN, JSON.stringify(a)); } catch (e) { fail('backup-write-failed'); } }
    function last() { var a = list(); return a.length ? a[a.length - 1] : null; }
    function due() { var l = last(); return !l || now() - l.at >= interval; }
    function runBackup() {
      var at = now();
      return encrypt(o.exportText(), o.passphrase()).then(function (env) { var a = list(); a.push({ at: at, env: env }); put(a.slice(-KEEP)); return { at: at, count: Math.min(KEEP, a.length) }; });
    }
    function tick() { return due() ? runBackup() : Promise.resolve(null); }
    /* Restore drill: read-only. rpoMs = age of the newest snapshot (data you would lose now); rtoMs = measured decrypt+validate time. */
    function drill() {
      var l = last(); if (!l) return Promise.resolve({ ok: false, error: 'no-backup' });
      var t0 = now();
      return decrypt(l.env, o.passphrase()).then(function (txt) {
        var p = o.parse(txt), t1 = now();
        var rpo = t0 - l.at, rto = t1 - t0;
        if (!p || !p.ok) return { ok: false, error: 'invalid-backup', rpoMs: rpo, rtoMs: rto };
        return { ok: true, rpoMs: rpo, rtoMs: rto, rpoOk: rpo <= RPO_MS, rtoOk: rto <= RTO_MS, sales: p.newSales ? p.newSales.length + p.skippedSales : undefined };
      }, function (e) { return { ok: false, error: e.code || 'decrypt-failed' }; });
    }
    /* Owner download: both checks must pass; otherwise nothing is returned. gate: { allow(action): bool, reauthed(): bool } */
    function download(gate) {
      if (!gate || !gate.allow || !gate.allow('data.export')) fail('permission');
      if (!gate.reauthed || !gate.reauthed()) fail('reauth-required');
      var l = last(); if (!l) fail('no-backup');
      return JSON.stringify(l.env);
    }
    return { due: due, runBackup: runBackup, tick: tick, drill: drill, download: download, last: last, list: list };
  }
  var api = { encrypt: encrypt, decrypt: decrypt, createScheduler: createScheduler, RPO_MS: RPO_MS, RTO_MS: RTO_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaBackup = api;
})(typeof window !== 'undefined' ? window : globalThis);
