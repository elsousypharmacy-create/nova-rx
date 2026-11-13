import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../../patient-file.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; };
let T = 1e6, n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const mk = (e = {}) => P.createStore(Object.assign({ storage: mem(), now: () => T, allow: () => true }, e));

t('unknown stays unknown (no zero/false/none coercion)', () => {
  const r = P.normalize({});
  assert.equal(r.age, null); assert.equal(r.weight, null); assert.equal(r.pregnant, 'unknown');
  assert.equal(r.lactating, 'unknown'); assert.equal(r.allergies.status, 'unknown'); assert.equal(r.sex, 'unknown');
});
t('units are mandatory and values validated; Arabic digits accepted', () => {
  assert.throws(() => P.normalize({ age: { value: 5 } }), { code: 'age-unit-required' });
  assert.throws(() => P.normalize({ weight: { value: 70 } }), { code: 'weight-unit-required' });
  assert.throws(() => P.normalize({ weight: { value: 0, unit: 'kg' } }), { code: 'bad-weight' });
  assert.throws(() => P.normalize({ age: { value: -1, unit: 'year' } }), { code: 'bad-age' });
  assert.deepEqual(P.normalize({ weight: { value: '٧٠', unit: 'kg' } }).weight, { value: 70, unit: 'kg' });
});
t('allergies: yes needs items; none is distinct from unknown', () => {
  assert.throws(() => P.normalize({ allergies: { status: 'yes', items: [] } }), { code: 'allergy-items-required' });
  assert.deepEqual(P.normalize({ allergies: { status: 'yes', items: ['بنسلين '] } }).allergies, { status: 'yes', items: ['بنسلين'] });
  assert.equal(P.normalize({ allergies: { status: 'none' } }).allergies.status, 'none');
  assert.throws(() => P.normalize({ pregnant: 'maybe' }), { code: 'bad-pregnant' });
});
t('required questions by case', () => {
  assert.deepEqual(P.requiredQuestions(P.normalize({})), ['age', 'allergies', 'pregnant', 'lactating']);
  const kid = P.normalize({ age: { value: 3, unit: 'year' }, case: 'pediatric', allergies: { status: 'none' } });
  assert.deepEqual(P.requiredQuestions(kid), ['weight']);
  const man = P.normalize({ age: { value: 40, unit: 'year' }, sex: 'male', allergies: { status: 'none' } });
  assert.deepEqual(P.requiredQuestions(man), []);
  const w = P.normalize({ age: { value: 30, unit: 'year' }, sex: 'female', allergies: { status: 'none' }, pregnant: 'no' });
  assert.deepEqual(P.requiredQuestions(w), ['lactating']);
});
t('access gated; retention expires; erase works', () => {
  const s = mk(); s.save('p1', { age: { value: 30, unit: 'year' } });
  assert.throws(() => mk({ storage: s2(s), allow: () => false }).get('p1'), { code: 'permission' });
  assert.ok(s.get('p1')); T += 29 * 86400000; assert.ok(s.get('p1'));
  T += 2 * 86400000; assert.equal(s.get('p1'), null);
  s.save('p2', {}); assert.equal(s.erase('p2'), true); assert.equal(s.get('p2'), null);
  assert.throws(() => mk({ allow: a => a === 'patient.read' }).save('x', {}), { code: 'permission' });
  const bad = mem(); bad.setItem('nova.patientfile', '{x'); assert.throws(() => mk({ storage: bad }).get('a'), { code: 'patientfile-corrupt' });
});
function s2(s) { return { getItem: () => '{}', setItem() {} }; }
console.log(n + ' passed');
