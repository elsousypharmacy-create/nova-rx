/* NOVA Rx — SEC-01 individual local accounts, sessions and trusted devices (MOCK auth: on-device only, no server, no real security boundary).
   Replaces a shared PIN: every person has their own name + password (salted SHA-256 via WebCrypto). Sessions expire and can be revoked;
   this device is in a trusted-device list; sensitive actions (export, account changes) need a fresh re-authentication.
   Works as a <script> (window.NovaAuth) and in Node (module.exports). */
(function (root) {
  'use strict';

  var ROLES = ['cashier', 'pharmacist', 'store', 'accountant', 'delivery', 'manager', 'owner'];
  var SESSION_MS = 8 * 3600 * 1000, REAUTH_MS = 5 * 60 * 1000, MIN_PW = 6;

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function rid(c) { return hex(c.getRandomValues(new Uint8Array(12))); }

  function create(opts) {
    var storage = opts.storage, c = opts.crypto, nowMs = opts.now || function () { return Date.now(); };
    var K = { acc: 'nova.auth.accounts', ses: 'nova.auth.sessions', dev: 'nova.auth.devices', me: 'nova.auth.deviceId', cur: 'nova.auth.current' };
    function read(k, d) { try { var v = JSON.parse(storage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
    function write(k, v) { storage.setItem(k, JSON.stringify(v)); }
    function hash(salt, pw) { return c.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw)).then(hex); }
    function norm(n) { return String(n == null ? '' : n).trim(); }
    function iso(ms) { return new Date(ms).toISOString(); }

    function deviceId() {
      var id = storage.getItem(K.me);
      if (!id) { id = 'dev-' + rid(c); storage.setItem(K.me, id); }
      return id;
    }
    function accounts() { return read(K.acc, []); }
    function pub(a) { return { id: a.id, name: a.name, role: a.role, createdAt: a.createdAt }; }
    function findByName(n) { var k = norm(n).toLowerCase(); return accounts().filter(function (a) { return a.name.toLowerCase() === k; })[0]; }
    function sessions() { return read(K.ses, []); }
    function activeSession() {
      var id = storage.getItem(K.cur); if (!id) return null;
      var s = sessions().filter(function (x) { return x.id === id; })[0];
      if (!s || s.revoked || Date.parse(s.expiresAt) <= nowMs()) { storage.removeItem(K.cur); return null; }
      return s;
    }
    function trust(label) {
      var id = deviceId(), list = read(K.dev, []), d = list.filter(function (x) { return x.id === id; })[0];
      if (d) d.lastSeen = iso(nowMs());
      else list.push({ id: id, label: norm(label) || 'This device', addedAt: iso(nowMs()), lastSeen: iso(nowMs()) });
      write(K.dev, list);
    }

    var api = {
      ROLES: ROLES,
      deviceId: deviceId,
      accounts: function () { return accounts().map(pub); },
      hasAccounts: function () { return accounts().length > 0; },
      /* First account becomes the owner. Later accounts need a fresh re-auth by an owner/manager. */
      createAccount: function (o) {
        var name = norm(o && o.name), role = o && o.role, pw = String((o && o.password) || '');
        if (!name || name.length > 60) fail('bad-name');
        if (pw.length < MIN_PW) fail('weak-password');
        var first = !accounts().length;
        if (!first) {
          if (!this.recentlyAuthenticated()) fail('reauth-required');
          var me = this.current(); if (!me || (me.role !== 'owner' && me.role !== 'manager')) fail('permission');
        } else role = 'owner';
        if (ROLES.indexOf(role) < 0) fail('bad-role');
        if (!first && this.current().role !== 'owner' && (role === 'owner' || role === 'manager')) fail('permission'); /* no escalation: only an owner grants owner/manager */
        if (findByName(name)) fail('duplicate-name');
        var salt = rid(c);
        return hash(salt, pw).then(function (h) {
          var list = accounts(), a = { id: 'acc-' + rid(c), name: name, role: role, salt: salt, hash: h, createdAt: iso(nowMs()) };
          list.push(a); write(K.acc, list); return pub(a);
        });
      },
      /* Mock sign-in: checks the salted hash, opens an expiring session and trusts this device. */
      signIn: function (name, password) {
        var a = findByName(name);
        return hash(a ? a.salt : 'x', String(password || '')).then(function (h) {
          if (!a || h !== a.hash) fail('bad-credentials');
          var t = nowMs(), s = { id: 'ses-' + rid(c), accountId: a.id, deviceId: deviceId(), startedAt: iso(t), expiresAt: iso(t + SESSION_MS), lastAuthAt: iso(t), revoked: false };
          var all = sessions().filter(function (x) { return !x.revoked && Date.parse(x.expiresAt) > t; }); all.push(s);
          write(K.ses, all); storage.setItem(K.cur, s.id); trust(); return s;
        });
      },
      signOut: function () { var id = storage.getItem(K.cur); if (id) { var all = sessions(); all.forEach(function (s) { if (s.id === id) s.revoked = true; }); write(K.ses, all); } storage.removeItem(K.cur); },
      current: function () {
        var s = activeSession(); if (!s) return null;
        var a = accounts().filter(function (x) { return x.id === s.accountId; })[0];
        return a ? { id: a.id, name: a.name, role: a.role, sessionId: s.id, expiresAt: s.expiresAt } : null;
      },
      /* Password check again for the current session; opens a short window for sensitive actions. */
      reauthenticate: function (password) {
        var s = activeSession(); if (!s) fail('no-session');
        var a = accounts().filter(function (x) { return x.id === s.accountId; })[0];
        return hash(a.salt, String(password || '')).then(function (h) {
          if (h !== a.hash) fail('bad-credentials');
          var all = sessions(); all.forEach(function (x) { if (x.id === s.id) x.lastAuthAt = iso(nowMs()); }); write(K.ses, all); return true;
        });
      },
      recentlyAuthenticated: function () { var s = activeSession(); return !!s && nowMs() - Date.parse(s.lastAuthAt) <= REAUTH_MS; },
      /* Gate for export and other sensitive changes. With no accounts yet there is nobody to authenticate: allowed (documented limit). */
      sensitiveAllowed: function () { return !this.hasAccounts() || this.recentlyAuthenticated(); },
      sessions: function () {
        var t = nowMs(), cur = storage.getItem(K.cur), names = {};
        accounts().forEach(function (a) { names[a.id] = a.name; });
        return sessions().filter(function (s) { return !s.revoked && Date.parse(s.expiresAt) > t; })
          .map(function (s) { return { id: s.id, account: names[s.accountId] || '?', deviceId: s.deviceId, startedAt: s.startedAt, expiresAt: s.expiresAt, current: s.id === cur }; });
      },
      revokeSession: function (id) {
        var all = sessions(), hit = false; all.forEach(function (s) { if (s.id === id && !s.revoked) { s.revoked = true; hit = true; } });
        if (!hit) fail('not-found'); write(K.ses, all); if (storage.getItem(K.cur) === id) storage.removeItem(K.cur); return true;
      },
      trustedDevices: function () { var me = deviceId(); return read(K.dev, []).map(function (d) { return { id: d.id, label: d.label, addedAt: d.addedAt, lastSeen: d.lastSeen, thisDevice: d.id === me }; }); },
      /* Removing a device also revokes every session opened on it. */
      removeDevice: function (id) {
        var list = read(K.dev, []), next = list.filter(function (d) { return d.id !== id; });
        if (next.length === list.length) fail('not-found');
        write(K.dev, next);
        var all = sessions(); all.forEach(function (s) { if (s.deviceId === id) s.revoked = true; }); write(K.ses, all);
        var cur = activeSession(); if (!cur) storage.removeItem(K.cur);
        return true;
      }
    };
    return api;
  }

  var api = { create: create, SESSION_MS: SESSION_MS, REAUTH_MS: REAUTH_MS, MIN_PASSWORD: MIN_PW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.NovaAuth = api;
    try { root.novaAuth = create({ storage: root.localStorage, crypto: root.crypto }); } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
