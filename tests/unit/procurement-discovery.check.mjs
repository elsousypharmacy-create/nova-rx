import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sanitizeHar, templatePath } from '../../tools/discovery/sanitize-har.mjs';
import { renderReport } from '../../tools/discovery/report-skeleton.mjs';

// Distinctive synthetic secret values: none of these may survive sanitization.
const SECRET = {
  password: 'Sup3rSecret-Passw0rd!-777',
  accessToken: 'secret-access-token-value-000111',
  refreshToken: 'secret-refresh-token-value-000222',
  bearer: 'xyz-bearer-secret-333444',
  cookie: 'SESSIONID=super-secret-cookie-555666',
  queryToken: 'abc-query-token-secret-777888',
  email: 'secret.user@example.com',
  phone: '+201555123456'
};

const LOGIN_RESPONSE = JSON.stringify({
  access_token: SECRET.accessToken,
  refresh_token: SECRET.refreshToken,
  token_type: 'Bearer',
  expires_in: 3600
});

const PRODUCT_RESPONSE = JSON.stringify({
  code: '000000000000028851',
  name: 'Augmentin 1g 14 tabs',
  price: 42.5,
  currencyIso: 'EGP',
  stockLevelStatus: 'inStock',
  email: SECRET.email,
  phone: SECRET.phone
});

function har() {
  return {
    log: {
      version: '1.2',
      entries: [
        {
          _resourceType: 'xhr',
          request: {
            method: 'POST',
            url: 'https://supplier.example.com/occ/v2/pharma/login',
            headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
            postData: {
              mimeType: 'application/x-www-form-urlencoded',
              text: `username=pharmacist1&password=${encodeURIComponent(SECRET.password)}`
            }
          },
          response: {
            status: 200,
            content: { mimeType: 'application/json', text: LOGIN_RESPONSE }
          }
        },
        {
          _resourceType: 'fetch',
          request: {
            method: 'POST',
            url: 'https://supplier.example.com/occ/v2/pharma/login',
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            postData: {
              mimeType: 'application/json',
              text: JSON.stringify({ credentials: { username: 'pharmacist1', password: SECRET.password } })
            }
          },
          response: {
            status: 200,
            content: { mimeType: 'application/json', text: LOGIN_RESPONSE }
          }
        },
        {
          _resourceType: 'xhr',
          request: {
            method: 'GET',
            url: `https://supplier.example.com/occ/v2/pharma/products/000000000000028851?token=${SECRET.queryToken}&lang=en`,
            headers: [
              { name: 'Authorization', value: `Bearer ${SECRET.bearer}` },
              { name: 'Cookie', value: SECRET.cookie }
            ]
          },
          response: {
            status: 200,
            content: { mimeType: 'application/json', text: PRODUCT_RESPONSE }
          }
        },
        {
          _resourceType: 'image',
          request: { method: 'GET', url: 'https://supplier.example.com/static/logo.png', headers: [] },
          response: { status: 200, content: { mimeType: 'image/png', text: '' } }
        },
        {
          _resourceType: 'stylesheet',
          request: { method: 'GET', url: 'https://supplier.example.com/static/main.css', headers: [] },
          response: { status: 200, content: { mimeType: 'text/css', text: 'body{color:#000}' } }
        }
      ]
    }
  };
}

const output = sanitizeHar(har());
const json = JSON.stringify(output);

// No secret value survives, anywhere in the output.
for (const [name, value] of Object.entries(SECRET)) {
  assert.ok(!json.includes(value), `secret value leaked into output: ${name}`);
}

// Field/header names are kept (names are not values).
assert.ok(json.includes('access_token'), 'field name access_token kept');
assert.ok(json.includes('Authorization'), 'header name Authorization kept');
assert.ok(json.includes('username'), 'body field name username kept');
assert.ok(json.includes('password'), 'body field name password kept');

// Only the two API endpoints survive; PNG and CSS entries are dropped.
assert.equal(output.endpointCount, 2, 'PNG and CSS entries dropped');
assert.ok(!json.includes('logo.png') && !json.includes('main.css'), 'static asset paths dropped');

// Path templating: numeric id segment collapses to {id}.
assert.equal(templatePath('/occ/v2/pharma/products/000000000000028851'), '/occ/v2/pharma/products/{id}');
const product = output.endpoints.find((e) => e.pathTemplate === '/occ/v2/pharma/products/{id}');
assert.ok(product, 'product endpoint grouped under {id} template');
assert.equal(product.method, 'GET');
assert.deepEqual(product.queryParamNames, ['lang', 'token'], 'query values dropped, names sorted');
assert.ok(product.requestHeaderNames.includes('Authorization'));
assert.ok(product.requestHeaderNames.includes('Cookie'));
assert.deepEqual(product.statusCodes, [200]);
assert.equal(product.count, 1);
assert.equal(product.sampleValues.price, 42.5);
assert.equal(product.sampleValues.currencyIso, 'EGP');
assert.equal(product.sampleValues.stockLevelStatus, 'inStock');
assert.ok(!('email' in product.sampleValues) && !('phone' in product.sampleValues), 'secret-keyed fields never sampled');

// Login endpoint: form and JSON bodies merge into one group, dotted nested paths.
const login = output.endpoints.find((e) => e.pathTemplate === '/occ/v2/pharma/login');
assert.ok(login, 'login endpoint present');
assert.equal(login.count, 2, 'form and JSON login entries grouped together');
assert.ok(login.requestBodyFieldNames.includes('username'), 'urlencoded body field names kept');
assert.ok(login.requestBodyFieldNames.includes('credentials.username'), 'nested JSON body path kept');
assert.ok(login.requestBodyFieldNames.includes('credentials.password'), 'nested JSON body path kept');
assert.equal(login.sampleValues.expires_in, 3600, 'allowlisted expires_in sample kept');
assert.equal(login.sampleValues.token_type, 'Bearer', 'allowlisted token_type sample kept');
assert.equal(login.responseFields.expires_in, 'number');
assert.equal(login.responseFields.access_token, 'string', 'token field name kept in tree, value never stored');
assert.deepEqual(login.statusCodes, [200]);

// Report skeleton: all required sections, endpoints marked Observed.
const report = renderReport(output, 'PharmaOverseas');
for (const section of [
  '# Supplier discovery report — PharmaOverseas',
  '## Summary',
  '## Endpoints',
  '## Login flow',
  '## Response field map',
  '## Pagination',
  '## Price fields',
  '## Stock fields',
  '## Cart',
  '## Open questions'
]) {
  assert.ok(report.includes(section), `report section missing: ${section}`);
}
assert.ok(report.includes('| Observed |'), 'endpoint rows marked Observed');
for (const value of Object.values(SECRET)) {
  assert.ok(!report.includes(value), 'report skeleton carries no secret values');
}

// CLI end-to-end: sanitize a file, then render a report from it.
const dir = mkdtempSync(join(tmpdir(), 'nova-discovery-'));
const harPath = join(dir, 'input.har');
const outPath = join(dir, 'out.json');
writeFileSync(harPath, JSON.stringify(har()));
const sanitizeRun = spawnSync(process.execPath, ['tools/discovery/sanitize-har.mjs', harPath], {
  encoding: 'utf8',
  cwd: new URL('../../', import.meta.url).pathname
});
assert.equal(sanitizeRun.status, 0, `sanitize CLI failed: ${sanitizeRun.stderr}`);
writeFileSync(outPath, sanitizeRun.stdout);
assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), output, 'CLI output matches library output');
const reportRun = spawnSync(process.execPath, ['tools/discovery/report-skeleton.mjs', outPath, 'PharmaOverseas'], {
  encoding: 'utf8',
  cwd: new URL('../../', import.meta.url).pathname
});
assert.equal(reportRun.status, 0, `report CLI failed: ${reportRun.stderr}`);
assert.ok(reportRun.stdout.includes('## Endpoints'), 'report CLI prints the skeleton');

// Performance: a synthetic ≥ 5 MB HAR sanitizes in under 2 seconds.
const big = har();
let size = JSON.stringify(big).length;
let i = 0;
while (size < 5 * 1024 * 1024) {
  i += 1;
  big.log.entries.push({
    _resourceType: 'xhr',
    request: {
      method: 'GET',
      url: `https://supplier.example.com/occ/v2/pharma/products/search?q=item${i}&currentPage=${i}`,
      headers: [{ name: 'Accept', value: 'application/json' }]
    },
    response: {
      status: 200,
      content: {
        mimeType: 'application/json',
        text: JSON.stringify({
          totalResults: 5000,
          totalPages: 250,
          currentPage: 1,
          pageSize: 20,
          products: Array.from({ length: 20 }, (_, j) => ({
            code: `CODE-${i}-${j}`,
            name: `Synthetic product name padding ${i} ${j}`,
            price: 10 + j,
            currencyIso: 'EGP',
            stockLevelStatus: 'inStock'
          }))
        })
      }
    }
  });
  size += 1400; // conservative per-entry estimate; final check below
}
size = JSON.stringify(big).length;
assert.ok(size >= 5 * 1024 * 1024, `synthetic HAR must reach 5 MB (got ${size})`);
const t0 = performance.now();
const bigOut = sanitizeHar(JSON.parse(JSON.stringify(big)));
const elapsed = performance.now() - t0;
assert.ok(elapsed < 2000, `5 MB HAR processed in ${elapsed.toFixed(0)} ms (limit 2000 ms)`);
assert.ok(bigOut.endpoints.some((e) => e.pathTemplate === '/occ/v2/pharma/products/search'), 'big HAR grouped');

console.log('procurement-discovery checks passed');
