import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const k = createRequire(import.meta.url)('../../learn-kit.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const rec = (taskId, o = {}) => ({ taskId, steps: k.TASKS.find(x => x.id === taskId).target, errors: 0, minutes: 5, ...o });

t('path covers search, sell, return, receive; steps match targets', () => {
  assert.deepEqual(k.TASKS.map(x => x.id), ['search', 'sell', 'return', 'receive']);
  for (const x of k.TASKS) assert.equal(x.steps.length, x.target);
});
t('clean task passes; extra steps/errors/help fail', () => {
  assert.equal(k.evaluateTask(rec('sell')).pass, true);
  assert.equal(k.evaluateTask(rec('sell', { steps: 7 })).extraSteps, 2);
  assert.equal(k.evaluateTask(rec('sell', { errors: 1 })).pass, false);
  assert.equal(k.evaluateTask(rec('sell', { helped: true })).pass, false);
});
t('invalid input throws', () => {
  assert.throws(() => k.evaluateTask({ taskId: 'x', steps: 1 }), /unknown-task/);
  assert.throws(() => k.evaluateTask({ taskId: 'sell', steps: -1 }), /bad-numbers/);
});
t('session passes only with all tasks, <=30 min, unassisted', () => {
  const all = k.TASKS.map(x => rec(x.id, { minutes: 7 }));
  assert.equal(k.summarize(all).pass, true);
  assert.equal(k.summarize(all.slice(1)).pass, false);
  assert.deepEqual(k.summarize(all.slice(1)).missing, ['search']);
  assert.equal(k.summarize(k.TASKS.map(x => rec(x.id, { minutes: 8 }))).withinLimit, false);
  assert.equal(k.summarize([...all.slice(1), rec('search', { helped: true })]).pass, false);
});
t('summary totals errors and steps', () => {
  const s = k.summarize(k.TASKS.map(x => rec(x.id, { errors: 1 })));
  assert.equal(s.totalErrors, 4); assert.equal(s.totalSteps, 17);
});
t('tablet checklist needs every item ticked', () => {
  assert.equal(k.checklist().length, k.TABLET.length);
  const d = {}; k.TABLET.forEach((_, i) => { d[i + 1] = true; });
  assert.equal(k.accepted(d), true);
  d[3] = false; assert.equal(k.accepted(d), false);
  assert.equal(k.accepted(), false);
});
console.log(n + ' tests passed');
