// The supplier UI is packed into ONE html file for the Worker. This checks the packer output.
// Run: node tests/unit/procurement-pack-ui.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const dir = mkdtempSync(path.join(tmpdir(), 'nova-pack-'));
const out = path.join(dir, 'packed.html');
execFileSync('node', ['tools/inject-supplier-ui.mjs', 'index.html', out], { stdio: 'pipe' });
const html = readFileSync(out, 'utf8');

for (const id of ['nova-supplier-css', 'nova-supplier-model', 'nova-supplier-provider', 'nova-supplier-lookup']) {
  assert.ok(html.includes(`id="${id}"`), `${id} block present`);
}
assert.ok(!/supplier-lookup\.(js|css)"/.test(html), 'no external supplier files referenced');
assert.ok(!html.includes("import('./worker"), 'no relative dynamic import left');

// Packing twice (or packing an already packed page) must not duplicate blocks.
const out2 = path.join(dir, 'packed2.html');
execFileSync('node', ['tools/inject-supplier-ui.mjs', out, out2], { stdio: 'pipe' });
assert.equal((readFileSync(out2, 'utf8').match(/id="nova-supplier-lookup"/g) || []).length, 1, 'idempotent');

// The model script runs and exposes the functions the UI needs.
const scripts = [...html.matchAll(/<script id="nova-supplier-(model|provider|lookup)">([\s\S]*?)<\/script>/g)];
const model = scripts.find((m) => m[1] === 'model')[2];
const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(sandbox);
vm.runInContext(model, sandbox);
const api = sandbox.window.NOVA_UI_MODEL;
assert.equal(typeof api.buildLookupModel, 'function');
assert.equal(typeof api.stockUnitState, 'function');
assert.equal(typeof api.createDraftStore, 'function');
assert.equal(api.stockUnitState(28).tone, 'low');
assert.equal(api.stockUnitState(120).tone, 'ok');

// Provider and lookup scripts at least parse.
for (const m of scripts) new vm.Script(m[2], { filename: `nova-supplier-${m[1]}.js` });

console.log('procurement-pack-ui checks passed');
