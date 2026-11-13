import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../../perf-budget.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const fake = () => { let c = 0; return { clock: () => c, adv: ms => { c += ms; } }; };

await t('percentile p95', () => {
  assert.equal(P.percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
  assert.throws(() => P.percentile([], 95), /no-samples/);
});
await t('provider time is excluded from local and reported separately', async () => {
  const f = fake(); const p = P.create({ clock: f.clock });
  await p.measure('invoiceSave', async prov => { f.adv(300); await prov(() => { f.adv(5000); return Promise.resolve(1); }); f.adv(200); });
  const r = p.report();
  assert.equal(r.invoiceSave.p95LocalMs, 500); assert.equal(r.invoiceSave.providerMsTotal, 5000);
  assert.equal(r.checks.invoiceSave, true);
});
await t('over budget fails; unmeasured is not a pass', () => {
  const f = fake(); const p = P.create({ clock: f.clock });
  p.measure('interaction', () => f.adv(150));
  const r = p.report();
  assert.equal(r.checks.interaction, false); assert.equal(r.pass, false);
  assert.deepEqual(r.unmeasured.sort(), ['invoiceSave', 'lcp', 'search']);
});
await t('reference fixture: real search over 5000 items + save within budget; LCP checked', () => {
  const items = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'دواء ' + i }));
  const store = {}; const p = P.create();
  for (let i = 0; i < 20; i++) {
    p.measure('interaction', () => items[i].name.length);
    p.measure('search', () => items.filter(x => x.name.includes('99')));
    p.measure('invoiceSave', () => { store['inv' + i] = JSON.stringify({ lines: items.slice(0, 50) }); });
  }
  const r = p.report(2000);
  assert.equal(r.pass, true); assert.equal(p.report(3000).checks.lcp, false);
  assert.ok(r.profile.network.includes('3G'));
});
console.log(n + ' passed');
