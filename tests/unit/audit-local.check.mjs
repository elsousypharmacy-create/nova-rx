import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createAudit } = createRequire(import.meta.url)('../../audit-local.js');
function mem() { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const e = (o = {}) => ({ actor: 'amal', action: 'sale.void', category: 'financial', entity: { type: 'sale', id: 's1' }, before: { total: 10 }, after: { total: 0 }, reason: 'خطأ في الإدخال', requestId: 'r1', ...o });

t('append records actor, time, before/after, reason, requestId', () => {
  const a = createAudit(mem(), 'k', { now: () => 5 });
  const r = a.append(e());
  assert.equal(r.seq, 1); assert.equal(r.at, 5); assert.equal(r.actor, 'amal'); assert.equal(r.reason, 'خطأ في الإدخال');
  assert.deepEqual(r.before, { total: 10 }); assert.deepEqual(r.after, { total: 0 }); assert.equal(r.requestId, 'r1'); assert.equal(r.financial, true);
});
t('required fields enforced', () => {
  const a = createAudit(mem());
  for (const [k, c] of [['actor', 'actor-required'], ['action', 'action-required'], ['reason', 'reason-required'], ['requestId', 'request-id-required']])
    assert.throws(() => a.append(e({ [k]: '' })), { code: c });
  assert.equal(a.list().length, 0);
});
t('append-only: remove/prune throw, rows intact incl. financial', () => {
  const a = createAudit(mem());
  a.append(e()); a.append(e({ category: 'general', requestId: 'r2' }));
  assert.throws(() => a.remove(1), { code: 'audit-append-only' });
  assert.throws(() => a.prune(), { code: 'audit-append-only' });
  assert.equal(a.list().length, 2);
  assert.equal(a.list({ financial: true }).length, 1);
});
t('secrets and sensitive fields redacted (before/after/entity/reason)', () => {
  const s = mem(); const a = createAudit(s);
  a.append(e({ before: { password: 'p1', nested: { apiKey: 'k1', pin: '1234', ok: 1 } }, after: { Authorization: 'Bearer abc.def', list: [{ token: 't1' }] }, reason: 'reset token=abc123 done' }));
  const raw = s.m.k || s.m['nova.audit'];
  for (const x of ['p1', 'k1', '1234', 'abc.def', 't1', 'abc123']) assert.ok(!raw.includes(x), x + ' leaked');
  assert.equal(a.list()[0].before.nested.ok, 1);
  assert.equal(a.list()[0].before.password, '[REDACTED]');
});
t('words merely containing "pin" kept', () => {
  const a = createAudit(mem());
  assert.equal(a.append(e({ after: { shipping: 'Cairo', mapping: 1 } })).after.shipping, 'Cairo');
});
t('hash chain detects tampering and deletion', () => {
  const s = mem(); const a = createAudit(s, 'k');
  a.append(e()); a.append(e({ requestId: 'r2' })); a.append(e({ requestId: 'r3' }));
  assert.deepEqual(a.verify(), { ok: true, count: 3 });
  const d = JSON.parse(s.m.k); d.rows[1].after = { total: 99 }; s.m.k = JSON.stringify(d);
  assert.deepEqual(a.verify(), { ok: false, brokenAt: 2 });
  const d2 = JSON.parse(s.m.k); d2.rows.splice(0, 1); s.m.k = JSON.stringify(d2);
  assert.equal(a.verify().ok, false);
});
t('corrupt storage fails closed; write failure surfaces', () => {
  const s = mem(); s.m.k = '{bad'; assert.throws(() => createAudit(s, 'k').list(), { code: 'audit-corrupt' });
  const w = createAudit({ getItem: () => null, setItem() { throw new Error('x'); } });
  assert.throws(() => w.append(e()), { code: 'audit-write-failed' });
});
t('returned rows are copies', () => {
  const a = createAudit(mem()); a.append(e()); a.list()[0].actor = 'evil'; assert.equal(a.list()[0].actor, 'amal');
});
console.log(n + ' passed');
