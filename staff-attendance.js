/* NOVA Rx — OPS-01 staff and attendance (pure logic, no DOM, no network, frontend/local only).
   Stable local employee ids, per-date shifts, clock-in/out (manual or mocked fingerprint), worked hours and
   variances (late / early leave / overtime / absent) computed in Africa/Cairo time (DST-aware via Intl).
   Corrections policy: a correction needs a reason, a requester, and approval by a DIFFERENT manager/owner;
   original punches are never overwritten (append-only correction history).
   Works as <script> (window.NovaStaff) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var TZ = 'Africa/Cairo';
  var APPROVER_ROLES = Object.freeze(['owner', 'manager']);
  var METHODS = Object.freeze(['manual', 'fingerprint']);
  var GRACE_MIN = 10;

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function cairoParts(ms) {
    var p = {};
    fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
    return p;
  }
  function offsetMs(ms) {
    var p = cairoParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* Cairo calendar date 'YYYY-MM-DD' of an instant. */
  function cairoDate(ms) { var p = cairoParts(ms); return p.year + '-' + pad(p.month) + '-' + pad(p.day); }
  /* Instant (ms) of a Cairo wall-clock date + 'HH:MM'. */
  function cairoToMs(date, hhmm, addDays) {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
    if (!d) fail('bad-date');
    if (!t) fail('bad-time');
    var wall = Date.UTC(+d[1], +d[2] - 1, +d[3] + (addDays || 0), +t[1], +t[2]);
    var guess = wall - offsetMs(wall);
    return wall - offsetMs(guess);
  }

  function createStaff(storage, key, opts) {
    key = key || 'nova.staff';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };

    function load() {
      var raw = storage.getItem(key), s;
      if (!raw) return { seq: 0, employees: [], shifts: [], punches: [], corrections: [] };
      try { s = JSON.parse(raw); } catch (e) { fail('staff-corrupt'); }
      if (!s || !Array.isArray(s.employees) || !Array.isArray(s.shifts) || !Array.isArray(s.punches) ||
        !Array.isArray(s.corrections)) fail('staff-corrupt');
      return s;
    }
    function save(s) { storage.setItem(key, JSON.stringify(s)); }
    function emp(s, id) {
      var e = s.employees.filter(function (x) { return x.id === id; })[0];
      if (!e) fail('unknown-employee');
      return e;
    }
    function active(s, id) { var e = emp(s, id); if (!e.active) fail('employee-inactive'); return e; }

    function addEmployee(input) {
      var s = load();
      var name = str(input && input.name, 'bad-name');
      var fp = input.fingerprintId == null ? null : str(String(input.fingerprintId), 'bad-fingerprint');
      if (fp && s.employees.some(function (e) { return e.fingerprintId === fp; })) fail('duplicate-fingerprint');
      s.seq += 1;
      var e = { id: 'emp-' + String(s.seq).padStart(4, '0'), name: name, role: str(input.role || 'staff', 'bad-role'),
        fingerprintId: fp, active: true, createdAt: now() };
      s.employees.push(e);
      save(s);
      return copy(e);
    }
    function deactivate(id) { var s = load(); emp(s, id).active = false; save(s); }
    function listEmployees() { return copy(load().employees); }

    /* One shift per employee per Cairo date; end <= start means the shift ends next day. */
    function setShift(empId, date, start, end) {
      var s = load(); active(s, empId);
      var st = cairoToMs(date, start), en = cairoToMs(date, end);
      if (en <= st) en = cairoToMs(date, end, 1);
      var sh = { empId: empId, date: date, start: start, end: end, startMs: st, endMs: en };
      s.shifts = s.shifts.filter(function (x) { return !(x.empId === empId && x.date === date); });
      s.shifts.push(sh);
      save(s);
      return copy(sh);
    }

    function openPunch(s, empId) {
      return s.punches.filter(function (p) { return p.empId === empId && p.outMs == null; })[0];
    }
    function clockIn(empId, o) {
      o = o || {};
      var s = load(); active(s, empId);
      var method = o.method || 'manual';
      if (METHODS.indexOf(method) < 0) fail('bad-method');
      if (openPunch(s, empId)) fail('already-clocked-in');
      var t = now();
      var p = { id: 'p-' + (s.punches.length + 1), empId: empId, date: cairoDate(t), inMs: t, outMs: null,
        inMethod: method, outMethod: null };
      s.punches.push(p);
      save(s);
      return copy(p);
    }
    function clockOut(empId, o) {
      o = o || {};
      var s = load(); active(s, empId);
      var method = o.method || 'manual';
      if (METHODS.indexOf(method) < 0) fail('bad-method');
      var p = openPunch(s, empId);
      if (!p) fail('not-clocked-in');
      p.outMs = now(); p.outMethod = method;
      save(s);
      return copy(p);
    }

    /* Effective punch times = original with latest approved correction applied. */
    function effective(s, p) {
      var r = { inMs: p.inMs, outMs: p.outMs };
      s.corrections.forEach(function (c) {
        if (c.punchId === p.id && c.status === 'approved') {
          if (c.inMs != null) r.inMs = c.inMs;
          if (c.outMs != null) r.outMs = c.outMs;
        }
      });
      return r;
    }

    /* Day report (Cairo date): worked minutes and variances against the scheduled shift. */
    function dayReport(empId, date) {
      var s = load(); emp(s, empId);
      var shift = s.shifts.filter(function (x) { return x.empId === empId && x.date === date; })[0] || null;
      var worked = 0, first = null, last = null, open = false;
      s.punches.filter(function (p) { return p.empId === empId && p.date === date; }).forEach(function (p) {
        var e = effective(s, p);
        if (e.outMs == null) { open = true; return; }
        worked += Math.max(0, Math.round((e.outMs - e.inMs) / 60000));
        if (first == null || e.inMs < first) first = e.inMs;
        if (last == null || e.outMs > last) last = e.outMs;
      });
      var r = { empId: empId, date: date, timezone: TZ, scheduledMinutes: 0, workedMinutes: worked, lateMinutes: 0,
        earlyLeaveMinutes: 0, overtimeMinutes: 0, varianceMinutes: worked, status: 'no-shift', open: open };
      if (!shift) return r;
      r.scheduledMinutes = Math.round((shift.endMs - shift.startMs) / 60000);
      r.varianceMinutes = worked - r.scheduledMinutes;
      if (first == null) { r.status = open ? 'incomplete' : 'absent'; return r; }
      var late = Math.round((first - shift.startMs) / 60000);
      r.lateMinutes = late > GRACE_MIN ? late : 0;
      r.earlyLeaveMinutes = Math.max(0, Math.round((shift.endMs - last) / 60000));
      r.overtimeMinutes = Math.max(0, Math.round((last - shift.endMs) / 60000));
      r.status = open ? 'incomplete' : (r.lateMinutes || r.earlyLeaveMinutes ? 'variance' : 'ok');
      return r;
    }

    /* Correction policy: requester != approver; approver must be owner/manager; reason mandatory. */
    function requestCorrection(punchId, o) {
      var s = load();
      var p = s.punches.filter(function (x) { return x.id === punchId; })[0];
      if (!p) fail('unknown-punch');
      var reason = str(o && o.reason, 'reason-required');
      var by = str(o.requestedBy, 'requester-required');
      if (o.inMs == null && o.outMs == null) fail('empty-correction');
      [o.inMs, o.outMs].forEach(function (v) { if (v != null && (typeof v !== 'number' || !isFinite(v))) fail('bad-time'); });
      var e = effective(s, p);
      var ni = o.inMs != null ? o.inMs : e.inMs, no = o.outMs != null ? o.outMs : e.outMs;
      if (no != null && no <= ni) fail('bad-range');
      var c = { id: 'c-' + (s.corrections.length + 1), punchId: punchId, reason: reason, requestedBy: by,
        inMs: o.inMs == null ? null : o.inMs, outMs: o.outMs == null ? null : o.outMs, status: 'pending',
        requestedAt: now(), decidedBy: null, decidedAt: null };
      s.corrections.push(c);
      save(s);
      return copy(c);
    }
    function decide(corrId, approver, approved) {
      var s = load();
      var c = s.corrections.filter(function (x) { return x.id === corrId; })[0];
      if (!c) fail('unknown-correction');
      if (c.status !== 'pending') fail('already-decided');
      var who = str(approver && approver.id, 'approver-required');
      if (APPROVER_ROLES.indexOf(approver.role) < 0) fail('approver-not-allowed');
      if (who === c.requestedBy) fail('self-approval');
      c.status = approved ? 'approved' : 'rejected'; c.decidedBy = who; c.decidedAt = now();
      save(s);
      return copy(c);
    }
    function listCorrections() { return copy(load().corrections); }

    return { addEmployee: addEmployee, deactivate: deactivate, listEmployees: listEmployees, setShift: setShift,
      clockIn: clockIn, clockOut: clockOut, dayReport: dayReport, requestCorrection: requestCorrection,
      approveCorrection: function (id, a) { return decide(id, a, true); },
      rejectCorrection: function (id, a) { return decide(id, a, false); }, listCorrections: listCorrections };
  }

  /* Mock fingerprint reader: enrolled template id -> employee id lookup; real hardware plugs in later. */
  function createMockFingerprint(staff) {
    return {
      scan: function (templateId) {
        var e = staff.listEmployees().filter(function (x) { return x.fingerprintId === templateId && x.active; })[0];
        if (!e) fail('fingerprint-unknown');
        return e.id;
      },
      punch: function (templateId) {
        var id = this.scan(templateId);
        try { return { type: 'in', punch: staff.clockIn(id, { method: 'fingerprint' }) }; }
        catch (err) { if (err.code !== 'already-clocked-in') throw err; }
        return { type: 'out', punch: staff.clockOut(id, { method: 'fingerprint' }) };
      }
    };
  }

  var api = { createStaff: createStaff, createMockFingerprint: createMockFingerprint, cairoDate: cairoDate,
    cairoToMs: cairoToMs, TIMEZONE: TZ, APPROVER_ROLES: APPROVER_ROLES, METHODS: METHODS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaStaff = api;
})(typeof window !== 'undefined' ? window : globalThis);
