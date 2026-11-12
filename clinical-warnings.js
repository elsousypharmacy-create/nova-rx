/* NOVA Rx — CLN-03 interactions and warnings (pure logic, no DOM, no network, frontend/local only).
   check({patient, items}) -> warnings, each with severity, source, reason and a stable key:
     interaction (from a supplied interaction table: severity + source + reason) | allergy | child (age limit) | duplicate-substance
     | form-mismatch and strength-mismatch (BLOCK: cannot be overridden, the item must be changed).
   Every non-blocking warning needs a recorded pharmacist decision (accept | override with reason | cancel-item) before dispensing.
   Patient advice is never generated automatically: adviceFor() returns null until the pharmacist has decided every warning.
   Works as a <script> (window.NovaClinical) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  var RANK = { contraindicated: 4, major: 3, moderate: 2, minor: 1 };
  var DECISIONS = ['accept', 'override', 'cancel-item'];
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function subs(item) { return (item.substances || []).map(norm).filter(Boolean); }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function strengthText(s) { return s && s.value != null ? Number(s.value) + norm(s.unit) : ''; }

  /* table: [{a, b, severity, source, reason}] — substances, order-free. Bad rows are rejected, not ignored. */
  function buildTable(rows) {
    var m = {};
    (rows || []).forEach(function (r) {
      if (!r || !norm(r.a) || !norm(r.b) || !RANK[r.severity] || !norm(r.source) || !norm(r.reason)) fail('bad-interaction-row');
      var k = pairKey(norm(r.a), norm(r.b));
      if (!m[k] || RANK[r.severity] > RANK[m[k].severity]) m[k] = { severity: r.severity, source: String(r.source), reason: String(r.reason) };
    });
    return m;
  }

  /* patient: {ageYears, allergies:[substance]}
     item: {id, name, substances, form, strength:{value,unit}, prescribedForm, prescribedStrength, minAgeYears} */
  function check(input, table) {
    input = input || {};
    var patient = input.patient || {}, items = input.items || [], out = [];
    var tbl = table && !Array.isArray(table) ? table : buildTable(table);
    var allergies = (patient.allergies || []).map(norm);

    items.forEach(function (it) {
      if (!it || !it.id) fail('missing-item-id');
      if (it.prescribedForm && norm(it.prescribedForm) !== norm(it.form))
        out.push({ key: 'form:' + it.id, type: 'form-mismatch', block: true, severity: 'contraindicated', items: [it.id], source: 'dispensing-check',
          reason: 'prescribed form ' + it.prescribedForm + ' but item is ' + (it.form || 'unknown') });
      if (it.prescribedStrength && strengthText(it.prescribedStrength) !== strengthText(it.strength))
        out.push({ key: 'strength:' + it.id, type: 'strength-mismatch', block: true, severity: 'contraindicated', items: [it.id], source: 'dispensing-check',
          reason: 'prescribed strength ' + strengthText(it.prescribedStrength) + ' but item is ' + (strengthText(it.strength) || 'unknown') });
      subs(it).forEach(function (s) {
        if (allergies.indexOf(s) >= 0)
          out.push({ key: 'allergy:' + it.id + ':' + s, type: 'allergy', block: false, severity: 'major', items: [it.id], source: 'patient-record', reason: 'patient allergy to ' + s });
      });
      if (it.minAgeYears != null) {
        if (typeof patient.ageYears !== 'number') out.push({ key: 'child:' + it.id, type: 'child', block: false, severity: 'major', items: [it.id], source: 'item-label', reason: 'patient age unknown, item needs age >= ' + it.minAgeYears });
        else if (patient.ageYears < it.minAgeYears) out.push({ key: 'child:' + it.id, type: 'child', block: false, severity: 'major', items: [it.id], source: 'item-label', reason: 'patient age ' + patient.ageYears + ' < ' + it.minAgeYears });
      }
    });

    for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) {
      var si = subs(items[i]), sj = subs(items[j]), seenDup = {};
      si.forEach(function (s) {
        if (sj.indexOf(s) >= 0 && !seenDup[s]) { seenDup[s] = 1;
          out.push({ key: 'dup:' + pairKey(items[i].id, items[j].id) + ':' + s, type: 'duplicate-substance', block: false, severity: 'moderate', items: [items[i].id, items[j].id], source: 'order-check', reason: 'both contain ' + s }); }
      });
      si.forEach(function (a) { sj.forEach(function (b) {
        var hit = a !== b && tbl[pairKey(a, b)];
        if (hit) out.push({ key: 'int:' + pairKey(items[i].id, items[j].id) + ':' + pairKey(a, b), type: 'interaction', block: false, severity: hit.severity, items: [items[i].id, items[j].id], source: hit.source, reason: hit.reason });
      }); });
    }
    out.sort(function (x, y) { return RANK[y.severity] - RANK[x.severity]; });
    return out;
  }

  /* Pharmacist decision log, append-only, persisted. */
  function createReview(storage, key) {
    key = key || 'nova.clinical';
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      var a; try { a = JSON.parse(raw); } catch (e) { fail('log-corrupt'); }
      if (!Array.isArray(a)) fail('log-corrupt');
      return a;
    }
    function decide(warning, d) {
      if (!warning || !warning.key) fail('missing-warning');
      if (warning.block) fail('blocked-cannot-override');
      d = d || {};
      if (typeof d.pharmacist !== 'string' || !d.pharmacist.trim()) fail('missing-pharmacist');
      if (DECISIONS.indexOf(d.decision) < 0) fail('bad-decision');
      var needsReason = d.decision === 'override' || warning.severity === 'contraindicated' || warning.severity === 'major';
      if (needsReason && !norm(d.reason)) fail('missing-reason');
      var log = load();
      log.push({ key: warning.key, decision: d.decision, pharmacist: d.pharmacist.trim(), reason: d.reason ? String(d.reason) : '', severity: warning.severity, at: d.at || Date.now() });
      try { storage.setItem(key, JSON.stringify(log)); } catch (e) { fail('log-write-failed'); }
    }
    function latest(k) { var l = load(); for (var i = l.length - 1; i >= 0; i--) if (l[i].key === k) return l[i]; return null; }
    function status(warnings) {
      var blocked = warnings.filter(function (w) { return w.block; });
      var pending = warnings.filter(function (w) { return !w.block && !latest(w.key); });
      var cancelled = warnings.filter(function (w) { var d = latest(w.key); return d && d.decision === 'cancel-item'; });
      return { canDispense: !blocked.length && !pending.length && !cancelled.length, blocked: blocked, pending: pending, cancelled: cancelled };
    }
    /* Never automatic: null until every warning has a pharmacist decision; the text is only a draft for the pharmacist to hand over. */
    function adviceFor(warnings) {
      var st = status(warnings);
      if (st.blocked.length || st.pending.length) return null;
      var lines = warnings.map(function (w) { var d = latest(w.key); return d.decision === 'cancel-item' ? null : w.type + ': ' + w.reason; }).filter(Boolean);
      return lines.length ? { draft: true, approvedBy: latest(warnings[0].key).pharmacist, lines: lines } : null;
    }
    return { decide: decide, decisionFor: latest, status: status, adviceFor: adviceFor, log: load };
  }

  var api = { buildTable: buildTable, check: check, createReview: createReview };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaClinical = api;
})(typeof window !== 'undefined' ? window : this);
