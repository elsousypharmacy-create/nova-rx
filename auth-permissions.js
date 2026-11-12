/* NOVA Rx — SEC-02 permissions matrix (UI/local only: a client-side check on this device, NOT a security boundary; server enforcement is out of scope while the backend is frozen).
   Roles x actions, deny by default. Denied actions are logged on this device. With no accounts yet nobody can be authenticated: allowed (same documented limit as SEC-01).
   Works as a <script> (window.NovaPerms / window.novaPerms) and in Node (module.exports). */
(function (root) {
  'use strict';

  var ROLES = ['owner', 'manager', 'pharmacist', 'cashier', 'store', 'accountant', 'delivery'];
  var ACTIONS = ['sale.create', 'sale.return', 'sale.cancel', 'data.export', 'data.import', 'stock.adjust', 'prices.edit', 'reports.view', 'accounts.manage', 'purchases.manage', 'delivery.update'];
  var MATRIX = {
    owner: ACTIONS.slice(),
    // managers add staff, but auth-local stops them granting owner/manager
    manager: ['sale.create', 'sale.return', 'sale.cancel', 'data.export', 'data.import', 'stock.adjust', 'prices.edit', 'reports.view', 'accounts.manage', 'purchases.manage', 'delivery.update'],
    pharmacist: ['sale.create', 'sale.return', 'stock.adjust', 'reports.view'],
    cashier: ['sale.create', 'sale.return'],
    store: ['stock.adjust', 'purchases.manage'],
    accountant: ['data.export', 'reports.view'],
    delivery: ['delivery.update']
  };
  Object.freeze(ROLES); Object.freeze(ACTIONS);
  Object.keys(MATRIX).forEach(function (r) { Object.freeze(MATRIX[r]); }); Object.freeze(MATRIX);

  var LOG_KEY = 'nova.perm.denied', LOG_MAX = 200;

  function create(opts) {
    var storage = opts.storage, who = opts.current || function () { return null; }, hasAccounts = opts.hasAccounts || function () { return false; };
    var nowMs = opts.now || function () { return Date.now(); };
    function readLog() { try { var v = JSON.parse(storage.getItem(LOG_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function logDenied(action, me, why) {
      var l = readLog(); l.push({ at: new Date(nowMs()).toISOString(), action: String(action), account: me ? me.name : null, role: me ? me.role : null, why: why });
      try { storage.setItem(LOG_KEY, JSON.stringify(l.slice(-LOG_MAX))); } catch (e) {}
    }
    /* Role comes only from the signed-in session record, never from a caller argument, so a screen cannot ask on behalf of a stronger role. */
    function decide(action) {
      if (ACTIONS.indexOf(action) < 0) return { ok: false, why: 'unknown-action' };
      if (!hasAccounts()) return { ok: true, why: 'no-accounts' };
      var me = who(); if (!me) return { ok: false, why: 'signed-out' };
      var allowed = MATRIX[me.role]; if (!allowed) return { ok: false, why: 'unknown-role' };
      return allowed.indexOf(action) >= 0 ? { ok: true, why: 'role' } : { ok: false, why: 'role-denied' };
    }
    return {
      /* Pure query, no log. */
      can: function (action) { return decide(action).ok; },
      /* Use at the moment of the action: logs a denial and returns false. */
      require: function (action) { var d = decide(action); if (!d.ok) logDenied(action, who(), d.why); return d.ok; },
      denied: function () { return readLog(); },
      clearDenied: function () { storage.removeItem(LOG_KEY); },
      matrix: function () { return ROLES.map(function (r) { return { role: r, actions: MATRIX[r].slice() }; }); }
    };
  }

  var api = { create: create, ROLES: ROLES, ACTIONS: ACTIONS, MATRIX: MATRIX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.NovaPerms = api;
    root.novaPerms = null;
    function boot() { try { var A = root.novaAuth; if (A) root.novaPerms = create({ storage: root.localStorage, current: function () { return A.current(); }, hasAccounts: function () { return A.hasAccounts(); } }); } catch (e) {} }
    boot(); if (!root.novaPerms) root.addEventListener('DOMContentLoaded', boot);
  }
})(typeof window !== 'undefined' ? window : globalThis);
