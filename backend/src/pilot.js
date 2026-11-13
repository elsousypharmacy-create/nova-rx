// N128 QA-03: store pilot kit config (فرع السوسي). Flag NOVA_PILOT_MODE=1 (default OFF => no pilot behaviour).
// Pure config module: no network, no storage. Pilot mode only labels/tags; it never changes sales logic.
export const pilotEnabled = (env) => !!env && String(env.NOVA_PILOT_MODE) === '1';

export const PILOT_CONFIG = {
  branch_ar: 'فرع السوسي',
  shifts: ['morning', 'evening', 'night'],
  metrics: ['sale_seconds', 'errors_per_shift', 'stock_mismatches', 'receipts_reprinted', 'staff_score'],
  severities: ['blocker', 'major', 'minor', 'cosmetic'],
};

export function pilotInfo(env) {
  if (!pilotEnabled(env)) return { enabled: false };
  return { enabled: true, ...PILOT_CONFIG };
}

// Validate a defect-log entry (docs/qa/PILOT_STORE_KIT.md template). Arabic message + stable code.
export function validateDefect(d, requestId = null) {
  const bad = (code, message_ar) => ({ ok: false, code, message_ar, requestId });
  if (!d || typeof d !== 'object') return bad('PILOT_BAD_DEFECT', 'بيانات العيب غير صالحة.');
  if (!PILOT_CONFIG.severities.includes(d.severity)) return bad('PILOT_BAD_SEVERITY', 'درجة الخطورة غير صالحة.');
  if (!PILOT_CONFIG.shifts.includes(d.shift)) return bad('PILOT_BAD_SHIFT', 'الوردية غير صالحة.');
  if (!String(d.title || '').trim()) return bad('PILOT_BAD_TITLE', 'عنوان العيب مطلوب.');
  return { ok: true };
}
