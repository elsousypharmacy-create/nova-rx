/* NOVA Rx — QA-04 release gate (pure logic, no network, frontend/local only).
   Green CI alone is not enough: needs no open P0/P1, a tried migration/rollback/restore drill,
   and evidence slots (SHA, CI run, viewport, printer, owner approval). Works as <script> (window.NovaReleaseGate) and Node. */
(function (root) {
  'use strict';
  var SLOTS = ['sha', 'ciRun', 'viewport', 'printer', 'ownerApproval'];
  var LABELS = { sha: 'SHA الإصدار', ciRun: 'تشغيل CI', viewport: 'فحص الشاشة', printer: 'فحص الطابعة', ownerApproval: 'موافقة المالك' };
  var DRILLS = ['migration', 'rollback', 'restore'];
  var DRILL_LABELS = { migration: 'ترحيل البيانات', rollback: 'التراجع', restore: 'الاستعادة' };
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function evaluate(input) {
    input = input || {};
    var problems = [];
    var issues = Array.isArray(input.openIssues) ? input.openIssues : [];
    var blockers = issues.filter(function (i) { return i && /^P[01]$/i.test(str(i.severity)); });
    if (blockers.length) problems.push('توجد ' + blockers.length + ' مشكلة P0/P1 مفتوحة');
    var drills = input.drills || {};
    DRILLS.forEach(function (k) {
      if (!(drills[k] && drills[k].passed === true && str(drills[k].evidence))) problems.push('تمرين ' + DRILL_LABELS[k] + ' غير مُجرَّب أو بلا دليل');
    });
    var slots = input.slots || {};
    SLOTS.forEach(function (k) { if (!str(slots[k])) problems.push('خانة فارغة: ' + LABELS[k]); });
    if (str(slots.sha) && !/^[0-9a-f]{7,40}$/i.test(str(slots.sha))) problems.push('SHA غير صالح');
    if (input.ciGreen !== true) problems.push('CI ليس أخضر');
    return { ready: problems.length === 0, problems: problems };
  }
  var api = { SLOTS: SLOTS, DRILLS: DRILLS, evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaReleaseGate = api;
})(typeof window !== 'undefined' ? window : globalThis);
