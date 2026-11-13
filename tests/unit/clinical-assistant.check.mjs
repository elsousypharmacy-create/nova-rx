import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../../clinical-assistant.js');
const inv = { id: 'inv1', patient: { allergies: ['penicillin'] }, items: [{ id: 'a', name: 'Amoxil', substances: ['penicillin'], form: 'tab', strength: { value: 500, unit: 'mg' } }] };
const good = { notes: [{ severity: 'info', text: 'ok' }], instructions: ['خذ الدواء بعد الأكل'] };
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('model success is validated and not approved by default', async () => {
  const a = A.createAssistant({ model: async () => good });
  const r = await a.review(inv);
  assert.equal(r.source, 'model'); assert.equal(r.approved, false);
  assert.equal(a.instructionsFor(r), null);
});
await t('pharmacist approval releases instructions; tampering revokes', async () => {
  const a = A.createAssistant({ model: async () => good });
  const r = await a.review(inv);
  assert.throws(() => a.approve(r, ''), { code: 'pharmacist-required' });
  a.approve(r, 'Dr X');
  assert.deepEqual(a.instructionsFor(r), good.instructions);
  const bad = { ...r, instructions: ['خذ ١٠ حبات'] };
  assert.equal(a.instructionsFor(bad), null);
  assert.throws(() => a.approve(bad, 'Dr X'), { code: 'review-changed' });
});
await t('timeout retries once then falls back to local rules', async () => {
  let calls = 0;
  const a = A.createAssistant({ model: () => { calls++; return new Promise(() => {}); }, timeoutMs: 20, retries: 1 });
  const r = await a.review(inv);
  assert.equal(calls, 2); assert.equal(r.source, 'local-rules'); assert.equal(r.fallbackReason, 'timeout');
  assert.equal(r.instructions.length, 0);
  assert.ok(r.notes.some(x => /allergy/.test(x.text)));
});
await t('transient error is retried and can succeed; retries capped at 2', async () => {
  let calls = 0;
  const a = A.createAssistant({ model: async () => { if (++calls < 2) throw new Error('x'); return good; } });
  assert.equal((await a.review(inv)).source, 'model');
  let c2 = 0;
  const b = A.createAssistant({ model: async () => { c2++; throw new Error('x'); }, retries: 99 });
  const r = await b.review(inv);
  assert.equal(c2, 3); assert.equal(r.fallbackReason, 'model-error');
});
await t('invalid output falls back without retry', async () => {
  for (const bad of [null, {}, { notes: [{ severity: 'zzz', text: 'a' }], instructions: [] }, { notes: [], instructions: [5] }, { notes: [], instructions: ['x'.repeat(501)] }]) {
    let c = 0; const a = A.createAssistant({ model: async () => { c++; return bad; } });
    const r = await a.review(inv);
    assert.equal(c, 1); assert.equal(r.source, 'local-rules'); assert.equal(r.fallbackReason, 'bad-output');
  }
});
await t('budget cap stops model calls and falls back', async () => {
  let c = 0; const a = A.createAssistant({ model: async () => { c++; return good; }, budget: { maxCalls: 1 } });
  assert.equal((await a.review(inv)).source, 'model');
  const r = await a.review({ ...inv, id: 'inv2' });
  assert.equal(c, 1); assert.equal(r.fallbackReason, 'budget-exceeded'); assert.equal(a.usage().calls, 1);
  const b = A.createAssistant({ model: async () => good, cost: 5, budget: { maxCost: 4 } });
  assert.equal((await b.review(inv)).fallbackReason, 'budget-exceeded');
});
await t('no model and missing invoice id', async () => {
  const a = A.createAssistant({});
  assert.equal((await a.review(inv)).fallbackReason, 'no-model');
  await assert.rejects(a.review({}), { code: 'missing-invoice-id' });
});
console.log(n + ' tests passed');
