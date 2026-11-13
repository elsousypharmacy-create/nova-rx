import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, newRequestId } from '../../backend/src/index.js';

const req = (path, init = {}) => new Request('https://x.test' + path, init);
const env = { CORS_ALLOW_ORIGINS: 'https://a.test, https://b.test', NOVA_ENV: 'staging' };

let r = await handle(req('/api/v1/health'), env);
assert.equal(r.status, 200);
let b = await r.json();
assert.equal(b.ok, true);
assert.match(b.requestId, /^req_[0-9a-f]{16}$/);
assert.equal(r.headers.get('X-Request-Id'), b.requestId);

r = await handle(req('/api/v1/version/'), env);
b = await r.json();
assert.equal(b.name, 'nova-rx-api'); assert.equal(b.env, 'staging');

r = await handle(req('/api/v1/nope'), env);
b = await r.json();
assert.equal(r.status, 404);
assert.deepEqual(Object.keys(b).sort(), ['code', 'message_ar', 'ok', 'requestId']);
assert.equal(b.ok, false); assert.equal(b.code, 'NOT_FOUND'); assert.match(b.message_ar, /[؀-ۿ]/);

r = await handle(req('/api/v1/health', { method: 'POST' }), env);
assert.equal(r.status, 405); assert.equal((await r.json()).code, 'METHOD_NOT_ALLOWED');

r = await handle(req('/api/v1/health', { headers: { Origin: 'https://b.test' } }), env);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://b.test');
r = await handle(req('/api/v1/health', { headers: { Origin: 'https://evil.test' } }), env);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
r = await handle(req('/api/v1/health', { headers: { Origin: 'https://b.test' } }), {});
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);

r = await handle(req('/api/v1/health', { method: 'OPTIONS', headers: { Origin: 'https://a.test' } }), env);
assert.equal(r.status, 204);

assert.notEqual(newRequestId(), newRequestId());

// wrangler: staging may have real D1/KV ids after GATE-11; dev and production stay placeholders.
// R2 is not bound (billing card required; owner declined). Backups use D1 Time Travel + encrypted artifacts.
const t = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
assert.match(t, /name = "nova-rx-api"/);
for (const k of ['binding = "DB"', 'binding = "KV"', '[env.staging]', '[env.production]']) assert.ok(t.includes(k), k);
assert.doesNotMatch(t, /binding = "R2"/);
assert.doesNotMatch(t, /^\[\[(?:env\.\w+\.)?r2_buckets\]\]/m);
assert.match(t, /database_name = "nova-rx-dev"\s*\ndatabase_id = "PLACEHOLDER_D1_DEV_ID"/);
assert.match(t, /database_name = "nova-rx-production"\s*\ndatabase_id = "PLACEHOLDER_D1_PRODUCTION_ID"/);
assert.match(t, /database_name = "nova-rx-staging"\s*\ndatabase_id = "[0-9a-f-]{36}"/);
assert.match(t, /id = "PLACEHOLDER_KV_DEV_ID"/);
assert.match(t, /id = "PLACEHOLDER_KV_PRODUCTION_ID"/);
assert.doesNotMatch(t, /PLACEHOLDER_D1_STAGING_ID|PLACEHOLDER_KV_STAGING_ID/);

// feature flag defaults OFF: app code must not reference the new backend
const app = readFileSync(new URL('../../backend/README.md', import.meta.url), 'utf8');
assert.match(app, /defaults OFF/);
console.log('backend-router.check: PASS');
