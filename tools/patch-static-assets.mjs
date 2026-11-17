// Replace (or add) same-origin assets inside a nova-rx-preview Worker export (NOVA_STATIC_ASSETS / NOVA_PURCHASING_ASSETS
// one-line JSON tables) with the current repo files. Nothing else changes. Never prints bundle content.
// Usage: node tools/patch-static-assets.mjs BASE_WORKER.js OUT_WORKER.js /credit-ledger.js [/purchases=purchases.html] [+/new-file.js ...]
//   /path   = replace the body of an existing asset (every table that has it); the repo file is the path without the leading slash
//   +/path  = add a new asset next to /purchases.html (the purchases page table); fails if that table is missing
import fs from 'node:fs';
import crypto from 'node:crypto';

const [, , basePath, outPath, ...args] = process.argv;
if (!basePath || !outPath || !args.length) throw new Error('Usage: node tools/patch-static-assets.mjs BASE OUT /asset.js [+/new.js ...]');
const TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const typeOf = (p) => TYPES[(p.match(/\.[a-z]+$/) || [''])[0]] || 'application/octet-stream';

const lines = fs.readFileSync(basePath, 'utf8').split('\n');
const done = new Set();
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^(\s*const (?:NOVA_PURCHASING_ASSETS|NOVA_STATIC_ASSETS)\s*=\s*)(\{.*\});\s*$/);
  if (!m) continue;
  const table = JSON.parse(m[2]);
  let changed = false;
  for (const a of args) {
    const add = a.startsWith('+'), spec = add ? a.slice(1) : a;
    const [u, file] = spec.includes('=') ? spec.split('=') : [spec, spec.replace(/^\//, '')]; // /route=repo-file for routes without an extension
    const body = fs.readFileSync(file, 'utf8');
    if (Object.prototype.hasOwnProperty.call(table, u)) { table[u].body = body; done.add(a); changed = true; }
    else if (add && Object.prototype.hasOwnProperty.call(table, '/purchases.html')) {
      const sample = table['/purchases.html'];
      table[u] = { ...sample, body, type: typeOf(u) }; // same entry shape as the page itself
      done.add(a); changed = true;
    }
  }
  if (changed) lines[i] = `${m[1]}${JSON.stringify(table)};`;
}
const missing = args.filter((u) => !done.has(u));
if (missing.length) throw new Error('asset not patched: ' + missing.join(', '));
const out = lines.join('\n');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`wrote ${outPath} ${Buffer.byteLength(out, 'utf8')} ${crypto.createHash('sha256').update(out, 'utf8').digest('hex')}`);
