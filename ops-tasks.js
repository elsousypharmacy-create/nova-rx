/* NOVA Rx — OPS-04 local tasks and approvals (pure logic, no DOM, no network, frontend/local only).
   Task types: discount, adjustment, shortage, delay. Each has owner, due date, reason and an approval path
   (ordered roles). Every step is written to the task's own audit trail; a task cannot be closed while
   the trail is incomplete (missing approvals, missing close note, or a broken trail). The creator cannot
   approve their own task. Works as <script> (window.NovaOpsTasks) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var PATHS = { discount: ['manager'], adjustment: ['manager', 'owner'], shortage: ['manager'], delay: ['manager'] };
  var LABELS = { discount: 'خصم', adjustment: 'تسوية', shortage: 'نقص', delay: 'تأخير' };
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function createTasks(storage, key, opts) {
    key = key || 'nova.opsTasks';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { tasks: [] };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('tasks-corrupt'); }
      if (!s || !Array.isArray(s.tasks)) fail('tasks-corrupt');
      return s;
    }
    function save(s) { try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('tasks-write-failed'); } }
    function find(s, id) {
      for (var i = 0; i < s.tasks.length; i++) if (s.tasks[i].id === id) return s.tasks[i];
      fail('task-not-found');
    }
    function log(t, actor, action, note) { t.trail.push({ seq: t.trail.length + 1, at: now(), actor: actor, action: action, note: note || '' }); }

    function create(input) {
      if (!input || typeof input !== 'object') fail('bad-task');
      if (!PATHS[input.type]) fail('bad-type');
      var due = Number(input.dueAt);
      if (!isFinite(due) || due <= 0) fail('due-date-required');
      var s = load();
      var t = {
        id: 't' + (s.tasks.length + 1), type: input.type, label: LABELS[input.type],
        owner: str(input.owner, 'owner-required'), createdBy: str(input.createdBy || input.owner, 'actor-required'),
        reason: str(input.reason, 'reason-required'), dueAt: due,
        path: PATHS[input.type].slice(), approvals: [], status: 'open', trail: []
      };
      log(t, t.createdBy, 'created', t.reason);
      s.tasks.push(t); save(s);
      return copy(t);
    }
    function nextRole(t) { return t.path[t.approvals.length] || null; }
    function approve(id, who) {
      who = who || {};
      var actor = str(who.actor, 'actor-required'), role = str(who.role, 'role-required');
      var s = load(), t = find(s, id);
      if (t.status !== 'open') fail('task-not-open');
      var need = nextRole(t);
      if (!need) fail('already-approved');
      if (role !== need) fail('wrong-approver-role');
      if (actor === t.createdBy || actor === t.owner) fail('self-approval-blocked');
      t.approvals.push({ role: role, actor: actor, at: now() });
      log(t, actor, 'approved', role);
      save(s); return copy(t);
    }
    function reject(id, who, reason) {
      who = who || {};
      var actor = str(who.actor, 'actor-required'), role = str(who.role, 'role-required');
      var s = load(), t = find(s, id);
      if (t.status !== 'open') fail('task-not-open');
      if (role !== nextRole(t)) fail('wrong-approver-role');
      t.status = 'rejected';
      log(t, actor, 'rejected', str(reason, 'reason-required'));
      save(s); return copy(t);
    }
    // Why a task cannot be closed (empty list = complete).
    function blockers(t) {
      var b = [];
      if (t.approvals.length < t.path.length) b.push('approval-missing:' + t.path[t.approvals.length]);
      if (!t.trail.length || t.trail[0].action !== 'created') b.push('trail-incomplete');
      for (var i = 0; i < t.trail.length; i++) if (t.trail[i].seq !== i + 1) { b.push('trail-broken'); break; }
      return b;
    }
    function close(id, who, note) {
      who = who || {};
      var actor = str(who.actor, 'actor-required');
      var s = load(), t = find(s, id);
      if (t.status !== 'open') fail('task-not-open');
      var b = blockers(t);
      if (b.length) { var e = new Error('close-blocked'); e.code = 'close-blocked'; e.blockers = b; throw e; }
      t.status = 'closed';
      log(t, actor, 'closed', str(note, 'close-note-required'));
      save(s); return copy(t);
    }
    function get(id) { return copy(find(load(), id)); }
    function list(filter) {
      var rows = load().tasks;
      if (filter) rows = rows.filter(function (t) { return Object.keys(filter).every(function (k) { return t[k] === filter[k]; }); });
      return copy(rows);
    }
    function overdue() {
      var n = now();
      return copy(load().tasks.filter(function (t) { return t.status === 'open' && t.dueAt < n; }));
    }
    return { create: create, approve: approve, reject: reject, close: close, get: get, list: list, overdue: overdue, blockers: function (id) { return blockers(find(load(), id)); } };
  }

  var api = { createTasks: createTasks, PATHS: PATHS, LABELS: LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaOpsTasks = api;
})(typeof window !== 'undefined' ? window : globalThis);
