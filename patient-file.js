/* NOVA Rx — CLN-01 short local patient file (no DOM, no network, no backend).
   Age + weight WITH units, allergies, pregnancy/lactation, required questions by case.
   "Unknown" is a first-class value (null / 'unknown') and is never coerced to 0, false or "none".
   Stored only in the supplied on-device storage; reads need an allow() gate; records expire (retention) and can be erased.
   Works as a <script> (window.NovaPatientFile) and in Node (module.exports). */
(function (root) {
  'use strict';
  var DAY = 86400000, RETENTION_DAYS = 30, KEYN = 'nova.patientfile';
  var AGE_UNITS = { year: 130, month: 1560, day: 30 }, WT_UNITS = { kg: [0.3, 400], lb: [0.7, 880], g: [300, 400000] };
  var UNK = 'unknown', TRI = [UNK, 'yes', 'no'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = typeof v === 'number' ? v : Number(String(v).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }).replace(',', '.').replace('٫', '.')); return isFinite(n) ? n : NaN; }
  function tri(v, name) { if (v === undefined || v === null || v === '') return UNK; if (TRI.indexOf(v) < 0) fail('bad-' + name); return v; }
  /* input: { age:{value,unit}, weight:{value,unit}, sex, allergies:{status:'unknown'|'none'|'yes', items:[]}, pregnant, lactating, case } */
  function normalize(i) {
    i = i || {}; var out = {};
    var a = i.age || {}, av = num(a.value);
    if (av === null) out.age = null; else {
      if (!AGE_UNITS[a.unit]) fail('age-unit-required');
      if (isNaN(av) || av < 0 || av > AGE_UNITS[a.unit]) fail('bad-age'); out.age = { value: av, unit: a.unit };
    }
    var w = i.weight || {}, wv = num(w.value);
    if (wv === null) out.weight = null; else {
      var r = WT_UNITS[w.unit]; if (!r) fail('weight-unit-required');
      if (isNaN(wv) || wv < r[0] || wv > r[1]) fail('bad-weight'); out.weight = { value: wv, unit: w.unit };
    }
    out.sex = i.sex === 'female' || i.sex === 'male' ? i.sex : UNK;
    var al = i.allergies || {}, st = al.status || UNK, items = (al.items || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (['unknown', 'none', 'yes'].indexOf(st) < 0) fail('bad-allergy-status');
    if (st === 'yes' && !items.length) fail('allergy-items-required');
    out.allergies = { status: st, items: st === 'yes' ? items : [] };
    out.pregnant = tri(i.pregnant, 'pregnant'); out.lactating = tri(i.lactating, 'lactating');
    out.case = i.case || 'general';
    return out;
  }
  /* Questions still unanswered for this case. Unknown = unanswered. */
  function requiredQuestions(rec) {
    var q = [], c = rec.case, child = rec.age && ((rec.age.unit !== 'year') || rec.age.value < 12);
    if (!rec.age) q.push('age'); if (!rec.allergies || rec.allergies.status === UNK) q.push('allergies');
    if (c === 'pediatric' || child || c === 'dosing') { if (!rec.weight) q.push('weight'); }
    var fertile = rec.sex !== 'male' && !(rec.age && rec.age.unit === 'year' && (rec.age.value < 12 || rec.age.value > 55));
    if (c !== 'external-only' && fertile) { if (rec.pregnant === UNK) q.push('pregnant'); if (rec.lactating === UNK) q.push('lactating'); }
    return q;
  }
  /* opts: { storage, now(), allow(action):bool, retentionDays } */
  function createStore(o) {
    var now = o.now || Date.now, ttl = (o.retentionDays || RETENTION_DAYS) * DAY;
    function raw() { var r = o.storage.getItem(KEYN); if (!r) return {}; try { var m = JSON.parse(r); if (m && typeof m === 'object' && !Array.isArray(m)) return m; } catch (e) {} fail('patientfile-corrupt'); }
    function put(m) { try { o.storage.setItem(KEYN, JSON.stringify(m)); } catch (e) { fail('patientfile-write-failed'); } }
    function gate(a) { if (!o.allow || !o.allow(a)) fail('permission'); }
    function purge() { var m = raw(), t = now(), n = 0; Object.keys(m).forEach(function (k) { if (t - m[k].at >= ttl) { delete m[k]; n++; } }); if (n) put(m); return n; }
    function save(id, input) { gate('patient.write'); if (!id) fail('id-required'); var m = raw(); m[id] = { at: now(), rec: normalize(input) }; put(m); return requiredQuestions(m[id].rec); }
    function get(id) { gate('patient.read'); purge(); var e = raw()[id]; return e ? { rec: e.rec, missing: requiredQuestions(e.rec), expiresAt: e.at + ttl } : null; }
    function erase(id) { gate('patient.write'); var m = raw(); var had = id in m; delete m[id]; put(m); return had; }
    return { save: save, get: get, erase: erase, purge: purge };
  }
  var api = { normalize: normalize, requiredQuestions: requiredQuestions, createStore: createStore, RETENTION_DAYS: RETENTION_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaPatientFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
