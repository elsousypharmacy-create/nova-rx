import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [, , basePath, outPath] = process.argv;
if (!basePath || !outPath) {
  throw new Error('Usage: node tools/patch-suppliers-pinless.mjs BASE_WORKER.js OUT_WORKER.js');
}

const OLD_REQUIRE_PIN = [
  '  async function requirePin(request) {',
  "    if (!env.NOVA_API_PIN) return json({ error: 'not-configured' }, 503);",
  '    if (tooManyFailures(Date.now())) return lockedResponse(Date.now());',
  "    if (!(await secretsEqual(request.headers.get('X-Nova-Pin'), env.NOVA_API_PIN))) {",
  '      failCount += 1;',
  "      return json({ error: 'unauthorized' }, 401);",
  '    }',
  '    return null;',
  '  }',
].join('\n');

const NEW_REQUIRE_PIN = [
  '  async function requirePin(request) {',
  '    // Owner decision: PIN removed from supplier/purchasing preview routes (nobody uses it yet).',
  '    return null;',
  '  }',
].join('\n');

let src = fs.readFileSync(basePath, 'utf8');

const pinParts = src.split(OLD_REQUIRE_PIN);
if (pinParts.length !== 2) {
  throw new Error(`Expected OLD requirePin exactly once, found ${pinParts.length - 1}`);
}
src = pinParts[0] + NEW_REQUIRE_PIN + pinParts[1];

const providerBody = fs.readFileSync(path.resolve(process.cwd(), 'supplier-provider.js'), 'utf8');

let updatedCount = 0;
const lines = src.split('\n');
for (let i = 0; i < lines.length; i += 1) {
  const match = lines[i].match(/^(\s*const (?:NOVA_PURCHASING_ASSETS|NOVA_STATIC_ASSETS)\s*=\s*)(\{.*\});\s*$/);
  if (!match) continue;
  const table = JSON.parse(match[2]);
  if (Object.prototype.hasOwnProperty.call(table, '/supplier-provider.js')) {
    table['/supplier-provider.js'].body = providerBody;
    updatedCount += 1;
  }
  lines[i] = `${match[1]}${JSON.stringify(table)};`;
}

if (updatedCount === 0) {
  throw new Error('Key /supplier-provider.js was not found in NOVA_PURCHASING_ASSETS or NOVA_STATIC_ASSETS');
}

const output = lines.join('\n');
fs.writeFileSync(outPath, output, 'utf8');

const bytes = Buffer.byteLength(output, 'utf8');
const sha256 = crypto.createHash('sha256').update(output, 'utf8').digest('hex');
console.log(`wrote ${outPath} ${bytes} ${sha256}`);
