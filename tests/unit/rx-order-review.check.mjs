import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { create } = createRequire(import.meta.url)('../../rx-order-review.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const CAT = [
  { sku: 'A', name: 'Panadol', price: 10, stock: 5, ingredient: 'para' },
  { sku: 'B', name: 'Cetal', price: 8, stock: 0, ingredient: 'para' },
  { sku: 'C', name: 'Abimol', price: 7.5, stock: 3, ingredient: 'para' },
  { sku: 'D', name: 'Rare', price: 1, stock: 0, ingredient: 'x' },
];
const up = r => r.submitImage({ id: 'r1', mime: 'image/png', imageRef: 'private://rx/1' });

t('image must be private ref of image type', () => {
  const r = create(mem(), 'k');
  assert.throws(() => r.submitImage({ id: 'a', mime: 'application/pdf', imageRef: 'p' }), { code: 'bad-image-type' });
  assert.throws(() => r.submitImage({ id: 'a', mime: 'image/png', imageRef: 'data:image/png;base64,AA' }), { code: 'private-image-ref-required' });
  up(r); assert.throws(() => up(r), { code: 'duplicate' });
});
t('mock extract parses lines and is flagged mock', () => {
  const r = create(mem(), 'k'); up(r);
  const x = r.mockExtract('r1', 'Panadol x 2\nCetal');
  assert.deepEqual(x.items.map(i => [i.name, i.qty]), [['Panadol', 2], ['Cetal', 1]]);
  assert.equal(x.mock, true);
  assert.throws(() => r.matchItems('r1', CAT), { code: 'bad-state' });
});
t('review requires pharmacist; full flow reserves only after approval', () => {
  const r = create(mem(), 'k'); up(r); r.mockExtract('r1', 'Panadol x 2\nCetal');
  assert.throws(() => r.pharmacistReview('r1', { items: [{ name: 'Panadol', qty: 1 }] }), { code: 'pharmacist-required' });
  r.pharmacistReview('r1', { pharmacist: 'Dr A', items: [{ name: 'Panadol', qty: 2 }, { name: 'Cetal', qty: 1 }] });
  const m = r.matchItems('r1', CAT);
  assert.deepEqual(m.items[1].alternatives.map(a => a.sku).sort(), ['A', 'C']);
  assert.throws(() => r.makeQuote('r1'), { code: 'unmatched-items' });
  r.chooseAlternative('r1', 1, 'C');
  const q = r.makeQuote('r1');
  assert.equal(q.quote.total, 27.5);
  assert.equal(r.canReserve('r1'), false);
  assert.throws(() => r.customerApprove('r1', { approvedTotal: 20 }), { code: 'quote-mismatch' });
  r.customerApprove('r1', { approvedTotal: 27.5 });
  assert.equal(r.canReserve('r1'), true);
});
t('editing after approval invalidates it; rejected never reserves', () => {
  const r = create(mem(), 'k'); up(r); r.mockExtract('r1', 'Panadol');
  r.pharmacistReview('r1', { pharmacist: 'P', items: [{ name: 'Panadol', qty: 1 }] });
  r.matchItems('r1', CAT); r.makeQuote('r1'); r.customerApprove('r1', { approvedTotal: 10 });
  r.pharmacistReview('r1', { pharmacist: 'P', items: [{ name: 'Panadol', qty: 3 }] });
  assert.equal(r.canReserve('r1'), false);
  r.matchItems('r1', CAT); r.makeQuote('r1'); r.customerReject('r1');
  assert.equal(r.canReserve('r1'), false);
});
t('out of stock without alternative cannot be quoted', () => {
  const r = create(mem(), 'k'); up(r); r.mockExtract('r1', 'Rare');
  r.pharmacistReview('r1', { pharmacist: 'P', items: [{ name: 'Rare', qty: 1 }] });
  r.matchItems('r1', CAT);
  assert.throws(() => r.makeQuote('r1'), { code: 'unmatched-items' });
  assert.throws(() => r.chooseAlternative('r1', 0, 'A'), { code: 'bad-alternative' });
});
t('render is RTL, escaped, mock-warned, gates reserve', () => {
  const r = create(mem(), 'k'); up(r); r.mockExtract('r1', '<img onerror=x> x 1');
  const h = r.render('r1');
  assert.ok(h.includes('dir="rtl"') && h.includes('&lt;img') && !h.includes('<img') && h.includes('قراءة تجريبية'));
  assert.ok(h.includes('لا حجز ولا دفع'));
});
console.log(n + ' passed');
