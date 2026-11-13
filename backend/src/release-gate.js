// N129: backend release gate (pure logic, no network). Flag NOVA_RELEASE_GATE=1 (default OFF => gate not enforced, evaluate() reports disabled).
// A backend release needs: zero open P0/P1, passed migration drill, passed restore drill, rollback evidence
// (passed rollback drill + previous version id), plus SHA / CI run. Each drill needs non-empty evidence.
export const releaseGateEnabled = (env) => !!env && String(env.NOVA_RELEASE_GATE) === '1';
export const BACKEND_DRILLS = ['migration', 'restore', 'rollback'];
const DRILL_AR = { migration: 'ترحيل البيانات', restore: 'الاستعادة', rollback: 'التراجع' };
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const p = (code, message_ar) => ({ code, message_ar });

export function evaluateBackendRelease(input) {
  const i = input && typeof input === 'object' ? input : {};
  const problems = [];
  const issues = Array.isArray(i.openIssues) ? i.openIssues : [];
  const blockers = issues.filter((x) => x && /^P[01]$/i.test(str(x.severity)));
  if (blockers.length) problems.push(p('GATE_OPEN_P0P1', `توجد ${blockers.length} مشكلة P0/P1 مفتوحة`));
  const drills = i.drills && typeof i.drills === 'object' ? i.drills : {};
  for (const k of BACKEND_DRILLS) {
    const d = drills[k];
    if (!(d && d.passed === true && str(d.evidence))) problems.push(p('GATE_DRILL_' + k.toUpperCase(), `تمرين ${DRILL_AR[k]} غير مُجرَّب أو بلا دليل`));
  }
  if (!str(i.previousVersion)) problems.push(p('GATE_ROLLBACK_TARGET', 'لا يوجد إصدار سابق مسجّل للتراجع إليه'));
  if (!/^[0-9a-f]{7,40}$/i.test(str(i.sha))) problems.push(p('GATE_BAD_SHA', 'SHA غير صالح أو مفقود'));
  if (!str(i.ciRun) || i.ciGreen !== true) problems.push(p('GATE_CI', 'CI ليس أخضر أو بلا رقم تشغيل'));
  return { ready: problems.length === 0, problems };
}

// Flag OFF => not enforced and never claims readiness.
export function backendReleaseGate(env, input) {
  if (!releaseGateEnabled(env)) return { enabled: false, ready: false, problems: [] };
  return { enabled: true, ...evaluateBackendRelease(input) };
}
