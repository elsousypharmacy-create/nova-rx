/* NOVA Rx — CLN-05 local/mock clinical assistant (no DOM, no network, no paid AI, frontend/local only).
   One call per invoice: review(invoice) -> {source:'model'|'local-rules', notes, instructions, ...}.
   The model is INJECTED (a mock in tests); timeout + limited retry + budget cap guard it; its output is validated
   and any failure falls back to the local rules (NovaClinical.check). Patient instructions are never released
   until a pharmacist has approved the exact review (approve() -> instructionsFor()).
   Works as a <script> (window.NovaAssistant) and in Node (module.exports). */
(function (root) {
  'use strict';
  var SEV = ['contraindicated', 'major', 'moderate', 'minor', 'info'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function clinicalLib() { try { return root.NovaClinical || (typeof require === 'function' ? require('./clinical-warnings.js') : null); } catch (e) { return null; } }

  /* Output must be {notes:[{severity,text}], instructions:[string]} with bounded sizes; anything else is rejected. */
  function validate(out) {
    if (!out || typeof out !== 'object' || !Array.isArray(out.notes) || !Array.isArray(out.instructions)) fail('bad-output');
    if (out.notes.length > 50 || out.instructions.length > 20) fail('bad-output');
    var notes = out.notes.map(function (n) {
      if (!n || SEV.indexOf(n.severity) < 0 || typeof n.text !== 'string' || !n.text.trim() || n.text.length > 500) fail('bad-output');
      return { severity: n.severity, text: n.text.trim() };
    });
    var ins = out.instructions.map(function (s) { if (typeof s !== 'string' || !s.trim() || s.length > 500) fail('bad-output'); return s.trim(); });
    return { notes: notes, instructions: ins };
  }

  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { var e = new Error('timeout'); e.code = 'timeout'; rej(e); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  /* opts: {model(invoice)->Promise, timeoutMs=8000, retries=1 (max 2), budget:{maxCalls, maxCost}, cost=1 (per attempt),
            table (interaction rows), clinical (override lib)} */
  function createAssistant(opts) {
    opts = opts || {};
    var model = opts.model, timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 8000;
    var retries = Math.min(Math.max(opts.retries == null ? 1 : opts.retries | 0, 0), 2);
    var cost = opts.cost == null ? 1 : opts.cost, budget = opts.budget || {}, spent = { calls: 0, cost: 0 };
    var maxCalls = budget.maxCalls == null ? 10 : budget.maxCalls, maxCost = budget.maxCost == null ? 10 : budget.maxCost;
    var approvals = {};

    function local(invoice) {
      var lib = opts.clinical || clinicalLib(), ws = lib ? lib.check({ patient: invoice.patient, items: invoice.items }, opts.table || []) : [];
      return { source: 'local-rules', notes: ws.map(function (w) { return { severity: w.severity || (w.block ? 'major' : 'moderate'), text: w.type + ': ' + w.reason }; }), instructions: [] };
    }
    function fp(r) { return JSON.stringify([r.source, r.notes, r.instructions]); }

    async function review(invoice) {
      if (!invoice || !invoice.id) fail('missing-invoice-id');
      var reason = typeof model === 'function' ? null : 'no-model', res = null;
      for (var a = 0; !reason && a <= retries; a++) {
        if (spent.calls + 1 > maxCalls || spent.cost + cost > maxCost) { reason = 'budget-exceeded'; break; }
        spent.calls++; spent.cost += cost;
        try {
          var v = validate(await withTimeout(model(invoice), timeoutMs));
          res = { source: 'model', notes: v.notes, instructions: v.instructions }; break;
        } catch (e) {
          reason = e.code === 'timeout' ? 'timeout' : e.code === 'bad-output' ? 'bad-output' : 'model-error';
          if (e.code === 'bad-output' || a === retries) break; /* invalid output is not retried */
          reason = null; /* retry */
        }
      }
      if (!res) { res = local(invoice); res.fallbackReason = reason || 'model-error'; }
      res.invoiceId = invoice.id; res.approved = false; res.fingerprint = fp(res);
      return res;
    }
    /* Pharmacist approval is bound to the exact reviewed content; a changed review needs a new approval. */
    function approve(r, pharmacist) {
      if (!r || !r.fingerprint || !pharmacist || !String(pharmacist).trim()) fail('pharmacist-required');
      if (fp(r) !== r.fingerprint) fail('review-changed');
      approvals[r.invoiceId] = { by: String(pharmacist).trim(), fingerprint: r.fingerprint };
      return approvals[r.invoiceId];
    }
    function instructionsFor(r) {
      var ap = r && approvals[r.invoiceId];
      if (!ap || ap.fingerprint !== r.fingerprint || fp(r) !== r.fingerprint) return null;
      return r.instructions.slice();
    }
    return { review: review, approve: approve, instructionsFor: instructionsFor, usage: function () { return { calls: spent.calls, cost: spent.cost }; } };
  }

  var api = { createAssistant: createAssistant, validate: validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
