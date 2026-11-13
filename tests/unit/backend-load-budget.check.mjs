import assert from 'node:assert/strict';
import { runLoad, percentile, summarize } from '../../tools/backend/load-sim.mjs';
import { syncEnabled } from '../../backend/src/sync.js';

assert.equal(percentile([1, 2, 3, 4], 50), 2);
assert.equal(summarize([5, 1, 3]).max, 5);
assert.equal(syncEnabled({ DB: {} }), false, 'flag default OFF');

const BUDGET = { push: 150, pull: 100 };
const r = await runLoad({ requests: 30, batch: 20 });
assert.equal(r.push.errors, 0); assert.equal(r.pull.errors, 0);
assert.equal(r.push.count, 30);
assert.ok(r.push.p95 <= BUDGET.push, `push p95 ${r.push.p95}ms > ${BUDGET.push}`);
assert.ok(r.pull.p95 <= BUDGET.pull, `pull p95 ${r.pull.p95}ms > ${BUDGET.pull}`);
console.log('backend-load-budget OK', JSON.stringify(r));
