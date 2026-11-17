// S1-05: NOVA_AUTH / NOVA_SYNC / NOVA_SALES_WRITES are "1" in [env.staging.vars] ONLY; top-level [vars] (dev) and
// [env.production.vars] do not set them. Reads backend/wrangler.toml, no network. Run: node tests/unit/wrangler-stage1-flags.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
const sections = {}; let cur = '';
for (const raw of toml.split(/\r?\n/)) {
  const line = raw.replace(/#.*$/, '').trim();
  const h = /^\[\[?([^\]]+)\]\]?$/.exec(line);
  if (h) { cur = h[1].trim(); sections[cur] = sections[cur] || []; continue; }
  if (line) (sections[cur] = sections[cur] || []).push(line);
}
const val = (sec, k) => { for (const l of sections[sec] || []) { const m = new RegExp('^' + k + '\\s*=\\s*"?([^"\\s]*)"?$').exec(l); if (m) return m[1]; } return undefined; };
const FLAGS = ['NOVA_AUTH', 'NOVA_SYNC', 'NOVA_SALES_WRITES'];
for (const f of FLAGS) {
  assert.equal(val('env.staging.vars', f), '1', 'staging ' + f + ' = "1"');
  assert.equal(val('env.production.vars', f), undefined, 'production must not set ' + f);
  assert.equal(val('vars', f), undefined, 'top-level dev vars must not set ' + f);
}
assert.equal(val('env.staging.vars', 'NOVA_ENV'), 'staging'); assert.equal(val('env.production.vars', 'NOVA_ENV'), 'production');
console.log('wrangler-stage1-flags OK');
