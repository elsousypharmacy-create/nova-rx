import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { createJournal } = req('../../journal-ledger.js');
const { createReports } = req('../../finance-reports.js');
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const JAN = Date.UTC(2026, 0, 15), FEB = Date.UTC(2026, 1, 10);
function mk(perm = false) {
  const j = createJournal(mem(), 'j', { now: () => JAN });
  const r = createReports(j, mem(), 'p', { now: () => 5, canReopen: () => perm });
  j.purchase({ id: 'p1', total: 1000, paid: 400, at: JAN });
  j.sale({ id: 's1', total: 500, cash: 300, card: 100, credit: 100, cogs: 300, at: JAN });
  j.saleReturn({ id: 'r1', total: 50, cash: 50, cogs: 30, at: JAN });
  j.expense({ id: 'e1', amount: 40, at: JAN });
  return { j, r };
}
t('P&L: net sales after returns, COGS, margins', () => {
  const p = mk().r.report('2026-01').pnl;
  assert.equal(p.netSales, 450); assert.equal(p.cogs, 270); assert.equal(p.grossProfit, 180);
  assert.equal(p.netProfit, 140); assert.equal(p.grossMarginPct, 40); assert.equal(p.netMarginPct, 31.11);
});
t('trial balance and balance sheet balance; equity = profit', () => {
  const x = mk().r.report('2026-01');
  assert.equal(x.trialBalance.balanced, true); assert.equal(x.balanceSheet.balanced, true);
  assert.equal(x.balanceSheet.equity, 140); assert.equal(x.balanceSheet.liabilities.ap, 600);
  assert.equal(x.balanceSheet.assets.inventory, 1000 - 270);
});
t('cash flow groups by event; reversal grouped with its original; reconciles', () => {
  const { j, r } = mk();
  let cf = r.report('2026-01').cashFlow;
  assert.deepEqual(cf.byEvent, { purchase: -400, sale: 400, return: -50, expense: -40 });
  assert.equal(cf.closing, -90); assert.equal(cf.reconciled, true);
  j.reverse('expense:e1', 'oops'); cf = r.report('2026-01').cashFlow;
  assert.equal(cf.byEvent.expense, undefined); assert.equal(cf.closing, -50);
});
t('next period: cumulative balances, opening cash carried, period P&L only', () => {
  const { j, r } = mk();
  j.sale({ id: 's2', total: 100, cash: 100, cogs: 60, at: FEB });
  const f = r.report('2026-02');
  assert.equal(f.pnl.netSales, 100); assert.equal(f.cashFlow.opening, -90); assert.equal(f.cashFlow.closing, 10);
  assert.equal(f.balanceSheet.equity, 180); assert.equal(f.balanceSheet.balanced, true);
});
t('no sales: margins are null, not NaN', () => {
  const j = createJournal(mem(), 'j'); const r = createReports(j, mem());
  const p = r.report('2026-03').pnl; assert.equal(p.grossMarginPct, null); assert.equal(p.netProfit, 0);
});
t('close locks the period, freezes snapshot, flags drift on late entries', () => {
  const { j, r } = mk();
  r.close('2026-01', 'amal');
  assert.equal(r.status('2026-01'), 'closed'); assert.equal(r.isLocked(JAN), true); assert.equal(r.isLocked(FEB), false);
  assert.throws(() => r.assertOpen(JAN), { code: 'period-closed' });
  assert.throws(() => r.close('2026-01', 'amal'), { code: 'already-closed' });
  assert.equal(r.report('2026-01').drift, false);
  j.expense({ id: 'late', amount: 10, at: JAN });
  const x = r.report('2026-01'); assert.equal(x.drift, true); assert.equal(x.pnl.expenses, 40);
});
t('close needs a closer; bad period rejected', () => {
  const { r } = mk();
  assert.throws(() => r.close('2026-01', ' '), { code: 'closer-required' });
  assert.throws(() => r.report('2026-13'), { code: 'bad-period' });
  assert.throws(() => r.isLocked('nope'), { code: 'bad-date' });
});
t('reopen denied without permission; allowed with permission + reason; logged', () => {
  const a = mk(false); a.r.close('2026-01', 'amal');
  assert.throws(() => a.r.reopen('2026-01', { by: 'x', reason: 'fix' }), { code: 'not-permitted' });
  assert.equal(a.r.status('2026-01'), 'closed');
  const b = mk(true); b.r.close('2026-01', 'amal');
  assert.throws(() => b.r.reopen('2026-01', { by: 'x' }), { code: 'reason-required' });
  assert.throws(() => b.r.reopen('2026-02', { by: 'x', reason: 'r' }), { code: 'not-closed' });
  b.r.reopen('2026-01', { by: 'mgr', reason: 'late invoice' });
  assert.equal(b.r.status('2026-01'), 'open'); assert.equal(b.r.isLocked(JAN), false);
  assert.deepEqual(b.r.history().map(h => h.action), ['close', 'reopen']);
});
t('corrupt stored state fails closed', () => {
  const st = mem(); st.setItem('p', '{bad');
  const r = createReports(createJournal(mem(), 'j'), st, 'p');
  assert.throws(() => r.status('2026-01'), { code: 'periods-corrupt' });
});
console.log(n + ' passed');
