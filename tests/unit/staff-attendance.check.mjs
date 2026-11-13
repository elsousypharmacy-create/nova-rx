import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStaff, createMockFingerprint, cairoDate, cairoToMs } = require('../../staff-attendance.js');

const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; };
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
let T = 0;
const mk = (s = mem()) => createStaff(s, 'k', { now: () => T });

// Cairo time: winter UTC+2, summer UTC+3 (DST)
assert.equal(cairoToMs('2026-01-10', '09:00'), Date.UTC(2026, 0, 10, 7, 0));
assert.equal(cairoToMs('2026-07-10', '09:00'), Date.UTC(2026, 6, 10, 6, 0));
assert.equal(cairoDate(Date.UTC(2026, 0, 10, 22, 30)), '2026-01-11'); // 00:30 Cairo next day
assert.equal(code(() => cairoToMs('2026-1-1', '09:00')), 'bad-date');
assert.equal(code(() => cairoToMs('2026-01-01', '25:00')), 'bad-time');

// stable ids
const s = mem();
let st = mk(s);
const a = st.addEmployee({ name: 'أحمد', role: 'pharmacist', fingerprintId: 'fp1' });
const b = st.addEmployee({ name: 'منى', role: 'manager' });
assert.deepEqual([a.id, b.id], ['emp-0001', 'emp-0002']);
st = mk(s); // reload persists
assert.equal(st.addEmployee({ name: 'x' }).id, 'emp-0003');
assert.equal(code(() => st.addEmployee({ name: 'y', fingerprintId: 'fp1' })), 'duplicate-fingerprint');
assert.equal(code(() => st.addEmployee({ name: ' ' })), 'bad-name');
assert.equal(code(() => st.clockIn('emp-9')), 'unknown-employee');

// day: shift 09:00-17:00 Cairo on 2026-01-10; in 09:25, out 16:30
const D = '2026-01-10';
st.setShift(a.id, D, '09:00', '17:00');
T = cairoToMs(D, '09:25');
const p = st.clockIn(a.id);
assert.equal(p.date, D);
assert.equal(code(() => st.clockIn(a.id)), 'already-clocked-in');
assert.equal(st.dayReport(a.id, D).status, 'incomplete');
T = cairoToMs(D, '16:30');
st.clockOut(a.id);
assert.equal(code(() => st.clockOut(a.id)), 'not-clocked-in');
let r = st.dayReport(a.id, D);
assert.equal(r.workedMinutes, 425);
assert.equal(r.scheduledMinutes, 480);
assert.equal(r.varianceMinutes, -55);
assert.equal(r.lateMinutes, 25);
assert.equal(r.earlyLeaveMinutes, 30);
assert.equal(r.status, 'variance');

// within grace is not late; overtime counted
const D2 = '2026-01-11';
st.setShift(b.id, D2, '09:00', '17:00');
T = cairoToMs(D2, '09:05'); st.clockIn(b.id);
T = cairoToMs(D2, '18:00'); st.clockOut(b.id);
r = st.dayReport(b.id, D2);
assert.equal([r.lateMinutes, r.overtimeMinutes, r.status].join(), '0,60,ok');

// absent & no-shift
st.setShift(b.id, '2026-01-12', '09:00', '17:00');
assert.equal(st.dayReport(b.id, '2026-01-12').status, 'absent');
assert.equal(st.dayReport(b.id, '2026-01-20').status, 'no-shift');

// overnight shift
const sh = st.setShift(a.id, '2026-01-13', '22:00', '06:00');
assert.equal((sh.endMs - sh.startMs) / 3600000, 8);

// corrections policy
const c = st.requestCorrection(p.id, { reason: 'forgot fingerprint', requestedBy: a.id, inMs: cairoToMs(D, '09:02') });
assert.equal(code(() => st.requestCorrection(p.id, { requestedBy: a.id, inMs: 1 })), 'reason-required');
assert.equal(code(() => st.requestCorrection(p.id, { reason: 'r', requestedBy: a.id })), 'empty-correction');
assert.equal(code(() => st.requestCorrection(p.id, { reason: 'r', requestedBy: a.id, inMs: cairoToMs(D, '23:00') })), 'bad-range');
assert.equal(st.dayReport(a.id, D).lateMinutes, 25, 'pending correction has no effect');
assert.equal(code(() => st.approveCorrection(c.id, { id: a.id, role: 'manager' })), 'self-approval');
assert.equal(code(() => st.approveCorrection(c.id, { id: b.id, role: 'staff' })), 'approver-not-allowed');
st.approveCorrection(c.id, { id: b.id, role: 'manager' });
assert.equal(code(() => st.rejectCorrection(c.id, { id: b.id, role: 'manager' })), 'already-decided');
r = st.dayReport(a.id, D);
assert.equal([r.lateMinutes, r.workedMinutes].join(), '0,448');
assert.equal(JSON.parse(s.raw.k).punches[0].inMs, p.inMs, 'original punch preserved');

// mock fingerprint
const fp = createMockFingerprint(st);
assert.equal(code(() => fp.scan('nope')), 'fingerprint-unknown');
T = cairoToMs('2026-01-14', '09:00');
assert.equal(fp.punch('fp1').type, 'in');
T = cairoToMs('2026-01-14', '17:00');
assert.equal(fp.punch('fp1').type, 'out');
st.deactivate(a.id);
assert.equal(code(() => fp.scan('fp1')), 'fingerprint-unknown');
assert.equal(code(() => mk({ getItem: () => '{bad', setItem() {} }).listEmployees()), 'staff-corrupt');
console.log('staff-attendance checks passed');
