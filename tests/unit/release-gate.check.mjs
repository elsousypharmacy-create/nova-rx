import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const g = createRequire(import.meta.url)('../../release-gate.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const drill = { passed: true, evidence: 'log-1' };
const good = () => ({ ciGreen: true, openIssues: [{ severity: 'P2' }],
  drills: { migration: drill, rollback: drill, restore: drill },
  slots: { sha: 'abc1234', ciRun: 'run-1', viewport: 'tablet ok', printer: 'ok', ownerApproval: 'Ahmed' } });
t('all evidence passes', () => assert.deepEqual(g.evaluate(good()), { ready: true, problems: [] }));
t('green CI alone is not enough', () => { assert.equal(g.evaluate({ ciGreen: true }).ready, false); });
t('open P0/P1 blocks', () => { const i = good(); i.openIssues.push({ severity: 'p1' }); assert.equal(g.evaluate(i).ready, false); });
t('untried or evidence-less drill blocks', () => {
  const i = good(); i.drills.restore = { passed: true, evidence: '' }; assert.equal(g.evaluate(i).ready, false);
  i.drills.restore = { passed: false, evidence: 'x' }; assert.equal(g.evaluate(i).ready, false);
});
t('empty slot or bad SHA blocks', () => {
  const i = good(); i.slots.printer = ' '; assert.equal(g.evaluate(i).ready, false);
  const j = good(); j.slots.sha = 'zzz'; assert.equal(g.evaluate(j).ready, false);
});
t('CI not green blocks', () => { const i = good(); i.ciGreen = false; assert.equal(g.evaluate(i).ready, false); });
t('null input safe', () => assert.equal(g.evaluate(null).ready, false));
console.log(n + ' passed');
