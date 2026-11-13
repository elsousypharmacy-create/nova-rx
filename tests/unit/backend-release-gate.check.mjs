import assert from 'node:assert/strict';
import { evaluateBackendRelease, backendReleaseGate, releaseGateEnabled } from '../../backend/src/release-gate.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const d = { passed: true, evidence: 'log' };
const good = () => ({ ciGreen: true, ciRun: 'run-1', sha: 'abc1234', previousVersion: 'v-prev', openIssues: [{ severity: 'P2' }], drills: { migration: d, restore: d, rollback: d } });
const codes = (x) => evaluateBackendRelease(x).problems.map((q) => q.code);
t('flag default OFF', () => {
  assert.equal(releaseGateEnabled({}), false); assert.equal(releaseGateEnabled(undefined), false);
  assert.deepEqual(backendReleaseGate({}, good()), { enabled: false, ready: false, problems: [] });
  assert.equal(backendReleaseGate({ NOVA_RELEASE_GATE: '1' }, good()).ready, true);
});
t('full evidence passes', () => assert.deepEqual(evaluateBackendRelease(good()), { ready: true, problems: [] }));
t('open P0/P1 blocks', () => { const i = good(); i.openIssues.push({ severity: 'p0' }); assert.deepEqual(codes(i), ['GATE_OPEN_P0P1']); });
for (const k of ['migration', 'restore', 'rollback']) t(k + ' drill missing/failed/no evidence blocks', () => {
  for (const v of [undefined, { passed: false, evidence: 'x' }, { passed: true, evidence: ' ' }]) { const i = good(); i.drills[k] = v; assert.deepEqual(codes(i), ['GATE_DRILL_' + k.toUpperCase()]); }
});
t('rollback target required', () => { const i = good(); i.previousVersion = ''; assert.deepEqual(codes(i), ['GATE_ROLLBACK_TARGET']); });
t('bad sha / CI blocks', () => { const i = good(); i.sha = 'zz'; i.ciGreen = false; assert.deepEqual(codes(i), ['GATE_BAD_SHA', 'GATE_CI']); });
t('null input safe, Arabic messages', () => { const r = evaluateBackendRelease(null); assert.equal(r.ready, false); assert.ok(r.problems.every((q) => /[؀-ۿ]/.test(q.message_ar))); });
console.log(n + ' passed');
