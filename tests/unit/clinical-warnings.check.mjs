import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { buildTable, check, createReview } = createRequire(import.meta.url)('../../clinical-warnings.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const TBL = [{ a: 'Warfarin', b: 'Ibuprofen', severity: 'major', source: 'Stockley', reason: 'bleeding risk' },
  { a: 'warfarin', b: 'paracetamol', severity: 'minor', source: 'Stockley', reason: 'INR may rise' }];
const W = { id: 'w', substances: ['warfarin'] }, I = { id: 'i', substances: ['ibuprofen'] };

t('interaction shows severity, source, reason; order-free; sorted worst first', () => {
  const r = check({ items: [{ id: 'p', substances: ['Paracetamol'] }, I, W] }, TBL);
  assert.equal(r.length, 2); assert.equal(r[0].severity, 'major');
  assert.equal(r[0].source, 'Stockley'); assert.equal(r[0].reason, 'bleeding risk'); assert.equal(r[0].block, false);
});
t('bad interaction row is rejected', () => {
  assert.throws(() => buildTable([{ a: 'x', b: 'y', severity: 'huge', source: 's', reason: 'r' }]), { code: 'bad-interaction-row' });
  assert.throws(() => buildTable([{ a: 'x', b: 'y', severity: 'major', source: '', reason: 'r' }]), { code: 'bad-interaction-row' });
});
t('form and strength mix-ups block and cannot be overridden', () => {
  const r = check({ items: [{ id: 'a', form: 'syrup', prescribedForm: 'tablet', strength: { value: 500, unit: 'mg' }, prescribedStrength: { value: 250, unit: 'mg' } }] }, []);
  assert.deepEqual(r.map(w => w.type).sort(), ['form-mismatch', 'strength-mismatch']);
  assert.ok(r.every(w => w.block));
  const rv = createReview(mem());
  assert.throws(() => rv.decide(r[0], { pharmacist: 'Dr A', decision: 'override', reason: 'ok' }), { code: 'blocked-cannot-override' });
  assert.equal(rv.status(r).canDispense, false);
});
t('matching form/strength does not warn', () => {
  assert.equal(check({ items: [{ id: 'a', form: 'Tablet', prescribedForm: 'tablet', strength: { value: 500, unit: 'MG' }, prescribedStrength: { value: '500', unit: 'mg' } }] }, []).length, 0);
});
t('allergy, child and unknown age', () => {
  const it = { id: 'a', substances: ['Penicillin'], minAgeYears: 12 };
  const r = check({ patient: { ageYears: 5, allergies: ['penicillin'] }, items: [it] }, []);
  assert.deepEqual(r.map(w => w.type).sort(), ['allergy', 'child']);
  assert.equal(check({ patient: {}, items: [it] }, [])[0].type, 'child');
  assert.equal(check({ patient: { ageYears: 12 }, items: [it] }, []).length, 0);
});
t('duplicate substance between two items', () => {
  const r = check({ items: [{ id: 'a', substances: ['paracetamol'] }, { id: 'b', substances: ['Paracetamol', 'caffeine'] }] }, []);
  assert.equal(r.length, 1); assert.equal(r[0].type, 'duplicate-substance');
});
t('decisions need pharmacist and reason for major; dispensing gated until all decided', () => {
  const s = mem(), rv = createReview(s), r = check({ items: [W, I] }, TBL);
  assert.equal(rv.status(r).canDispense, false);
  assert.throws(() => rv.decide(r[0], { pharmacist: '', decision: 'accept', reason: 'x' }), { code: 'missing-pharmacist' });
  assert.throws(() => rv.decide(r[0], { pharmacist: 'Dr A', decision: 'accept' }), { code: 'missing-reason' });
  assert.throws(() => rv.decide(r[0], { pharmacist: 'Dr A', decision: 'maybe', reason: 'x' }), { code: 'bad-decision' });
  rv.decide(r[0], { pharmacist: 'Dr A', decision: 'override', reason: 'INR monitored' });
  assert.equal(rv.status(r).canDispense, true);
  assert.equal(createReview(s).status(r).canDispense, true);
});
t('cancel-item decision keeps dispensing blocked', () => {
  const rv = createReview(mem()), r = check({ items: [W, I] }, TBL);
  rv.decide(r[0], { pharmacist: 'Dr A', decision: 'cancel-item', reason: 'unsafe' });
  assert.equal(rv.status(r).canDispense, false);
});
t('patient advice is never automatic', () => {
  const rv = createReview(mem()), r = check({ items: [W, I] }, TBL);
  assert.equal(rv.adviceFor(r), null);
  rv.decide(r[0], { pharmacist: 'Dr A', decision: 'accept', reason: 'monitor' });
  const a = rv.adviceFor(r);
  assert.equal(a.draft, true); assert.equal(a.approvedBy, 'Dr A');
  const b = check({ items: [{ id: 'f', form: 'x', prescribedForm: 'y' }] }, []);
  assert.equal(rv.adviceFor(b), null);
});
t('corrupt log and write failure throw without overwriting', () => {
  const s = mem(); s.setItem('k', '{oops');
  const r = check({ items: [W, I] }, TBL);
  assert.throws(() => createReview(s, 'k').decide(r[0], { pharmacist: 'A', decision: 'accept', reason: 'x' }), { code: 'log-corrupt' });
  assert.equal(s.raw.k, '{oops');
  const bad = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  assert.throws(() => createReview(bad).decide(r[0], { pharmacist: 'A', decision: 'accept', reason: 'x' }), { code: 'log-write-failed' });
});
console.log(n + ' passed');
