import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();

const httpPath = path.resolve(rootDir, 'worker/procurement/provider/http.js');
const httpText = fs.readFileSync(httpPath, 'utf8');
const requirePinMatch = httpText.match(/async function requirePin\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
assert.ok(requirePinMatch, 'requirePin must exist in worker/procurement/provider/http.js');
assert.ok(!requirePinMatch[0].includes('X-Nova-Pin'), 'requirePin body must not read X-Nova-Pin');
assert.ok(requirePinMatch[0].includes('return null;'), 'requirePin body must return null');

const providerPath = path.resolve(rootDir, 'supplier-provider.js');
const providerText = fs.readFileSync(providerPath, 'utf8');
assert.ok(!providerText.includes('window.prompt'), 'supplier-provider.js must not contain window.prompt');
assert.ok(!providerText.includes('X-Nova-Pin'), 'supplier-provider.js must not contain X-Nova-Pin');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suppliers-pinless-test-'));
try {
  const fakeBasePath = path.join(tmpDir, 'base-worker.js');
  const fakeOutPath = path.join(tmpDir, 'out-worker.js');

  const fakeAssets = {
    '/supplier-provider.js': {
      body: 'window.prompt("old");',
      type: 'application/javascript; charset=utf-8',
    },
  };

  const fakeBaseContent = [
    `const NOVA_PURCHASING_ASSETS=${JSON.stringify(fakeAssets)};`,
    'function createProvider() {',
    '  async function requirePin(request) {',
    "    if (!env.NOVA_API_PIN) return json({ error: 'not-configured' }, 503);",
    '    if (tooManyFailures(Date.now())) return lockedResponse(Date.now());',
    "    if (!(await secretsEqual(request.headers.get('X-Nova-Pin'), env.NOVA_API_PIN))) {",
    '      failCount += 1;',
    "      return json({ error: 'unauthorized' }, 401);",
    '    }',
    '    return null;',
    '  }',
    '  return { requirePin };',
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(fakeBasePath, fakeBaseContent, 'utf8');

  const patchScript = path.resolve(rootDir, 'tools/patch-suppliers-pinless.mjs');
  const stdout = execFileSync(process.execPath, [patchScript, fakeBasePath, fakeOutPath], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

  assert.match(stdout, new RegExp(`^wrote .* \\d+ [a-f0-9]{64}$`));

  const patchedText = fs.readFileSync(fakeOutPath, 'utf8');
  assert.ok(!patchedText.includes('X-Nova-Pin'), 'Patched worker must not contain X-Nova-Pin in requirePin');
  assert.ok(!patchedText.includes('window.prompt("old")'), 'Patched worker must replace old supplier-provider.js asset body');

  const assetLineMatch = patchedText.match(/^const NOVA_PURCHASING_ASSETS=(\{.*\});$/m);
  assert.ok(assetLineMatch, 'Patched worker must preserve NOVA_PURCHASING_ASSETS line');
  const parsedAssets = JSON.parse(assetLineMatch[1]);
  assert.equal(parsedAssets['/supplier-provider.js'].body, providerText);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
