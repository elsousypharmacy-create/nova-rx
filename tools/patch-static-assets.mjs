// Replace the body of existing same-origin assets inside a nova-rx-preview Worker export (NOVA_STATIC_ASSETS / NOVA_PURCHASING_ASSETS
// one-line JSON tables) with the current repo files. Nothing else changes. Never prints bundle content.
// Usage: node tools/patch-static-assets.mjs BASE_WORKER.js OUT_WORKER.js /credit-ledger.js [/other.js ...]
// (the repo file is the URL path without the leading slash)
import fs from 'node:fs';
import crypto from 'node:crypto';

const [, , basePath, outPath, ...urls] = process.argv;
if (!basePath || !outPath || !urls.length) throw new Error('Usage: node tools/patch-static-assets.mjs BASE OUT /asset.js [...]');

const lines = fs.readFileSync(basePath, 'utf8').split('\n');
const done = new Set();
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^(\s*const (?:NOVA_PURCHASING_ASSETS|NOVA_STATIC_ASSETS)\s*=\s*)(\{.*\});\s*$/);
  if (!m) continue;
  const table = JSON.parse(m[2]);
  let changed = false;
  for (const u of urls) {
    if (!Object.prototype.hasOwnProperty.call(table, u)) continue;
    table[u].body = fs.readFileSync(u.replace(/^\//, ''), 'utf8');
    done.add(u); changed = true;
  }
  if (changed) lines[i] = `${m[1]}${JSON.stringify(table)};`;
}
const missing = urls.filter((u) => !done.has(u));
if (missing.length) throw new Error('asset not found in any table: ' + missing.join(', '));
const out = lines.join('\n');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`wrote ${outPath} ${Buffer.byteLength(out, 'utf8')} ${crypto.createHash('sha256').update(out, 'utf8').digest('hex')}`);
