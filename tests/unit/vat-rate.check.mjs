import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>\/\* UX29[\s\S]*?<\/script>/);
assert.ok(m, 'novaVat module');
const code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
function load(stored) {
  const store = new Map(stored === undefined ? [] : [['nova-rx-vat-rate', stored]]);
  const ctx = { window: {}, localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v) } };
  vm.runInNewContext(code, ctx);
  return ctx.window.novaVat;
}
const cart = [[12.5, 3], [7.25, 2], [100.1, 1]];
const total = cart.reduce((a, [p, q]) => a + p * q, 0) - 5;
// default identical to legacy formula (rounded to 2dp)
const v = load();
assert.equal(v.get(), 15);
assert.equal(v.calc(total), Math.round(total * (15 / 115) * 100) / 100);
assert.equal(v.label(), '15');
// change to 14 changes totals + label consistently
assert.equal(v.set(14), true);
assert.equal(v.get(), 14);
assert.notEqual(v.calc(total), Math.round(total * (15 / 115) * 100) / 100);
assert.equal(v.calc(114), 14);
assert.equal(v.label(), '14');
assert.equal(load('14').calc(114), 14, 'persisted');
// rounding to 2 decimals
for (const t of [0.01, 1.005, 33.33, 99.99, 1234.5678]) { const x = v.calc(t); assert.equal(x, Math.round(x * 100) / 100); }
// invalid values rejected / fall back to default
assert.equal(v.set('abc'), false); assert.equal(v.set(-1), false); assert.equal(v.set(101), false);
assert.equal(load('garbage').get(), 15);
// wiring
for (const t of ['window.novaVat.calc(grandTotal)', 'vatRate: window.novaVat.get()', 'id="novaVatRate"', 'راجع المحاسب', "window.novaVat.label()+'%)',money(d.vat)", "window.novaVat.label(Number(s.vatRate)"]) assert.ok(html.includes(t), t);
assert.ok(!html.includes('15 / 115'), 'no hardcoded rate');
console.log('vat-rate checks PASS');
