// Builds a Worker artifact with the supplier lookup from a base artifact and runs it in a
// fake Worker environment: supplier routes work end to end (PIN, ingest, status, search with a
// fake supplier), existing routes still answer, and the app page contains the supplier UI.
// Run: node tests/unit/procurement-worker-artifact.check.mjs [BASE_ARTIFACT]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const BASE = process.argv[2] || 'worker/live/nova-rx-preview.with-ux-batch1-3-stickers27.js';
const dir = mkdtempSync(path.join(tmpdir(), 'nova-art-'));
const out = path.join(dir, 'art.js');
execFileSync('node', ['tools/build-supplier-artifact.mjs', BASE, out], { stdio: 'pipe' });
const code = readFileSync(out, 'utf8');

const searchFixture = JSON.parse(readFileSync('tests/fixtures/pharmaoverseas/search-panadol.json', 'utf8'));
const kv = new Map();
let listener = null;
const supplierCalls = [];
const sandbox = {
  addEventListener: (type, fn) => { if (type === 'fetch') listener = fn; },
  Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, crypto, atob, btoa,
  setTimeout, clearTimeout, console,
  fetch: async (url, init) => {
    supplierCalls.push({ url: String(url), auth: init && init.headers && init.headers.Authorization });
    return new Response(JSON.stringify(searchFixture), { status: 200, headers: { 'content-type': 'application/json' } });
  },
  NOVA_SECRETS_KV: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
  NOVA_SECRET_ENCRYPTION_KEY: 'test-encryption-key',
  NOVA_API_PIN: 'a-long-test-pin-123',
  NOVA_INGEST_SECRET: 'a-long-ingest-secret-456',
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'artifact.js' });
assert.equal(typeof listener, 'function', 'fetch listener registered once');

async function call(pathname, init = {}) {
  let result = null;
  listener({ request: new Request('https://worker.test' + pathname, init), respondWith: (p) => { result = p; } });
  assert.ok(result, `route ${pathname} answered`);
  return await result;
}
const PIN = { 'X-Nova-Pin': sandbox.NOVA_API_PIN };

// supplier routes
assert.equal((await call('/api/suppliers/status')).status, 401, 'no PIN -> 401');
const soon = new Date(Date.now() + 3600e3).toISOString();
const ingest = await call('/api/suppliers/session', {
  method: 'POST',
  headers: { 'X-Ingest-Secret': sandbox.NOVA_INGEST_SECRET, 'Content-Type': 'application/json' },
  body: JSON.stringify({ supplierId: 'pharmaoverseas', session: { accessToken: 'secret-token-value' }, expiresAt: soon }),
});
assert.equal(ingest.status, 200);
for (const v of kv.values()) assert.ok(!String(v).includes('secret-token-value'), 'session is stored encrypted');
const status = await (await call('/api/suppliers/status', { headers: PIN })).json();
assert.equal(status.suppliers.find((s) => s.id === 'pharmaoverseas').state, 'ok');
const search = await call('/api/suppliers/search', {
  method: 'POST',
  headers: { ...PIN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'بانادول إكسترا (Panadol Extra 24 Tab)', requestedQty: 1 }),
});
assert.equal(search.status, 200);
const payload = await search.json();
assert.ok(Array.isArray(payload.results) && payload.results.length === 1, 'one compare result');
assert.ok(payload.results[0].offers.length >= 1, 'offers found from the fake supplier');
assert.ok(payload.suppliers.some((s) => s.id === 'pharmaoverseas' && s.state === 'ok'));
assert.ok(supplierCalls.some((c) => /products\/search/.test(c.url) && c.auth === 'Bearer secret-token-value'), 'supplier called with the stored token');
assert.ok(!JSON.stringify(payload).includes('secret-token-value'), 'token never in the answer');

// existing routes still answer
const home = await call('/');
assert.equal(home.status, 200);
const html = await home.text();
for (const id of ['nova-supplier-css', 'nova-supplier-model', 'nova-supplier-provider', 'nova-supplier-lookup']) {
  assert.ok(html.includes(`id="${id}"`), `${id} is in the app page`);
}
assert.equal((await call('/no-such-page')).status, 404);

console.log('procurement-worker-artifact checks passed');
