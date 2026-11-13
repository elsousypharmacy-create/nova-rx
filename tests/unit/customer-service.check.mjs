import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../../customer-service.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const D = 86400000, T0 = 1700000000000;

t('search is Arabic-normalized, multi-term, limited, and handles Arabic digits', () => {
  const ix = S.createIndex([{ id: 'c1', name: 'أحمد محمود', phone: '01012345678' }, { id: 'c2', name: 'احمد علي', phone: '٠١١٢٢٢٢٣٣٣٣' }, { id: 'c3', name: 'منى' }]);
  assert.deepEqual(ix.search('احمد').map(c => c.id), ['c1', 'c2']);
  assert.deepEqual(ix.search('أحمد علي').map(c => c.id), ['c2']);
  assert.deepEqual(ix.search('01122').map(c => c.id), ['c2']);
  assert.equal(ix.search('احمد', 1).length, 1);
  assert.deepEqual(ix.search('   '), []);
});
t('search stays fast on 50k customers', () => {
  const ix = S.createIndex(Array.from({ length: 50000 }, (_, i) => ({ id: 'c' + i, name: 'عميل ' + i, phone: '010' + i })));
  const t0 = Date.now(); const r = ix.search('عميل 49999'); assert.equal(r.length, 1); assert.ok(Date.now() - t0 < 200);
});
const data = {
  visits: [{ id: 'v1', customerId: 'a', at: T0 }, { id: 'v2', customerId: 'a', at: T0 + D }, { id: 'v3', customerId: 'b', at: T0 + 2 * D }, { id: 'v4', customerId: 'a', at: T0 + 40 * D }],
  invoices: [{ id: 'i1', customerId: 'a', visitId: 'v1', at: T0, netCents: 10000 }, { id: 'i2', customerId: 'a', visitId: 'v1', at: T0, netCents: 5000 }, { id: 'i3', customerId: 'b', at: T0 + 2 * D, netCents: 3000 }],
  cases: []
};
t('visit is not an invoice: 2 invoices in 1 visit; visit without invoice counts', () => {
  const r = S.averageOrder(data, T0, T0 + 10 * D);
  assert.equal(r.invoices, 3); assert.equal(r.visits, 3); assert.equal(r.averageCents, 6000);
});
t('average order is net of returns and unlinked invoice is not a visit', () => {
  const d = { ...data, cases: [{ type: 'return', status: 'open', invoiceId: 'i1', amountCents: 4000 }, { type: 'return', status: 'rejected', invoiceId: 'i2', amountCents: 5000 }] };
  assert.equal(S.averageOrder(d, T0, T0 + 10 * D).netCents, 14000);
  assert.equal(S.averageOrder({ visits: [], invoices: data.invoices, cases: [] }, T0, T0 + 10 * D).visits, 0);
  assert.equal(S.averageOrder({ visits: [], invoices: [], cases: [] }, 0, 1).averageCents, 0);
});
t('retention counts customers by distinct visit, not invoices', () => {
  const r = S.retention(data, T0, T0 + 30 * D, T0 + 60 * D);
  assert.deepEqual(r, { base: 2, retained: 1, rate: 0.5 });
  assert.equal(S.retention({ visits: [] }, 0, 1, 2).rate, 0);
});
t('history is newest first, per customer only', () => {
  const h = S.history('a', data); assert.equal(h[0].id, 'v4'); assert.ok(h.every(e => e.id !== 'v3' && e.id !== 'i3'));
});
t('cases: idempotent, return validated against invoice, cumulative cap, resolve, persistence, corrupt', () => {
  const s = mem(); let T = T0;
  const mk = () => S.createCases(s, 'k', { now: () => T, invoices: () => data.invoices });
  const c = mk();
  const r1 = c.open({ id: 'r1', customerId: 'a', type: 'return', invoiceId: 'i1', amountCents: 6000 });
  assert.equal(c.open({ id: 'r1', customerId: 'a', type: 'return', invoiceId: 'i1', amountCents: 1 }).amountCents, 6000);
  assert.throws(() => c.open({ id: 'r2', customerId: 'a', type: 'return', invoiceId: 'i1', amountCents: 4001 }), { code: 'return-exceeds-invoice' });
  assert.throws(() => c.open({ id: 'r3', customerId: 'b', type: 'return', invoiceId: 'i1', amountCents: 1 }), { code: 'invoice-customer-mismatch' });
  assert.throws(() => c.open({ id: 'r4', customerId: 'a', type: 'return', invoiceId: 'nope', amountCents: 1 }), { code: 'unknown-invoice' });
  assert.throws(() => c.open({ id: 'r5', customerId: 'a', type: 'return', invoiceId: 'i1', amountCents: 1.5 }), { code: 'bad-amount' });
  assert.throws(() => c.open({ id: 'x', customerId: 'a', type: 'zzz' }), { code: 'bad-type' });
  c.open({ id: 'k1', customerId: 'a', type: 'complaint', note: 'دواء خاطئ' });
  T += 1000; assert.equal(c.resolve('r1', 'rejected').status, 'rejected');
  assert.equal(c.resolve('r1', 'resolved').status, 'rejected');
  c.open({ id: 'r6', customerId: 'a', type: 'return', invoiceId: 'i1', amountCents: 10000 });
  assert.equal(mk().list().length, 3);
  assert.throws(() => c.resolve('zz', 'resolved'), { code: 'unknown-case' });
  assert.throws(() => c.resolve('k1', 'bad'), { code: 'bad-status' });
  s.setItem('k', '{bad'); assert.throws(() => c.list(), { code: 'cases-corrupt' }); assert.equal(s.raw.k, '{bad');
});
console.log(n + ' passed');
