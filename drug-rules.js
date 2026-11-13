/* NOVA Rx — CLN-02 local documented drug rules (pure logic, no DOM, no network, no paid API, frontend/local only).
   A versioned rule set: every substance and every interaction carries source, edition and date (rows without them are rejected).
   Reviewed corrections are an append-only log (reviewer + reason + source + date); the original set is never mutated
   and the STOCK LIVE catalog is never read or written. effective() = original + corrections, each field with provenance.
   toInteractionTable() feeds NovaClinical.buildTable (clinical-warnings.js). Ships no clinical data: the pharmacy loads a documented set.
   Works as a <script> (window.NovaDrugRules) and in Node (module.exports). Not wired to a screen yet. */
(function (root) {
  'use strict';

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  var RANK = { contraindicated: 4, major: 3, moderate: 2, minor: 1 };
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function has(s) { return typeof s === 'string' && s.trim() !== ''; }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function validDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)); }
  function prov(r, code) { if (!r || !has(r.source) || !has(r.edition) || !validDate(r.date)) fail(code); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* set: {version, substances:[{name, source, edition, date, note?}], interactions:[{a, b, severity, reason, source, edition, date}]} */
  function createRuleSet(set) {
    if (!set || !has(set.version)) fail('missing-version');
    var subs = {}, ints = {};
    (set.substances || []).forEach(function (s) {
      if (!s || !norm(s.name)) fail('bad-substance-row');
      prov(s, 'missing-provenance');
      var k = norm(s.name);
      if (subs[k]) fail('duplicate-substance');
      subs[k] = { name: k, note: s.note ? String(s.note) : '', source: s.source, edition: s.edition, date: s.date };
    });
    (set.interactions || []).forEach(function (r) {
      if (!r || !norm(r.a) || !norm(r.b) || norm(r.a) === norm(r.b) || !RANK[r.severity] || !has(r.reason)) fail('bad-interaction-row');
      prov(r, 'missing-provenance');
      var k = pairKey(norm(r.a), norm(r.b));
      if (ints[k]) fail('duplicate-interaction');
      ints[k] = { a: norm(r.a) < norm(r.b) ? norm(r.a) : norm(r.b), b: norm(r.a) < norm(r.b) ? norm(r.b) : norm(r.a),
        severity: r.severity, reason: String(r.reason), source: r.source, edition: r.edition, date: r.date };
    });
    return Object.freeze({ version: set.version, substances: Object.freeze(subs), interactions: Object.freeze(ints) });
  }

  /* Reviewed corrections to one interaction (a,b) or substance (name): {target:{a,b}|{name}, changes:{severity?,reason?,note?},
     reviewer, reason, source, edition, date}. Persisted append-only; the original set is untouched. */
  function createRuleBook(ruleSet, storage, key) {
    key = key || 'nova.drugrules.corrections';
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return [];
      var a; try { a = JSON.parse(raw); } catch (e) { fail('log-corrupt'); }
      if (!Array.isArray(a)) fail('log-corrupt');
      return a;
    }
    function targetKey(t) {
      if (t && norm(t.name)) return 'sub:' + norm(t.name);
      if (t && norm(t.a) && norm(t.b)) return 'int:' + pairKey(norm(t.a), norm(t.b));
      fail('bad-target');
    }
    function correct(c) {
      c = c || {};
      var tk = targetKey(c.target);
      var isSub = tk.indexOf('sub:') === 0, base = isSub ? ruleSet.substances[tk.slice(4)] : ruleSet.interactions[tk.slice(4)];
      if (!base) fail('unknown-target');
      var ch = c.changes || {}, allowed = isSub ? ['note'] : ['severity', 'reason'], keys = Object.keys(ch);
      if (!keys.length) fail('no-changes');
      keys.forEach(function (f) { if (allowed.indexOf(f) < 0) fail('field-not-correctable'); });
      if (ch.severity !== undefined && !RANK[ch.severity]) fail('bad-severity');
      if (ch.reason !== undefined && !has(ch.reason)) fail('bad-reason');
      if (!has(c.reviewer)) fail('missing-reviewer');
      if (!has(c.reason)) fail('missing-reason');
      prov(c, 'missing-provenance');
      var log = load();
      log.push({ target: tk, changes: copy(ch), reviewer: c.reviewer.trim(), reason: String(c.reason), source: c.source, edition: c.edition, date: c.date, seq: log.length + 1 });
      try { storage.setItem(key, JSON.stringify(log)); } catch (e) { fail('log-write-failed'); }
    }
    /* Merged view; each row lists its corrections so provenance of every change stays visible. */
    function effective() {
      var out = { version: ruleSet.version, substances: {}, interactions: {} }, log = load();
      Object.keys(ruleSet.substances).forEach(function (k) { out.substances[k] = Object.assign(copy(ruleSet.substances[k]), { corrections: [] }); });
      Object.keys(ruleSet.interactions).forEach(function (k) { out.interactions[k] = Object.assign(copy(ruleSet.interactions[k]), { corrections: [] }); });
      log.forEach(function (e) {
        var isSub = e.target.indexOf('sub:') === 0, row = (isSub ? out.substances : out.interactions)[e.target.slice(4)];
        if (!row) return;
        Object.keys(e.changes).forEach(function (f) { row[f] = e.changes[f]; });
        row.corrections.push({ seq: e.seq, reviewer: e.reviewer, reason: e.reason, source: e.source, edition: e.edition, date: e.date, changes: e.changes });
      });
      return out;
    }
    /* Rows for NovaClinical.buildTable; the source text names source, edition, date and, if corrected, the reviewer. */
    function toInteractionTable() {
      var eff = effective();
      return Object.keys(eff.interactions).map(function (k) {
        var r = eff.interactions[k], last = r.corrections[r.corrections.length - 1];
        var src = r.source + ' ' + r.edition + ' (' + r.date + ')' + (last ? ' + corrected by ' + last.reviewer + ' per ' + last.source + ' ' + last.edition + ' (' + last.date + ')' : '');
        return { a: r.a, b: r.b, severity: r.severity, source: src, reason: r.reason };
      });
    }
    function lookup(a, b) { var r = effective().interactions[pairKey(norm(a), norm(b))]; return r || null; }
    return { correct: correct, effective: effective, lookup: lookup, toInteractionTable: toInteractionTable, corrections: load };
  }

  var api = { createRuleSet: createRuleSet, createRuleBook: createRuleBook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaDrugRules = api;
})(typeof window !== 'undefined' ? window : this);
