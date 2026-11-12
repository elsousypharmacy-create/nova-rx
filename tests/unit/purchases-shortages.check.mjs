import assert from 'node:assert/strict';
import { buildNeeds, mergeDuplicateLines } from '../../purchases-core.js';
const base = { id: '7', name: 'دواء', stock: 2, minStock: 4, idealStock: 10, dailySales: 1, observedDays: 7, leadTimeDays: 3 };
// duplicates (same id+unit) merge: stock and sales add, limits/lead time keep the larger
const m = mergeDuplicateLines([base, { ...base, stock: 3, dailySales: 2, minStock: 6, leadTimeDays: 5 }, { ...base, unit: 'strip' }]);
assert.equal(m.length, 2);
assert.deepEqual([m[0].stock, m[0].dailySales, m[0].minStock, m[0].leadTimeDays, m[0].mergedLines], [5, 3, 6, 5, 2]);
assert.equal(m[1].key, '7::strip');
assert.equal(mergeDuplicateLines([{ name: 'no id' }]).length, 0);
// merged needs: one row, quantity from the merged stock/sales (3*21=63 > 10; 63-5=58)
const need = buildNeeds([base, { ...base, stock: 3, dailySales: 2 }], { days: 21 });
assert.equal(need.length, 1); assert.equal(need[0].qty, 58); assert.equal(need[0].mergedLines, 2);
// shows sales rate and lead time
assert.equal(need[0].dailyRate, 3); assert.equal(need[0].leadTimeDays, 3);
assert.equal(buildNeeds([{ ...base, leadTimeDays: undefined }], { days: 21 })[0].leadTimeDays, null);
// every suggestion needs pharmacist confirmation
assert.ok(need.every(n => n.selected === false && n.suggested === true));
// per-item max is a hard cap, per-item min decides minimum mode
const key = '7::pack';
assert.equal(buildNeeds([base], { days: 21, limits: { [key]: { max: 12 } } })[0].qty, 10);
assert.equal(buildNeeds([base], { days: 21, limits: { [key]: { max: 2 } } }).length, 0);
assert.equal(buildNeeds([{ ...base, stock: 5 }], { days: 2, level: 'minimum' }).length, 0);
assert.equal(buildNeeds([{ ...base, stock: 5 }], { days: 2, level: 'minimum', limits: { [key]: { min: 8 } } }).length, 1);
console.log('PASS shortages: duplicates merge, min/max overrides, rate + lead time, confirmation required');
