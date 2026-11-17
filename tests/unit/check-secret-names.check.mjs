// S1-08: the names-only secret check with mocked GitHub + Cloudflare APIs (never the network). It reports yes/no per NAME,
// never a value, and a missing permission is reported by NAME. Run: node tests/unit/check-secret-names.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, fetchWorkerBindings, fetchGithubSecretNames, format, REQUIRED, WA_PHONE_ID_EXPECTED } from '../../tools/backend/check-secret-names.mjs';

const VALUE = 'super-secret-value-should-never-print-123';
const res = (body, status = 200) => ({ ok: status < 400, status, async json() { return body; } });
const calls = [];
const fetchOk = async (url) => { calls.push(url);
  if (url.includes('api.cloudflare.com')) return res({ success: true, result: { bindings: [{ name: 'NOVA_API_PIN', type: 'secret_text', text: VALUE }, { name: 'NOVA_INGEST_SECRET', type: 'plain_text', text: VALUE }, { name: 'DB', type: 'd1' }] } });
  return res({ secrets: [{ name: 'NOVA_API_PIN', value: VALUE }, { name: 'CLOUDFLARE_API_TOKEN' }] });
};
const w = await fetchWorkerBindings(fetchOk, { accountId: 'acc', token: 't' });
const g = await fetchGithubSecretNames(fetchOk, { repo: 'o/r', token: 't' });
assert.ok(!JSON.stringify(w).includes(VALUE) && !JSON.stringify(g).includes(VALUE), 'fetchers keep names/types only');
const s = summarize(g.names, w.bindings);
assert.deepEqual(s.rows, [{ name: 'NOVA_API_PIN', github: true, worker: true }, { name: 'NOVA_INGEST_SECRET', github: false, worker: false }], 'plain_text is not a secret binding');
assert.equal(s.ok, false);
const text = format(s);
assert.ok(text.includes('NOVA_INGEST_SECRET: github=NO') && text.includes('MISSING') && !text.includes(VALUE));
assert.ok(summarize(REQUIRED, REQUIRED.map((name) => ({ name, type: 'secret_text' }))).ok);
// missing permission -> the permission NAME, no data
const f403 = async () => res({}, 403);
assert.match((await fetchWorkerBindings(f403, { accountId: 'a', token: 't' })).error, /Workers Scripts:Read/);
assert.match((await fetchGithubSecretNames(f403, { repo: 'o/r', token: 't' })).error, /secrets:read/);
assert.equal(calls.length, 2, 'mocked fetch only');
// WA_PHONE_ID expected value is documented, and nothing calls register/deregister
assert.equal(WA_PHONE_ID_EXPECTED, '515646411625617');
const doc = readFileSync(new URL('../../docs/ops/S1-08_SECRETS_AND_WA_PHONE_ID.md', import.meta.url), 'utf8');
assert.ok(doc.includes('515646411625617') && doc.includes('NOVA_API_PIN') && doc.includes('NOVA_INGEST_SECRET'));
const src = readFileSync(new URL('../../tools/backend/check-secret-names.mjs', import.meta.url), 'utf8');
assert.ok(!/register|deregister|method:\s*'(PUT|POST|DELETE|PATCH)'/i.test(src.replace(/never sets, rolls or deletes/, '')), 'read-only: no register/deregister, no writes');
console.log('check-secret-names OK');
