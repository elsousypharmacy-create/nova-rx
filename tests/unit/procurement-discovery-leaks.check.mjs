// Adversarial leak checks for tools/discovery/sanitize-har.mjs (review of #55).
// Run: node tests/unit/procurement-discovery-leaks.check.mjs
import assert from 'node:assert/strict';
import { sanitizeHar, templatePath } from '../../tools/discovery/sanitize-har.mjs';

const json = (o) => ({ mimeType: 'application/json', text: JSON.stringify(o) });
const entry = (method, url, resp, postData, headers = []) => ({
  _resourceType: 'xhr',
  request: { method, url, headers, queryString: [], postData },
  response: { status: 200, headers: [], content: json(resp) },
});

const har = { log: { entries: [
  entry('GET', 'https://api.x.com/occ/v2/pharma/users/ahmed.leak@gmail.com/carts/a1b2c3d4-e5f6-7788-99aa-bbccddeeff00',
    { cookies: [{ name: 'JSESSIONID', value: 'LEAKVALUE1' }], price: { value: 33.75, formattedValue: '33.75 EGP' } }),
  entry('POST', 'https://api.x.com/authorizationserver/oauth/token',
    { access_token: 'LEAKTOKEN2', token_type: 'bearer', expires_in: 3600 },
    { mimeType: 'application/x-www-form-urlencoded', text: 'grant_type=password&username=LEAKUSER3&password=LEAKPASS4&client_secret=LEAKSEC5' }),
  entry('GET', 'https://api.x.com/occ/v2/pharma/users/01012345678/orders?access_token=LEAKQ6',
    { formattedValue: 'Card 4111111111111111', orders: [{ code: '00012345', value: 'LEAKTOK7xyzLEAK' }] }),
  entry('GET', 'https://api.x.com/x/LEAKPATHTOKEN8eyJhbGciOiJIUzI1NiJ9abcdefgh/y', { ok: true }, undefined,
    [{ name: 'X-Api-Key', value: 'LEAKHDR9' }]),
] } };

const out = JSON.stringify(sanitizeHar(har));
for (const secret of ['LEAK', 'ahmed', 'gmail', '01012345678', '4111111111111111']) {
  assert.ok(!out.includes(secret), `sanitized output must not contain ${secret}`);
}
assert.ok(out.includes('"value":33.75'), 'numeric price sample kept');
assert.ok(out.includes('33.75 EGP'), 'money text sample kept');
assert.ok(out.includes('"expires_in":3600'), 'expires_in kept');

// Numbers under price/discount/quantity-like names are kept; ids are not.
{
  const har2 = { log: { entries: [entry('GET', 'https://m.example.com/api/offers', { offers: [{ seller_name: 'LEAKSELLER', unit_price: 41.5, discount_percentage: 12, available_quantity: 80, seller_id: 5551234 }] })] } };
  const o2 = JSON.stringify(sanitizeHar(har2));
  assert.ok(o2.includes('"unit_price":41.5') && o2.includes('"discount_percentage":12') && o2.includes('"available_quantity":80'), 'numeric price/discount/qty samples kept');
  assert.ok(!o2.includes('5551234') && !o2.includes('LEAKSELLER'), 'ids and names not kept');
}

// Normal API paths must stay readable.
assert.equal(templatePath('/occ/v2/pharma/products/search'), '/occ/v2/pharma/products/search');
assert.equal(templatePath('/occ/v2/pharma/users/current/carts'), '/occ/v2/pharma/users/current/carts');
assert.equal(templatePath('/occ/v2/pharma/products/000000000000028851'), '/occ/v2/pharma/products/{id}');
assert.equal(templatePath('/occ/v2/pharma/users/a@b.com/carts'), '/occ/v2/pharma/users/{id}/carts');

console.log('procurement-discovery-leaks checks passed');
