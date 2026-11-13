import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { computeEmployeeKpis, SOURCES, DENOMINATORS } = createRequire(import.meta.url)('../../ops-kpis.js');

const H = 3600000, P = { from: 0, to: 10 * H };
const data = {
  sales: [
    { employeeId: 'a', total: 100, refunded: 10, at: H },
    { employeeId: 'a', total: 50, at: 2 * H },
    { employeeId: 'a', total: 999, at: 3 * H, voided: true },
    { employeeId: 'a', total: 5, at: 11 * H },
    { employeeId: 'b', total: 70, at: H },
    { total: 30, at: H }
  ],
  visits: [{ employeeId: 'a', at: H }, { employeeId: 'b', at: H }, { at: H }],
  customers: [{ createdBy: 'a', createdAt: H }, { createdAt: H }, { createdBy: 'a', createdAt: 20 * H }],
  clock: [
    { employeeId: 'a', inAt: 0, outAt: 2 * H },
    { employeeId: 'a', inAt: 9 * H, outAt: 12 * H },
    { employeeId: 'a', inAt: 5 * H },
    { employeeId: 'b', inAt: 0, outAt: H }
  ]
};
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('KPIs for employee a with explicit attribution only', () => {
  const r = computeEmployeeKpis(data, 'a', P).kpis;
  assert.deepEqual(r, { sales: 150, net: 140, invoices: 2, average: 70, visits: 1, newCustomers: 1, clockedMinutes: 180, salesPerClockedHour: 46.67 });
});
t('unattributed records are counted, never assigned; open clock not guessed', () => {
  const u = computeEmployeeKpis(data, 'a', P).unattributed;
  assert.deepEqual(u, { sales: 1, visits: 1, newCustomers: 1, clock: 0, openClock: 1 });
});
t('zero denominators give null, not 0', () => {
  const r = computeEmployeeKpis({}, 'z', P).kpis;
  assert.equal(r.average, null); assert.equal(r.salesPerClockedHour, null); assert.equal(r.invoices, 0);
});
t('every KPI has source and denominator', () => {
  const r = computeEmployeeKpis(data, 'a', P);
  for (const k of ['sales', 'net', 'invoices', 'average', 'visits', 'newCustomers', 'clockedMinutes']) {
    assert.ok(SOURCES[k] && DENOMINATORS[k] && r.sources[k] && r.denominators[k], k);
  }
});
t('invalid input rejected', () => {
  assert.throws(() => computeEmployeeKpis(data, '', P), { code: 'bad-employee' });
  assert.throws(() => computeEmployeeKpis(data, 'a', { from: 5, to: 5 }), { code: 'bad-period' });
});
console.log(n + ' passed');
