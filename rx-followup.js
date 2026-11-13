/* NOVA Rx — CRM-04 prescriptions and follow-up (pure logic, no DOM, no network, frontend/local only).
   Private prescription file records attached to a visit and optionally to one visit item, a per-customer consent state,
   opt-in reminder flags (default OFF) and an append-only access audit. Only METADATA + an opaque local reference are stored here
   (the file bytes live wherever the caller keeps them). No therapy decisions, no automatic refill, no automatic messages:
   dueReminders() only lists what a human opted into so staff can follow up manually.
   Works as <script> (window.NovaRxFollowup) and in Node (module.exports). */
(function (root) {
  'use strict';
  var STATES = ['unknown', 'granted', 'withdrawn'];

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }

  /* opts: { now(): ms, canAccess(actor, action): boolean (default allow any non-empty actor) } */
  function createRxStore(storage, key, opts) {
    opts = opts || {};
    var now = opts.now || Date.now;
    function load() {
      var r = storage.getItem(key);
      if (!r) return { seq: 0, consent: {}, files: [], audit: [] };
      try { var d = JSON.parse(r); if (d && Array.isArray(d.files) && Array.isArray(d.audit) && d.consent) return d; } catch (e) {}
      fail('rx-corrupt');
    }
    function save(d) { try { storage.setItem(key, JSON.stringify(d)); } catch (e) { fail('rx-write-failed'); } }
    function allow(actor, action) {
      str(actor, 'actor-required');
      if (opts.canAccess && !opts.canAccess(actor, action)) fail('forbidden');
    }
    function log(d, actor, action, target, customerId) {
      d.audit.push({ at: now(), actor: actor, action: action, target: target || null, customerId: customerId || null });
    }

    function setConsent(customerId, state, actor) {
      customerId = str(customerId, 'customer-required'); allow(actor, 'consent');
      if (STATES.indexOf(state) < 0) fail('bad-consent-state');
      var d = load();
      d.consent[customerId] = { state: state, at: now(), by: actor };
      if (state !== 'granted') d.files.forEach(function (f) { if (f.customerId === customerId) f.reminder = { enabled: false, dueAt: null }; });
      log(d, actor, 'consent:' + state, null, customerId);
      save(d); return copy(d.consent[customerId]);
    }
    function consentState(customerId) { var c = load().consent[customerId]; return c ? c.state : 'unknown'; }
    function granted(d, customerId) { return (d.consent[customerId] || {}).state === 'granted'; }

    /* f: { customerId, visitId, itemId?, name, mime, size, ref, actor } — refused unless consent is granted. */
    function attachFile(f) {
      f = f || {}; allow(f.actor, 'attach');
      var customerId = str(f.customerId, 'customer-required'), visitId = str(f.visitId, 'visit-required');
      var name = str(f.name, 'name-required'), ref = str(f.ref, 'ref-required');
      if (typeof f.size !== 'number' || !isFinite(f.size) || f.size < 0) fail('bad-size');
      var d = load();
      if (!granted(d, customerId)) fail('consent-required');
      d.seq += 1;
      var rec = { id: 'RX' + d.seq, customerId: customerId, visitId: visitId, itemId: f.itemId ? String(f.itemId) : null,
        name: name, mime: f.mime ? String(f.mime) : 'application/octet-stream', size: f.size, ref: ref,
        createdAt: now(), createdBy: f.actor, reminder: { enabled: false, dueAt: null } };
      d.files.push(rec); log(d, f.actor, 'attach', rec.id, customerId); save(d);
      return copy(rec);
    }
    function find(d, id) { for (var i = 0; i < d.files.length; i++) if (d.files[i].id === id) return d.files[i]; fail('file-not-found'); }

    /* Reading a file (its opaque ref) needs a stated purpose and is always audited; metadata listing is audited too. */
    function openFile(id, actor, purpose) {
      allow(actor, 'read'); purpose = str(purpose, 'purpose-required');
      var d = load(), f = find(d, id);
      log(d, actor, 'open:' + purpose, f.id, f.customerId); save(d);
      return copy(f);
    }
    function listForVisit(visitId, actor, itemId) {
      allow(actor, 'read'); var d = load();
      var r = d.files.filter(function (f) { return f.visitId === visitId && (itemId == null || f.itemId === String(itemId)); });
      log(d, actor, 'list', visitId, null); save(d);
      return r.map(function (f) { var c = copy(f); delete c.ref; return c; });
    }
    /* Opt-in reminder flag: needs granted consent and a future due date. Never sends anything. */
    function setReminder(id, enabled, dueAt, actor) {
      allow(actor, 'reminder'); var d = load(), f = find(d, id);
      if (enabled) {
        if (!granted(d, f.customerId)) fail('consent-required');
        if (typeof dueAt !== 'number' || !isFinite(dueAt) || dueAt <= now()) fail('bad-due-date');
        f.reminder = { enabled: true, dueAt: dueAt };
      } else f.reminder = { enabled: false, dueAt: null };
      log(d, actor, enabled ? 'reminder:on' : 'reminder:off', f.id, f.customerId); save(d);
      return copy(f.reminder);
    }
    /* Manual follow-up list only: opted-in, due, consent still granted. */
    function dueReminders(at) {
      var d = load(); at = at == null ? now() : at;
      return d.files.filter(function (f) { return f.reminder.enabled && f.reminder.dueAt <= at && granted(d, f.customerId); })
        .map(function (f) { return { fileId: f.id, customerId: f.customerId, visitId: f.visitId, itemId: f.itemId, dueAt: f.reminder.dueAt }; });
    }
    function auditLog(actor) { allow(actor, 'audit'); return copy(load().audit); }

    return { setConsent: setConsent, consentState: consentState, attachFile: attachFile, openFile: openFile,
      listForVisit: listForVisit, setReminder: setReminder, dueReminders: dueReminders, auditLog: auditLog };
  }

  var api = { createRxStore: createRxStore, CONSENT_STATES: STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaRxFollowup = api;
})(typeof window !== 'undefined' ? window : globalThis);
