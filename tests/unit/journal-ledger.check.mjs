import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createJournal, weightedAverage } = createRequire(import.meta.url)('../../journal-ledger.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let T = 1700000000000; const mk = (s = mem()) => createJournal(s, 'k', { now: () => T });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('sale posts a balanced entry with revenue, tender split and COGS', () => {
  const j = mk(); const e = j.sale({ id: 'S1', total: 100, cash: 60, card: 10, credit: 30, cogs: 70 });
  assert.equal(j.balance('cash'), 60); assert.equal(j.balance('bank'), 10); assert.equal(j.balance('ar'), 30);
  assert.equal(j.balance('sales'), -100); assert.equal(j.balance('cogs'), 70); assert.equal(j.balance('inventory'), -70);
  assert.ok(j.trialBalance().balanced); assert.equal(e.id, 'sale:S1'); assert.ok(j.verify().ok);
});
t('posting is idempotent and survives reload', () => {
  const s = mem(), j = mk(s); j.sale({ id: 'S1', total: 10, cash: 10 }); j.sale({ id: 'S1', total: 999, cash: 999 });
  assert.equal(j.list().length, 1); assert.equal(mk(s).balance('cash'), 10);
});
t('purchase, return, collection and expense each balance', () => {
  const j = mk();
  j.purchase({ id: 'P1', total: 200, paid: 50 }); assert.equal(j.balance('inventory'), 200); assert.equal(j.balance('ap'), -150);
  j.sale({ id: 'S1', total: 100, credit: 100, cogs: 60 });
  j.saleReturn({ id: 'R1', total: 40, credit: 40, cogs: 24 }); assert.equal(j.balance('ar'), 60); assert.equal(j.balance('salesReturns'), 40);
  j.collection({ id: 'C1', amount: 60, method: 'card' }); assert.equal(j.balance('ar'), 0); assert.equal(j.balance('bank'), 60);
  j.expense({ id: 'E1', amount: 30 }); assert.equal(j.balance('expense'), 30);
  assert.equal(j.list().length, 6 - 1); assert.ok(j.trialBalance().balanced); assert.ok(j.verify().ok);
});
t('rejects unbalanced tender, bad amounts, missing key and corrupt storage', () => {
  const s = mem(), j = mk(s);
  assert.throws(() => j.sale({ id: 'S', total: 100, cash: 90 }), { code: 'tender-mismatch' });
  assert.throws(() => j.sale({ id: 'S', total: 0 }), { code: 'bad-amount' });
  assert.throws(() => j.sale({ id: 'S', total: 1.005, cash: 1.005 }), { code: 'bad-amount' });
  assert.throws(() => j.sale({ id: 'S', total: -5, cash: -5 }), { code: 'bad-amount' });
  assert.throws(() => j.sale({ id: '', total: 1, cash: 1 }), { code: 'missing-key' });
  assert.throws(() => j.purchase({ id: 'P', total: 5, paid: 6 }), { code: 'tender-mismatch' });
  assert.equal(j.list().length, 0);
  s.setItem('k', '{oops'); assert.throws(() => j.list(), { code: 'journal-corrupt' }); assert.equal(s.raw.k, '{oops');
});
t('write failure throws and leaves the journal unchanged', () => {
  const s = mem(), j = mk(s); j.expense({ id: 'E1', amount: 5 });
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => j.expense({ id: 'E2', amount: 5 }), { code: 'journal-write-failed' });
  assert.equal(j.list().length, 1);
});
t('reverse mirrors the entry, is idempotent, needs a reason, and nothing is deleted', () => {
  const j = mk(); j.sale({ id: 'S1', total: 100, cash: 100, cogs: 60 });
  assert.throws(() => j.reverse('sale:S1'), { code: 'reason-required' });
  const r = j.reverse('sale:S1', 'wrong item'); const r2 = j.reverse('sale:S1', 'again');
  assert.equal(r.id, r2.id); assert.equal(j.list().length, 2);
  for (const a of ['cash', 'sales', 'cogs', 'inventory']) assert.equal(j.balance(a), 0);
  assert.throws(() => j.reverse('reversal:sale:S1', 'x'), { code: 'cannot-reverse-reversal' });
  assert.throws(() => j.reverse('nope', 'x'), { code: 'unknown-entry' });
  assert.ok(j.verify().ok);
});
t('revaluation is gated by reason and approver, posts its own entry, idempotent', () => {
  const j = mk(); j.purchase({ id: 'P1', total: 100, paid: 100 });
  assert.throws(() => j.revalue({ id: 'V1', delta: -10 }), { code: 'reason-required' });
  assert.throws(() => j.revalue({ id: 'V1', delta: -10, reason: 'expiry write-down' }), { code: 'revaluation-not-approved' });
  assert.throws(() => j.revalue({ id: 'V1', delta: 0, reason: 'r', approvedBy: 'a' }), { code: 'bad-amount' });
  assert.equal(j.balance('inventory'), 100);
  j.revalue({ id: 'V1', delta: -10, reason: 'expiry write-down', approvedBy: 'Dr Ahmed' }); j.revalue({ id: 'V1', delta: -99, reason: 'x', approvedBy: 'y' });
  assert.equal(j.balance('inventory'), 90); assert.equal(j.balance('revaluation'), 10);
  j.revalue({ id: 'V2', delta: 5, reason: 'found', approvedBy: 'Dr Ahmed' }); assert.equal(j.balance('inventory'), 95);
  assert.equal(j.get('revaluation:V1').approvedBy, 'Dr Ahmed'); assert.ok(j.verify().ok);
});
t('weighted average cost', () => {
  assert.equal(weightedAverage(10, 5, 10, 7), 6);
  assert.equal(weightedAverage(0, 0, 4, 2.5), 2.5);
  assert.throws(() => weightedAverage(1, 1, 0, 1), { code: 'bad-cost-input' });
});
t('verify detects tampered storage', () => {
  const s = mem(), j = mk(s); j.sale({ id: 'S1', total: 10, cash: 10 });
  const d = JSON.parse(s.raw.k); d.entries[0].lines[0].debit += 100; s.raw.k = JSON.stringify(d);
  assert.equal(j.verify().ok, false); assert.equal(j.trialBalance().balanced, false);
});
console.log(n + ' passed');
