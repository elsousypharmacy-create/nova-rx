import assert from 'node:assert/strict';
import * as C from '../../backend/src/country/adapters.js';

// flags default OFF
assert.equal(C.countryAdaptersEnabled(undefined), false);
assert.equal(C.countryAdaptersEnabled({}), false);
assert.equal(C.countryAdaptersEnabled({ NOVA_COUNTRY_ADAPTERS: '0' }), false);
assert.equal(C.countryAdaptersEnabled({ NOVA_COUNTRY_ADAPTERS: '1' }), true);
assert.equal(C.zatcaEnabled({}), false);
assert.equal(C.zatcaEnabled({ NOVA_ZATCA_EINVOICE: '1' }), true);

const sa = C.getCountryAdapter('sa'), eg = C.getCountryAdapter('EG');
assert.equal(sa.tax.rateBp, 1500); assert.equal(eg.tax.rateBp, 1400);
assert.deepEqual(sa.tax.add(10000), { ok: true, net: 10000, tax: 1500, gross: 11500 });
assert.deepEqual(sa.tax.extract(11500), { ok: true, net: 10000, tax: 1500, gross: 11500 });
assert.equal(sa.tax.add(333).tax, 50); // 49.95 -> 50
assert.deepEqual(eg.tax.add(10000), { ok: true, net: 10000, tax: 1400, gross: 11400 });
for (const g of [0, 1, 99, 11500, 123457]) { const r = sa.tax.extract(g); assert.equal(r.net + r.tax, g); }
let bad = sa.tax.add(-1);
assert.equal(bad.ok, false); assert.equal(bad.code, 'COUNTRY_BAD_AMOUNT'); assert.ok(bad.requestId); assert.match(bad.message_ar, /[؀-ۿ]/);
assert.equal(sa.tax.add(1.5).ok, false);

assert.equal(sa.money.currency, 'SAR'); assert.equal(eg.money.currency, 'EGP');
assert.equal(sa.money.format(11505), '115.05 ر.س');
assert.equal(eg.money.format(-5), '-0.05 ج.م');
assert.equal(sa.money.dir, 'rtl');

const un = C.getCountryAdapter('XX');
assert.equal(un.ok, false); assert.equal(un.code, 'COUNTRY_UNSUPPORTED'); assert.ok(un.requestId);
assert.deepEqual(C.listCountries(), ['SA', 'EG']);

// e-invoice stub: OFF by default, never network
const origFetch = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error('net'); };
let r = await sa.einvoice.submit({}, { id: 1 });
assert.equal(r.code, 'EINVOICE_DISABLED'); assert.equal(r.status, 404); assert.ok(r.requestId);
r = await sa.einvoice.submit({ NOVA_ZATCA_EINVOICE: '1' }, { id: 1 });
assert.equal(r.code, 'EINVOICE_NOT_ONBOARDED');
r = await sa.einvoice.submit({ NOVA_ZATCA_EINVOICE: '1' }, null);
assert.equal(r.code, 'EINVOICE_BAD_INVOICE');
r = await eg.einvoice.submit({ NOVA_ZATCA_EINVOICE: '1' }, {});
assert.equal(r.code, 'EINVOICE_UNSUPPORTED');
assert.equal(calls, 0); globalThis.fetch = origFetch;
console.log('backend-country-adapters OK');
