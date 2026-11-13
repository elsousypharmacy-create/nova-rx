/* NOVA Rx — UX-05 learnability session kit (pure logic, no network, frontend/local only).
   Training path (search, sell, return, receive), per-task step/error recording, pass/fail vs 30-minute goal,
   and Ahmed's tablet-flow acceptance checklist. Arabic text, RTL-safe. Works as <script> (window.NovaLearn) and Node.
   Not wired to a screen (Black Edition untouched). */
(function (root) {
  'use strict';
  var LIMIT_MIN = 30;
  var TASKS = [
    { id: 'search', title: 'البحث عن دواء', target: 3,
      steps: ['افتح شاشة البيع', 'اكتب اسم الدواء أو امسح الباركود', 'اختر الصنف من النتائج وراجع السعر والمخزون'] },
    { id: 'sell', title: 'بيع دواء', target: 5,
      steps: ['ابحث عن الصنف وأضفه للسلة', 'عدّل الكمية', 'راجع تنبيهات الدواء', 'اختر طريقة الدفع', 'أكّد البيع واطبع الإيصال'] },
    { id: 'return', title: 'إرجاع صنف', target: 4,
      steps: ['افتح الفاتورة الأصلية', 'اختر الصنف والكمية المرتجعة', 'اختر سبب الإرجاع', 'أكّد الإرجاع'] },
    { id: 'receive', title: 'استلام بضاعة', target: 5,
      steps: ['افتح أمر الشراء', 'طابق الأصناف مع الفاتورة', 'أدخل الكمية والتشغيلة وتاريخ الصلاحية', 'راجع الفروقات', 'أكّد الاستلام'] }
  ];
  var TABLET = [
    'الشاشة تعمل بالعرض الأفقي والعمودي دون قصّ',
    'الاتجاه من اليمين لليسار سليم في كل الشاشات الأربع',
    'أزرار اللمس لا تقل عن 44 بكسل ولا تتداخل',
    'لوحة المفاتيح لا تغطي حقل الإدخال',
    'البحث بالاسم والباركود يعمل باللمس',
    'البيع يكتمل في 5 خطوات أو أقل',
    'الإرجاع يكتمل في 4 خطوات أو أقل',
    'الاستلام يكتمل في 5 خطوات أو أقل',
    'رسائل الخطأ بالعربية وتوضح الإجراء التالي',
    'الوضع الداكن (Black Edition) مقروء بوضوح',
    'مبتدئ أنهى المسار كاملًا خلال 30 دقيقة دون مساعدة'
  ];
  function task(id) { for (var i = 0; i < TASKS.length; i++) if (TASKS[i].id === id) return TASKS[i]; return null; }

  /* record: { taskId, steps (taken), errors, minutes, helped } */
  function evaluateTask(rec) {
    var t = task(rec && rec.taskId); if (!t) throw new Error('unknown-task');
    var steps = Number(rec.steps), errors = Number(rec.errors || 0), minutes = Number(rec.minutes || 0);
    if (!(steps >= 0) || !(errors >= 0) || !(minutes >= 0)) throw new Error('bad-numbers');
    var extra = Math.max(0, steps - t.target);
    return { taskId: t.id, steps: steps, target: t.target, extraSteps: extra, errors: errors, minutes: minutes,
      helped: !!rec.helped, pass: !rec.helped && extra === 0 && errors === 0 };
  }
  function summarize(records) {
    var seen = {}, rows = [], total = 0, errors = 0, steps = 0, i;
    for (i = 0; i < (records || []).length; i++) {
      var r = evaluateTask(records[i]); seen[r.taskId] = true; rows.push(r);
      total += r.minutes; errors += r.errors; steps += r.steps;
    }
    var missing = TASKS.filter(function (t) { return !seen[t.id]; }).map(function (t) { return t.id; });
    var within = total <= LIMIT_MIN;
    return { rows: rows, totalMinutes: total, totalErrors: errors, totalSteps: steps, missing: missing, withinLimit: within,
      unassisted: rows.every(function (r) { return !r.helped; }),
      pass: missing.length === 0 && within && rows.every(function (r) { return !r.helped; }) };
  }
  function checklist(done) {
    var d = done || {};
    return TABLET.map(function (text, i) { return { n: i + 1, text: text, done: d[i + 1] === true }; });
  }
  function accepted(done) { return checklist(done).every(function (c) { return c.done; }); }

  var api = { LIMIT_MIN: LIMIT_MIN, TASKS: TASKS, TABLET: TABLET, evaluateTask: evaluateTask, summarize: summarize,
    checklist: checklist, accepted: accepted };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaLearn = api;
})(typeof window !== 'undefined' ? window : globalThis);
