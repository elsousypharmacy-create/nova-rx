import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createTasks } = createRequire(import.meta.url)('../../ops-tasks.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const inp = (o = {}) => ({ type: 'discount', owner: 'amal', reason: 'عميل دائم', dueAt: 2000, ...o });
const mgr = { actor: 'sara', role: 'manager' };

t('create requires type, owner, reason, due date', () => {
  const k = createTasks(mem(), 'k', { now: () => 1000 });
  assert.throws(() => k.create(inp({ type: 'x' })), { code: 'bad-type' });
  assert.throws(() => k.create(inp({ owner: '' })), { code: 'owner-required' });
  assert.throws(() => k.create(inp({ reason: ' ' })), { code: 'reason-required' });
  assert.throws(() => k.create(inp({ dueAt: 0 })), { code: 'due-date-required' });
  const r = k.create(inp({ type: 'adjustment' }));
  assert.deepEqual(r.path, ['manager', 'owner']); assert.equal(r.label, 'تسوية'); assert.equal(r.trail[0].action, 'created');
});
t('close blocked until every approval step is done', () => {
  const k = createTasks(mem(), 'k', { now: () => 1000 });
  const a = k.create(inp({ type: 'adjustment' }));
  assert.throws(() => k.close(a.id, { actor: 'amal' }, 'تم'), e => e.code === 'close-blocked' && e.blockers[0] === 'approval-missing:manager');
  k.approve(a.id, mgr);
  assert.throws(() => k.close(a.id, { actor: 'amal' }, 'تم'), e => e.blockers[0] === 'approval-missing:owner');
  k.approve(a.id, { actor: 'hany', role: 'owner' });
  assert.throws(() => k.close(a.id, { actor: 'amal' }, ''), { code: 'close-note-required' });
  const c = k.close(a.id, { actor: 'amal' }, 'تم');
  assert.equal(c.status, 'closed'); assert.equal(c.trail.length, 4);
});
t('approval order, role and self-approval enforced', () => {
  const k = createTasks(mem(), 'k');
  const a = k.create(inp({ type: 'adjustment' }));
  assert.throws(() => k.approve(a.id, { actor: 'hany', role: 'owner' }), { code: 'wrong-approver-role' });
  assert.throws(() => k.approve(a.id, { actor: 'amal', role: 'manager' }), { code: 'self-approval-blocked' });
  assert.throws(() => k.approve(a.id, { actor: '', role: 'manager' }), { code: 'actor-required' });
});
t('rejected and closed tasks are final', () => {
  const k = createTasks(mem(), 'k');
  const a = k.create(inp({ type: 'shortage' })), b = k.create(inp({ type: 'delay' }));
  assert.throws(() => k.reject(a.id, mgr, ''), { code: 'reason-required' });
  assert.equal(k.reject(a.id, mgr, 'غير مبرر').status, 'rejected');
  assert.throws(() => k.close(a.id, { actor: 'amal' }, 'x'), { code: 'task-not-open' });
  k.approve(b.id, mgr); k.close(b.id, { actor: 'amal' }, 'تم');
  assert.throws(() => k.approve(b.id, mgr), { code: 'task-not-open' });
});
t('tampered trail blocks close; overdue lists open late tasks; persistence', () => {
  const s = mem(); let now = 1000;
  const k = createTasks(s, 'k', { now: () => now });
  const a = k.create(inp()); k.approve(a.id, mgr);
  const raw = JSON.parse(s.getItem('k')); raw.tasks[0].trail[1].seq = 9; s.setItem('k', JSON.stringify(raw));
  assert.throws(() => k.close(a.id, { actor: 'amal' }, 'x'), e => e.blockers.includes('trail-broken'));
  now = 3000; assert.equal(k.overdue().length, 1);
  assert.equal(createTasks(s, 'k').list({ type: 'discount' }).length, 1);
  s.setItem('k', '{bad'); assert.throws(() => k.list(), { code: 'tasks-corrupt' });
});
console.log(n + ' passed');
