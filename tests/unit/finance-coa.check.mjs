import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createCoa } = createRequire(import.meta.url)('../../finance-coa.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
function setup(s = mem()) {
  const c = createCoa(s, 'k', { now: () => 1700000000000 });
  c.setBaseCurrency('egp');
  c.addAccount({ code: '1000', name: 'Assets', type: 'asset' });
  c.addAccount({ code: '1100', name: 'Cash', type: 'asset', parent: '1000' });
  c.addAccount({ code: '2000', name: 'Payables', type: 'liability' });
  c.addAccount({ code: '3000', name: 'Equity', type: 'equity' });
  c.addAccount({ code: '4000', name: 'Sales', type: 'revenue' });
  c.addBranch({ id: 'b1', name: 'Main' }); c.addCostCenter({ id: 'cc1', name: 'Pharmacy' });
  c.addPeriod({ id: '2026-01', start: '2026-01-01', end: '2026-01-31' });
  return c;
}
const lines = [{ account: '1100', debit: 1000, costCenter: 'cc1' }, { account: '2000', credit: 400 }, { account: '3000', credit: 600 }];
const op = (o = {}) => ({ id: 'o1', periodId: '2026-01', branchId: 'b1', source: 'paper count 2025-12-31', preparedBy: 'a', lines, ...o });

t('accounts: types, duplicates, parent rules', () => {
  const c = setup();
  assert.throws(() => c.addAccount({ code: '1100', name: 'x', type: 'asset' }), { code: 'duplicate-account' });
  assert.throws(() => c.addAccount({ code: '9', name: 'x', type: 'bogus' }), { code: 'bad-account-type' });
  assert.throws(() => c.addAccount({ code: '9', name: 'x', type: 'asset', parent: 'nope' }), { code: 'unknown-parent' });
  assert.throws(() => c.addAccount({ code: '9', name: 'x', type: 'liability', parent: '1000' }), { code: 'parent-type-mismatch' });
  assert.equal(c.list('accounts').length, 5);
});
t('base currency is locked once set; periods validate and cannot overlap', () => {
  const c = setup();
  assert.throws(() => c.setBaseCurrency('USD'), { code: 'base-currency-locked' });
  assert.throws(() => c.addPeriod({ id: 'x', start: '2026-01-15', end: '2026-02-15' }), { code: 'period-overlap' });
  assert.throws(() => c.addPeriod({ id: 'y', start: '2026-02-30', end: '2026-03-01' }), { code: 'bad-period' });
  assert.throws(() => c.addPeriod({ id: 'z', start: '2026-03-02', end: '2026-03-01' }), { code: 'bad-period' });
});
t('dated rates: latest effective on or before the date wins; none before first fails', () => {
  const c = setup();
  c.addRate({ currency: 'usd', from: '2026-01-01', rate: 50 }); c.addRate({ currency: 'USD', from: '2026-01-20', rate: 52 });
  assert.equal(c.convert(10, 'USD', '2026-01-19'), 500);
  assert.equal(c.convert(10, 'USD', '2026-01-20'), 520);
  assert.equal(c.convert(10, 'EGP', '2026-01-20'), 10);
  assert.throws(() => c.convert(1, 'USD', '2025-12-31'), { code: 'no-rate' });
  assert.throws(() => c.convert(1, 'EUR', '2026-01-20'), { code: 'no-rate' });
  assert.throws(() => c.addRate({ currency: 'USD', from: '2026-01-01', rate: 9 }), { code: 'duplicate-rate' });
  assert.throws(() => c.addRate({ currency: 'EGP', from: '2026-01-01', rate: 1 }), { code: 'rate-for-base' });
  assert.throws(() => c.addRate({ currency: 'USD', from: '2026-02-01', rate: 0 }), { code: 'bad-rate' });
});
t('opening needs source, valid refs, one side per line, and must balance', () => {
  const c = setup();
  assert.throws(() => c.draftOpening(op({ source: ' ' })), { code: 'missing-source' });
  assert.throws(() => c.draftOpening(op({ branchId: 'zz' })), { code: 'unknown-branch' });
  assert.throws(() => c.draftOpening(op({ periodId: 'zz' })), { code: 'unknown-period' });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '1100', debit: 5 }, { account: '2000', credit: 4 }] })), { code: 'unbalanced' });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '1100', debit: 5, credit: 5 }, { account: '2000', credit: 0 }] })), { code: 'line-one-side' });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '4000', debit: 5 }, { account: '2000', credit: 5 }] })), { code: 'opening-account-type' });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '1100', debit: 5, costCenter: 'x' }, { account: '2000', credit: 5 }] })), { code: 'unknown-cost-center' });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '1100', debit: 0.001 }, { account: '2000', credit: 1 }] })), { code: 'bad-amount' });
  assert.equal(c.list('openings').length, 0);
  assert.equal(c.draftOpening(op()).total, 1000);
});
t('approval: not the preparer, once, immutable; one opening per branch+period', () => {
  const c = setup(); c.draftOpening(op());
  assert.throws(() => c.approveOpening('o1', 'a'), { code: 'self-approval' });
  assert.throws(() => c.approveOpening('o1', ''), { code: 'missing-approver' });
  assert.throws(() => c.draftOpening(op({ id: 'o2' })), { code: 'opening-exists' });
  const a = c.approveOpening('o1', 'boss');
  assert.equal(a.status, 'approved'); assert.equal(a.approvedBy, 'boss');
  assert.throws(() => c.approveOpening('o1', 'boss'), { code: 'not-draft' });
  assert.throws(() => c.voidOpening('o1'), { code: 'not-draft' });
});
t('foreign-currency opening converts at the period start rate and balances in base', () => {
  const c = setup(); c.addBranch({ id: 'b3', name: 'Third' }); c.addRate({ currency: 'USD', from: '2026-01-01', rate: 50 });
  assert.throws(() => c.draftOpening(op({ lines: [{ account: '1100', debit: 10, currency: 'USD' }, { account: '3000', credit: 400 }] })), { code: 'unbalanced' });
  const r = c.draftOpening(op({ lines: [{ account: '1100', debit: 10, currency: 'USD' }, { account: '3000', credit: 500 }] }));
  assert.equal(r.lines[0].baseDebit, 500); assert.equal(r.lines[0].rate, 50);
  assert.throws(() => c.draftOpening(op({ id: 'o9', branchId: 'b3', lines: [{ account: '1100', debit: 1, currency: 'EUR' }, { account: '3000', credit: 1 }] })), { code: 'no-rate' });
});
t('void frees the slot; closed period blocks drafts and approval', () => {
  const c = setup(); c.draftOpening(op()); c.voidOpening('o1');
  c.draftOpening(op({ id: 'o2' }));
  c.closePeriod('2026-01');
  assert.throws(() => c.approveOpening('o2', 'boss'), { code: 'period-closed' });
  assert.throws(() => c.draftOpening(op({ id: 'o3', branchId: 'b1' })), { code: 'period-closed' });
});
t('trial balance counts only approved openings, per branch, and balances', () => {
  const c = setup(); c.addBranch({ id: 'b2', name: 'Second' });
  c.draftOpening(op()); assert.equal(c.trialBalance().debit, 0);
  c.approveOpening('o1', 'boss');
  c.draftOpening(op({ id: 'o2', branchId: 'b2', lines: [{ account: '1100', debit: 50 }, { account: '3000', credit: 50 }] })); c.approveOpening('o2', 'boss');
  const all = c.trialBalance(), one = c.trialBalance('b2');
  assert.equal(all.debit, 1050); assert.equal(all.credit, 1050); assert.ok(all.balanced);
  assert.equal(one.accounts['1100'].debit, 50); assert.equal(all.base, 'EGP');
});
t('persists across reload; corrupt storage and write failure leave data untouched', () => {
  const s = mem(); const c = setup(s); c.draftOpening(op());
  const c2 = createCoa(s, 'k'); assert.equal(c2.list('openings').length, 1);
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => c2.addBranch({ id: 'b9', name: 'x' }), { code: 'coa-write-failed' });
  delete s.setItem; s.raw.k = '{oops';
  assert.throws(() => createCoa({ getItem: () => '{oops', setItem() {} }, 'k').list('accounts'), { code: 'coa-corrupt' });
});
console.log(n + ' tests passed');
