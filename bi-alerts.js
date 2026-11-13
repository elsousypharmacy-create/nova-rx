/* NOVA Rx — BI-05 threshold alerts + roadmap summary (pure logic, no network, frontend/local only).
   Alerts: configurable rules; a firing alert is suppressed during its cooldown, and after the cooldown it repeats
   only if the value worsened by >= minDelta (minDelta 0 = repeat each cooldown). It re-arms once the condition clears.
   Roadmap: reads the published erp-roadmap JSON. acceptancePercent counts ONLY tasks with status 'verified',
   verifiedAt, a verification record and evidence; buildPercent counts accepted + for_review code. Never mixed.
   Works as <script> (window.NovaBiAlerts) and in Node. */
(function (root) {
  'use strict';
  var OPS = { gt: function (v, t) { return v > t; }, gte: function (v, t) { return v >= t; }, lt: function (v, t) { return v < t; }, lte: function (v, t) { return v <= t; } };
  function err(code) { var e = new Error(code); e.code = code; return e; }
  function num(v) { if (v === null || v === '' || typeof v === 'boolean') return null; var n = Number(v); return isFinite(n) ? n : null; }

  function createAlerts(storage, key, opts) {
    var now = (opts && opts.now) || Date.now;
    function load() { try { var d = JSON.parse(storage.getItem(key)); return d && d.rules ? d : { rules: [], state: {} }; } catch (e) { return { rules: [], state: {} }; } }
    function save(d) { storage.setItem(key, JSON.stringify(d)); }
    function setRule(r) {
      r = r || {};
      if (!r.id || typeof r.id !== 'string') throw err('id-required');
      if (!r.metric || typeof r.metric !== 'string') throw err('metric-required');
      if (!OPS[r.op]) throw err('bad-op');
      if (num(r.threshold) === null) throw err('bad-threshold');
      var cd = r.cooldownMs === undefined ? 3600000 : num(r.cooldownMs);
      if (cd === null || cd < 0) throw err('bad-cooldown');
      var md = r.minDelta === undefined ? 0 : num(r.minDelta);
      if (md === null || md < 0) throw err('bad-min-delta');
      var d = load();
      var rule = { id: r.id, metric: r.metric, op: r.op, threshold: Number(r.threshold), cooldownMs: cd, minDelta: md, label: String(r.label || r.id) };
      d.rules = d.rules.filter(function (x) { return x.id !== r.id; }).concat([rule]);
      save(d); return rule;
    }
    function removeRule(id) { var d = load(); d.rules = d.rules.filter(function (x) { return x.id !== id; }); delete d.state[id]; save(d); }
    function rules() { return load().rules; }
    // Returns only the alerts that should be shown now.
    function evaluate(metrics) {
      var d = load(), t = now(), out = [];
      d.rules.forEach(function (r) {
        var v = num(metrics && metrics[r.metric]);
        if (v === null) return; // missing metric: neither fire nor re-arm
        var st = d.state[r.id];
        if (!OPS[r.op](v, r.threshold)) { delete d.state[r.id]; return; } // cleared: re-arm
        var fire = !st;
        if (st && t - st.at >= r.cooldownMs) {
          var worse = (r.op === 'gt' || r.op === 'gte') ? v - st.value : st.value - v;
          fire = r.minDelta === 0 || worse >= r.minDelta;
        }
        if (fire) { d.state[r.id] = { at: t, value: v }; out.push({ id: r.id, label: r.label, metric: r.metric, value: v, threshold: r.threshold, at: t }); }
      });
      save(d); return out;
    }
    return { setRule: setRule, removeRule: removeRule, rules: rules, evaluate: evaluate };
  }

  function pct(a, b) { return Math.round(a / b * 1000) / 10; }
  function summarizeRoadmap(json) {
    var stages = (json && Array.isArray(json.roadmap)) ? json.roadmap : [];
    var total = 0, acc = 0, built = 0, out = [];
    stages.forEach(function (s) {
      var sw = 0, sa = 0, sb = 0, tasks = [];
      (Array.isArray(s.tasks) ? s.tasks : []).forEach(function (t) {
        var w = num(t.weight) || 0;
        var accepted = t.status === 'verified' && !!t.verifiedAt && !!t.verification && Array.isArray(t.evidence) && t.evidence.length > 0;
        var isBuilt = accepted || t.status === 'for_review';
        sw += w; if (accepted) sa += w; if (isBuilt) sb += w;
        tasks.push({ id: t.id, title: t.title, status: t.status, accepted: accepted, built: isBuilt, verifiedAt: t.verifiedAt || null, evidence: Array.isArray(t.evidence) ? t.evidence : [] });
      });
      total += sw; acc += sa; built += sb;
      out.push({ id: s.id, title: s.title, acceptancePercent: sw ? pct(sa, sw) : null, buildPercent: sw ? pct(sb, sw) : null, tasks: tasks });
    });
    return { updatedAt: (json && json.updatedAt) || null, planVersion: (json && json.planVersion) || null,
      acceptancePercent: total ? pct(acc, total) : null, buildPercent: total ? pct(built, total) : null, stages: out };
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(String(u)) ? String(u) : ''; }

  // RTL HTML string; two separate percentages on top; per task: status, verified date, evidence links.
  function renderRoadmap(summary) {
    var p = function (v) { return v === null ? '—' : esc(v) + '%'; };
    var h = '<section dir="rtl" lang="ar" class="nova-roadmap">';
    h += '<p>القبول الموزون: <b>' + p(summary.acceptancePercent) + '</b> · نسبة البناء: <b>' + p(summary.buildPercent) + '</b></p>';
    summary.stages.forEach(function (s) {
      h += '<h3>' + esc(s.title) + '</h3><ul>';
      s.tasks.forEach(function (t) {
        h += '<li>' + esc(t.id) + ' — ' + esc(t.title) + ' (' + esc(t.status) + ')';
        if (t.verifiedAt) h += ' · ' + esc(String(t.verifiedAt).slice(0, 10));
        t.evidence.forEach(function (e) { var u = safeUrl(e && e.url); if (u) h += ' <a href="' + esc(u) + '" rel="noopener">دليل</a>'; });
        h += '</li>';
      });
      h += '</ul>';
    });
    return h + '</section>';
  }

  var api = { createAlerts: createAlerts, summarizeRoadmap: summarizeRoadmap, renderRoadmap: renderRoadmap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaBiAlerts = api;
})(typeof window !== 'undefined' ? window : globalThis);
