/* NOVA Rx — CRM-01 local customer directory (pure logic, no DOM, no network, frontend/local only).
   Normalized phone (Egyptian + international E.164, Arabic/Persian digits), explicit opt-in contact consent
   with append-only history, customer preferences, duplicate detection + reviewed merge with immutable audit log,
   and permission-gated customer account statements (deny by default; logs every allowed/denied access).
   Works as a <script> (window.NovaCustomers) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  var CONSENT_CHANNELS = Object.freeze(['sms', 'whatsapp', 'call', 'marketing']);
  var LANGUAGES = Object.freeze(['ar', 'en']);
  var PREFERRED_CHANNELS = Object.freeze(['none', 'whatsapp', 'sms', 'call']);
  var RECEIPT_FORMATS = Object.freeze(['print', 'whatsapp', 'sms', 'none']);
  var ALLOWED_STATEMENT_ROLES = Object.freeze(['owner', 'manager', 'accountant', 'pharmacist']);

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.freeze(o);
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    return o;
  }

  /* Convert Arabic-Indic (٠-٩) and Extended Arabic-Indic / Persian (۰-۹) digits to ASCII 0-9. */
  function normalizeDigits(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
  }

  /* Normalize phone to canonical E.164 (+20... for Egypt or +<country><subscriber>).
     Rejects invalid numbers with code = 'bad-phone'. */
  function normalizePhone(raw) {
    if (typeof raw !== 'string') fail('bad-phone');
    var cleaned = normalizeDigits(raw)
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/[\s\-().\/]+/g, '');
    if (!cleaned) fail('bad-phone');

    var hasPlus = false;
    if (cleaned.charAt(0) === '+') {
      hasPlus = true;
      cleaned = cleaned.slice(1);
    } else if (cleaned.slice(0, 2) === '00') {
      hasPlus = true;
      cleaned = cleaned.slice(2);
    }
    if (!/^\d+$/.test(cleaned)) fail('bad-phone');

    // Egyptian mobile / landline handling
    if (cleaned.slice(0, 3) === '200' && cleaned.length >= 12) {
      cleaned = '20' + cleaned.slice(3);
      hasPlus = true;
    }
    if (!hasPlus) {
      // Local Egyptian mobile: 010/011/012/015 + 8 digits (11 digits)
      if (/^01[0125]\d{8}$/.test(cleaned)) return '+20' + cleaned.slice(1);
      // Local Egyptian mobile missing leading 0: 10/11/12/15 + 8 digits (10 digits)
      if (/^1[0125]\d{8}$/.test(cleaned)) return '+20' + cleaned;
      // Local Egyptian landline: 02..09 + 7 or 8 digits
      if (/^0[2-9]\d{7,8}$/.test(cleaned)) return '+20' + cleaned.slice(1);
      // Bare 20 + valid Egyptian mobile or landline
      if (/^20(1[0125]\d{8}|[2-9]\d{7,8})$/.test(cleaned)) return '+' + cleaned;
      fail('bad-phone');
    }

    // With + or 00 prefix: if country code is 20 (Egypt), enforce valid Egyptian subscriber length/prefix
    if (cleaned.slice(0, 2) === '20') {
      if (/^20(1[0125]\d{8}|[2-9]\d{7,8})$/.test(cleaned)) return '+' + cleaned;
      fail('bad-phone');
    }

    // Other international E.164 numbers: country code starts 1-9, total length 8..15 digits
    if (/^[1-9]\d{7,14}$/.test(cleaned)) return '+' + cleaned;
    fail('bad-phone');
  }

  /* Normalize Arabic & Latin customer names for duplicate detection and search. */
  function normalizeName(raw) {
    if (typeof raw !== 'string') return '';
    return normalizeDigits(raw)
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .toLowerCase()
      .replace(/[^\u0621-\u064A0-9a-z]+/g, ' ')
      .trim();
  }

  function defaultConsent() {
    return { sms: false, whatsapp: false, call: false, marketing: false, updatedAt: null, updatedBy: null, source: null };
  }

  function defaultPreferences() {
    return {
      language: 'ar',
      preferredChannel: 'none',
      receiptFormat: 'print',
      deliveryAddress: '',
      deliveryNotes: '',
      chronicRefillReminder: false,
      notes: ''
    };
  }

  function validatePreferences(base, patch) {
    var out = copy(base || defaultPreferences());
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (k === 'language') {
        if (LANGUAGES.indexOf(v) < 0) fail('bad-preference');
        out.language = v;
      } else if (k === 'preferredChannel') {
        if (PREFERRED_CHANNELS.indexOf(v) < 0) fail('bad-preference');
        out.preferredChannel = v;
      } else if (k === 'receiptFormat') {
        if (RECEIPT_FORMATS.indexOf(v) < 0) fail('bad-preference');
        out.receiptFormat = v;
      } else if (k === 'deliveryAddress' || k === 'deliveryNotes' || k === 'notes') {
        if (typeof v !== 'string') fail('bad-preference');
        out[k] = v.trim();
      } else if (k === 'chronicRefillReminder') {
        if (typeof v !== 'boolean') fail('bad-preference');
        out.chronicRefillReminder = v;
      } else {
        fail('bad-preference');
      }
    });
    return out;
  }

  function applyConsentPatch(currentConsent, history, patch, meta, nowMs) {
    var out = copy(currentConsent || defaultConsent());
    if (!patch || typeof patch !== 'object') return out;
    meta = meta || {};
    var by = typeof meta.by === 'string' && meta.by.trim() ? meta.by.trim() : (typeof patch.updatedBy === 'string' && patch.updatedBy.trim() ? patch.updatedBy.trim() : 'system');
    var source = typeof meta.source === 'string' && meta.source.trim() ? meta.source.trim() : (typeof patch.source === 'string' && patch.source.trim() ? patch.source.trim() : 'local');
    var note = typeof meta.note === 'string' ? meta.note.trim() : '';
    var at = meta.at == null ? nowMs : meta.at;
    var changed = false;

    Object.keys(patch).forEach(function (k) {
      if (k === 'updatedBy' || k === 'source' || k === 'updatedAt' || k === 'note') return;
      if (CONSENT_CHANNELS.indexOf(k) < 0) fail('bad-consent-channel');
      if (typeof patch[k] !== 'boolean') fail('bad-consent-value');
      out[k] = patch[k];
      changed = true;
      history.push({ at: at, by: by, channel: k, allowed: patch[k], source: source, note: note });
    });

    if (changed) {
      out.updatedAt = at;
      out.updatedBy = by;
      out.source = source;
    }
    return out;
  }

  /* opts: {
       now(): ms,
       creditLedger: optional NovaCredit instance,
       salesLedger / sales: optional sales array or { list() },
       perms: optional NovaPerms instance,
       currentUser(): optional () => { name, role },
       canViewStatement(ctx): optional custom authorizer,
       statementRoles: optional array of roles allowed to view statements
     } */
  function createCustomerDirectory(storage, key, opts) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') fail('storage-required');
    key = key || 'nova.customers';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var allowedRoles = Array.isArray(opts.statementRoles) ? opts.statementRoles.slice() : ALLOWED_STATEMENT_ROLES;

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { seq: 0, mergeSeq: 0, customers: {}, aliases: {}, mergeLog: [], statementAccessLog: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('directory-corrupt'); }
      if (!s || typeof s !== 'object' || typeof s.customers !== 'object' || !s.customers ||
          typeof s.aliases !== 'object' || !s.aliases || !Array.isArray(s.mergeLog) || !Array.isArray(s.statementAccessLog)) {
        fail('directory-corrupt');
      }
      return s;
    }

    function save(s) {
      try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('directory-write-failed'); }
    }

    function resolveInState(s, id) {
      if (typeof id !== 'string' || !id.trim()) fail('missing-customer');
      var cur = id.trim(), guard = 0;
      while (s.aliases[cur] && guard < 32) {
        cur = s.aliases[cur];
        guard += 1;
      }
      return cur;
    }

    function requireCustomer(s, id) {
      var cid = resolveInState(s, id);
      var c = s.customers[cid];
      if (!c) fail('unknown-customer');
      return c;
    }

    function normalizeAltPhones(list, primaryPhone) {
      if (!list) return [];
      if (!Array.isArray(list)) fail('bad-phone');
      var seen = {};
      if (primaryPhone) seen[primaryPhone] = 1;
      var out = [];
      list.forEach(function (p) {
        var np = normalizePhone(p);
        if (!seen[np]) { seen[np] = 1; out.push(np); }
      });
      return out;
    }

    function allPhonesOf(c) {
      return [c.phone].concat(c.altPhones || []);
    }

    function phoneOwner(s, normPhone, ignoreCustomerId) {
      var ids = Object.keys(s.customers);
      for (var i = 0; i < ids.length; i++) {
        var c = s.customers[ids[i]];
        if (c.id === ignoreCustomerId) continue;
        if (allPhonesOf(c).indexOf(normPhone) >= 0) return c;
      }
      return null;
    }

    function create(input) {
      if (!input || typeof input !== 'object') fail('bad-customer');
      var name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) fail('missing-name');
      var normName = normalizeName(name);
      if (!normName) fail('missing-name');

      var phone = normalizePhone(input.phone);
      var altPhones = normalizeAltPhones(input.altPhones, phone);
      var s = load();

      if (input.id != null) {
        if (typeof input.id !== 'string' || !input.id.trim()) fail('bad-customer-id');
        var customId = input.id.trim();
        if (s.customers[customId] || s.aliases[customId]) fail('duplicate-id');
      }

      if (!input.allowDuplicatePhone) {
        var allNewPhones = [phone].concat(altPhones);
        for (var i = 0; i < allNewPhones.length; i++) {
          if (phoneOwner(s, allNewPhones[i], null)) fail('duplicate-phone');
        }
      }

      s.seq += 1;
      var id = input.id ? input.id.trim() : ('cust-' + s.seq);
      var t = input.at == null ? now() : input.at;
      var history = [];
      var consent = applyConsentPatch(defaultConsent(), history, input.consent, {
        at: t,
        by: input.createdBy || (input.consent && input.consent.updatedBy) || 'system',
        source: (input.consent && input.consent.source) || 'create'
      }, t);
      var preferences = validatePreferences(defaultPreferences(), input.preferences);
      var nationalId = typeof input.nationalId === 'string' ? normalizeDigits(input.nationalId).trim() : '';
      var tags = Array.isArray(input.tags)
        ? input.tags.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); })
        : [];

      var rec = {
        id: id,
        name: name,
        phone: phone,
        altPhones: altPhones,
        nationalId: nationalId,
        tags: tags,
        consent: consent,
        consentHistory: history,
        preferences: preferences,
        createdAt: t,
        updatedAt: t
      };
      s.customers[id] = rec;
      save(s);
      return copy(rec);
    }

    function update(customerId, patch, meta) {
      if (!patch || typeof patch !== 'object') fail('bad-customer');
      var s = load();
      var c = requireCustomer(s, customerId);
      var t = (meta && meta.at != null) ? meta.at : now();

      if (patch.name !== undefined) {
        var name = typeof patch.name === 'string' ? patch.name.trim() : '';
        if (!name || !normalizeName(name)) fail('missing-name');
        c.name = name;
      }
      if (patch.phone !== undefined) {
        var newPhone = normalizePhone(patch.phone);
        if (!patch.allowDuplicatePhone && phoneOwner(s, newPhone, c.id)) fail('duplicate-phone');
        c.phone = newPhone;
        c.altPhones = (c.altPhones || []).filter(function (p) { return p !== newPhone; });
      }
      if (patch.altPhones !== undefined) {
        var nextAlt = normalizeAltPhones(patch.altPhones, c.phone);
        if (!patch.allowDuplicatePhone) {
          for (var i = 0; i < nextAlt.length; i++) {
            if (phoneOwner(s, nextAlt[i], c.id)) fail('duplicate-phone');
          }
        }
        c.altPhones = nextAlt;
      }
      if (patch.nationalId !== undefined) {
        if (typeof patch.nationalId !== 'string') fail('bad-customer');
        c.nationalId = normalizeDigits(patch.nationalId).trim();
      }
      if (patch.tags !== undefined) {
        if (!Array.isArray(patch.tags)) fail('bad-customer');
        c.tags = patch.tags.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); });
      }
      if (patch.consent !== undefined) {
        c.consent = applyConsentPatch(c.consent, c.consentHistory, patch.consent, meta, t);
      }
      if (patch.preferences !== undefined) {
        c.preferences = validatePreferences(c.preferences, patch.preferences);
      }
      c.updatedAt = t;
      save(s);
      return copy(c);
    }

    function setConsent(customerId, consentPatch, meta) {
      if (!consentPatch || typeof consentPatch !== 'object') fail('bad-consent-value');
      return update(customerId, { consent: consentPatch }, meta);
    }

    function setPreferences(customerId, prefsPatch, meta) {
      if (!prefsPatch || typeof prefsPatch !== 'object') fail('bad-preference');
      return update(customerId, { preferences: prefsPatch }, meta);
    }

    function canContact(customerId, channel) {
      if (CONSENT_CHANNELS.indexOf(channel) < 0) fail('bad-consent-channel');
      var s = load();
      var c = requireCustomer(s, customerId);
      return Boolean(c.consent && c.consent[channel] === true);
    }

    /* Returns the customer's preferred contact channel only if they have active consent for it; otherwise 'none'. */
    function effectiveContactChannel(customerId) {
      var s = load();
      var c = requireCustomer(s, customerId);
      var pref = c.preferences && c.preferences.preferredChannel ? c.preferences.preferredChannel : 'none';
      if (pref === 'none') return 'none';
      return (c.consent && c.consent[pref] === true) ? pref : 'none';
    }

    function resolveId(customerId) {
      var s = load();
      var cid = resolveInState(s, customerId);
      if (!s.customers[cid]) fail('unknown-customer');
      return cid;
    }

    function get(customerId) {
      var s = load();
      return copy(requireCustomer(s, customerId));
    }

    function findByPhone(rawPhone) {
      var norm = normalizePhone(rawPhone);
      var s = load();
      var owner = phoneOwner(s, norm, null);
      return owner ? copy(owner) : null;
    }

    function list() {
      var s = load();
      return Object.keys(s.customers).map(function (id) { return copy(s.customers[id]); });
    }

    function search(query) {
      var s = load();
      var qRaw = String(query == null ? '' : query).trim();
      if (!qRaw) return list();
      var qDigits = normalizeDigits(qRaw).replace(/\D+/g, '');
      var qName = normalizeName(qRaw);
      return Object.keys(s.customers).map(function (id) { return s.customers[id]; }).filter(function (c) {
        if (qDigits && allPhonesOf(c).some(function (p) { return p.replace(/\D+/g, '').indexOf(qDigits) >= 0; })) return true;
        if (qName && normalizeName(c.name).indexOf(qName) >= 0) return true;
        if (qDigits && c.nationalId && c.nationalId.indexOf(qDigits) >= 0) return true;
        return false;
      }).map(copy);
    }

    function computeDuplicateGroups(s) {
      var groups = [];
      var seenGroupKey = {};
      var active = Object.keys(s.customers).map(function (id) { return s.customers[id]; });

      // 1. Shared normalized phone (primary or altPhones)
      var byPhone = {};
      active.forEach(function (c) {
        allPhonesOf(c).forEach(function (p) {
          if (!byPhone[p]) byPhone[p] = [];
          if (byPhone[p].indexOf(c.id) < 0) byPhone[p].push(c.id);
        });
      });
      Object.keys(byPhone).sort().forEach(function (p) {
        if (byPhone[p].length > 1) {
          var ids = byPhone[p].slice().sort();
          var sig = 'phone:' + ids.join(',');
          if (!seenGroupKey[sig]) {
            seenGroupKey[sig] = 1;
            groups.push({ reason: 'phone', key: p, ids: ids });
          }
        }
      });

      // 2. Shared nationalId
      var byNat = {};
      active.forEach(function (c) {
        if (!c.nationalId) return;
        if (!byNat[c.nationalId]) byNat[c.nationalId] = [];
        byNat[c.nationalId].push(c.id);
      });
      Object.keys(byNat).sort().forEach(function (nid) {
        if (byNat[nid].length > 1) {
          var ids = byNat[nid].slice().sort();
          var sig = 'nationalId:' + ids.join(',');
          if (!seenGroupKey[sig]) {
            seenGroupKey[sig] = 1;
            groups.push({ reason: 'nationalId', key: nid, ids: ids });
          }
        }
      });

      // 3. Shared normalized name
      var byName = {};
      active.forEach(function (c) {
        var nn = normalizeName(c.name);
        if (nn.length < 2) return;
        if (!byName[nn]) byName[nn] = [];
        byName[nn].push(c.id);
      });
      Object.keys(byName).sort().forEach(function (nn) {
        if (byName[nn].length > 1) {
          var ids = byName[nn].slice().sort();
          var sig = 'name:' + ids.join(',');
          if (!seenGroupKey[sig]) {
            seenGroupKey[sig] = 1;
            groups.push({ reason: 'name', key: nn, ids: ids });
          }
        }
      });

      return groups;
    }

    function detectDuplicates() {
      return computeDuplicateGroups(load());
    }

    /* Reviewed merge of duplicate customer records.
       Requires review.reviewedBy (non-empty string) and a detected duplicate pair (unless review.force && review.reason). */
    function merge(keptId, droppedId, review) {
      if (!review || typeof review !== 'object' || typeof review.reviewedBy !== 'string' || !review.reviewedBy.trim()) {
        fail('reviewer-required');
      }
      var s = load();
      var kId = resolveInState(s, keptId);
      var dId = resolveInState(s, droppedId);
      if (kId === dId) fail('same-customer');
      var kept = s.customers[kId];
      var dropped = s.customers[dId];
      if (!kept || !dropped) fail('unknown-customer');

      var groups = computeDuplicateGroups(s);
      var matchedGroup = null;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].ids.indexOf(kId) >= 0 && groups[i].ids.indexOf(dId) >= 0) {
          matchedGroup = groups[i];
          break;
        }
      }
      var reason = typeof review.reason === 'string' ? review.reason.trim() : '';
      if (!matchedGroup) {
        if (!review.force || !reason) fail('not-duplicate-candidate');
      }

      var at = review.at == null ? now() : review.at;
      var reviewedBy = review.reviewedBy.trim();
      var discarded = {};

      if (kept.name !== dropped.name) discarded.name = dropped.name;
      if (kept.phone !== dropped.phone) discarded.phone = dropped.phone;
      if (dropped.nationalId && kept.nationalId && kept.nationalId !== dropped.nationalId) {
        discarded.nationalId = dropped.nationalId;
      } else if (!kept.nationalId && dropped.nationalId) {
        kept.nationalId = dropped.nationalId;
      }

      // Union phones into kept.altPhones
      var combinedAlt = kept.altPhones.slice();
      allPhonesOf(dropped).forEach(function (p) {
        if (p !== kept.phone && combinedAlt.indexOf(p) < 0) combinedAlt.push(p);
      });
      kept.altPhones = combinedAlt;

      // Union tags
      dropped.tags.forEach(function (tg) {
        if (kept.tags.indexOf(tg) < 0) kept.tags.push(tg);
      });

      // Merge consent history & resolve each channel by latest explicit history entry (tie -> false for safety)
      var combinedHistory = kept.consentHistory.concat(dropped.consentHistory).slice().sort(function (a, b) {
        return a.at - b.at;
      });
      var nextConsent = copy(kept.consent);
      CONSENT_CHANNELS.forEach(function (ch) {
        var chEvents = combinedHistory.filter(function (e) { return e.channel === ch; });
        if (chEvents.length > 0) {
          var maxAt = chEvents[chEvents.length - 1].at;
          var latestAtEvents = chEvents.filter(function (e) { return e.at === maxAt; });
          // If any event at the latest timestamp revoked consent, false wins
          var allowed = latestAtEvents.every(function (e) { return e.allowed === true; });
          if (kept.consent[ch] !== dropped.consent[ch]) {
            if (!discarded.consent) discarded.consent = {};
            discarded.consent[ch] = dropped.consent[ch];
          }
          nextConsent[ch] = allowed;
        } else {
          nextConsent[ch] = Boolean(kept.consent[ch] && dropped.consent[ch]);
        }
      });
      if (dropped.consent.updatedAt && (!nextConsent.updatedAt || dropped.consent.updatedAt > nextConsent.updatedAt)) {
        nextConsent.updatedAt = dropped.consent.updatedAt;
        nextConsent.updatedBy = dropped.consent.updatedBy;
        nextConsent.source = dropped.consent.source;
      }
      kept.consent = nextConsent;
      kept.consentHistory = combinedHistory;

      // Merge preferences: keep kept's preferences, fill empty strings from dropped, record discarded differences
      var prefDiff = {};
      Object.keys(kept.preferences).forEach(function (pk) {
        var kv = kept.preferences[pk], dv = dropped.preferences[pk];
        if ((kv === '' || kv === 'none') && dv !== '' && dv !== 'none') {
          kept.preferences[pk] = dv;
        } else if (kv !== dv) {
          prefDiff[pk] = dv;
        }
      });
      if (Object.keys(prefDiff).length > 0) discarded.preferences = prefDiff;

      kept.updatedAt = at;

      // Update aliases transitively
      s.aliases[dId] = kId;
      Object.keys(s.aliases).forEach(function (aliasKey) {
        if (s.aliases[aliasKey] === dId) s.aliases[aliasKey] = kId;
      });
      delete s.customers[dId];

      s.mergeSeq += 1;
      var logEntry = {
        id: 'mrg-' + s.mergeSeq,
        at: at,
        keptId: kId,
        droppedId: dId,
        reviewedBy: reviewedBy,
        reason: reason || (matchedGroup ? matchedGroup.reason : 'manual'),
        matchReason: matchedGroup ? matchedGroup.reason : 'forced',
        discarded: discarded
      };
      s.mergeLog.push(logEntry);
      save(s);
      return { ok: true, customer: copy(kept), mergeEntry: copy(logEntry) };
    }

    function evaluateStatementPermission(callOpts) {
      callOpts = callOpts || {};
      var user = opts.currentUser ? opts.currentUser() : (callOpts.user || null);
      var role = user && typeof user.role === 'string' ? user.role : (opts.currentUser ? null : (typeof callOpts.role === 'string' ? callOpts.role : null));
      var actor = (user && (user.name || user.id)) || (typeof callOpts.actor === 'string' ? callOpts.actor : null);

      if (typeof opts.canViewStatement === 'function') {
        var customOk = Boolean(opts.canViewStatement({ user: user, role: role, actor: actor, callOpts: callOpts }));
        return { ok: customOk, actor: actor, role: role, why: customOk ? 'custom-policy' : 'custom-policy-denied' };
      }

      var perms = opts.perms || callOpts.perms || null;
      if (perms && typeof perms.require === 'function') {
        var action = opts.statementAction || 'reports.view';
        var permOk = Boolean(perms.require(action));
        if (!permOk) return { ok: false, actor: actor, role: role, why: 'perm-denied' };
        if (!user && !role) return { ok: false, actor: null, role: null, why: 'unauthenticated' };
        if (role && allowedRoles.indexOf(role) < 0) return { ok: false, actor: actor, role: role, why: 'role-denied' };
        return { ok: true, actor: actor, role: role, why: 'perm-granted' };
      }

      if (!role) return { ok: false, actor: actor, role: null, why: 'permission-required' };
      if (allowedRoles.indexOf(role) < 0) return { ok: false, actor: actor, role: role, why: 'role-denied' };
      return { ok: true, actor: actor, role: role, why: 'role-allowed' };
    }

    /* Customer account statement — strictly gated behind permission check.
       Throws Error('permission-denied') and logs the denied attempt when unauthorized. */
    function statement(customerId, callOpts) {
      var s = load();
      var decision = evaluateStatementPermission(callOpts);
      var at = (callOpts && callOpts.at != null) ? callOpts.at : now();

      if (!decision.ok) {
        s.statementAccessLog.push({
          at: at,
          customerId: String(customerId == null ? '' : customerId),
          actor: decision.actor || null,
          role: decision.role || null,
          allowed: false,
          why: decision.why
        });
        save(s);
        fail('permission-denied');
      }

      var c = requireCustomer(s, customerId);
      var aliases = Object.keys(s.aliases).filter(function (a) { return resolveInState(s, a) === c.id; });
      var allIds = [c.id].concat(aliases);

      var ledger = (callOpts && callOpts.creditLedger) || opts.creditLedger || null;
      var movements = [];
      var balance = 0;
      var creditLimit = null;

      if (ledger) {
        if (typeof ledger.limitOf === 'function') creditLimit = ledger.limitOf(c.id);
        allIds.forEach(function (id) {
          if (typeof ledger.statement === 'function') {
            ledger.statement(id).forEach(function (m) { movements.push(copy(m)); });
          }
          if (typeof ledger.balance === 'function') {
            balance = Math.round((balance + Number(ledger.balance(id) || 0)) * 100) / 100;
          }
        });
        movements.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      }

      var salesSource = (callOpts && callOpts.sales) || opts.salesLedger || opts.sales || null;
      var rawSales = typeof salesSource === 'function' ? salesSource() : (salesSource && typeof salesSource.list === 'function' ? salesSource.list() : (Array.isArray(salesSource) ? salesSource : []));
      var phones = allPhonesOf(c);
      var customerSales = rawSales.filter(function (sale) {
        if (!sale || typeof sale !== 'object') return false;
        if (sale.customerId && allIds.indexOf(sale.customerId) >= 0) return true;
        if (typeof sale.customerPhone === 'string') {
          try { if (phones.indexOf(normalizePhone(sale.customerPhone)) >= 0) return true; } catch (e) {}
        }
        return false;
      }).map(copy);

      s.statementAccessLog.push({
        at: at,
        customerId: c.id,
        requestedId: String(customerId),
        actor: decision.actor || null,
        role: decision.role || null,
        allowed: true,
        why: decision.why
      });
      save(s);

      return {
        customer: copy(c),
        aliases: aliases,
        balance: balance,
        creditLimit: creditLimit,
        movements: movements,
        sales: customerSales,
        generatedAt: at,
        accessedBy: { actor: decision.actor || null, role: decision.role || null }
      };
    }

    function statementAccessLog() {
      return deepFreeze(copy(load().statementAccessLog));
    }

    var instance = {
      add: create,
      create: create,
      update: update,
      get: get,
      findById: get,
      resolveId: resolveId,
      findByPhone: findByPhone,
      list: list,
      search: search,
      setConsent: setConsent,
      canContact: canContact,
      effectiveContactChannel: effectiveContactChannel,
      setPreferences: setPreferences,
      detectDuplicates: detectDuplicates,
      merge: merge,
      statement: statement,
      getStatement: statement,
      statementAccessLog: statementAccessLog
    };

    Object.defineProperty(instance, 'mergeLog', {
      enumerable: true,
      get: function () { return deepFreeze(copy(load().mergeLog)); }
    });

    return instance;
  }

  var api = {
    createCustomerDirectory: createCustomerDirectory,
    normalizePhone: normalizePhone,
    normalizeName: normalizeName,
    normalizeDigits: normalizeDigits,
    CONSENT_CHANNELS: CONSENT_CHANNELS,
    LANGUAGES: LANGUAGES,
    PREFERRED_CHANNELS: PREFERRED_CHANNELS,
    RECEIPT_FORMATS: RECEIPT_FORMATS,
    ALLOWED_STATEMENT_ROLES: ALLOWED_STATEMENT_ROLES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaCustomers = api;
})(typeof window !== 'undefined' ? window : globalThis);
