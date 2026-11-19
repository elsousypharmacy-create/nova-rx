#!/usr/bin/env node
// Refresh a nova-rx-preview Worker artifact from the current repo files, changing ONLY content, never routes or Worker code:
//  1. app HTML  <- index.html (build-worker-artifact.mjs), /sw.js <- sw.js
//  2. every route already in NOVA_PURCHASING_ASSETS / NOVA_STATIC_ASSETS gets the current body of its repo file
//  3. files the pages load that the base has no route for are ADDED to NOVA_PURCHASING_ASSETS (listed in EXTRA_ROUTES below)
// Usage: node tools/build-preview-refresh.mjs BASE_WORKER.js OUT_WORKER.js     (local only: no network, no deploy)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const EXTRA_ROUTES = {
  '/receipt-operations.js': ['receipt-operations.js', 'application/javascript; charset=utf-8'],
  '/purchases-history.js': ['purchases-history.js', 'application/javascript; charset=utf-8'],
  '/purchases-history.css': ['purchases-history.css', 'text/css; charset=utf-8'],
  '/staff-gate.js': ['staff-gate.js', 'application/javascript; charset=utf-8'] // SEC-01 / S1-07 staff login gate
};
const TABLES = ['NOVA_PURCHASING_ASSETS', 'NOVA_STATIC_ASSETS'];
const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error('usage: build-preview-refresh.mjs BASE_WORKER.js OUT_WORKER.js'); process.exit(2); }

const tmp = out + '.tmp';
execFileSync(process.execPath, ['tools/build-worker-artifact.mjs', base, 'index.html', tmp, '--sw', 'sw.js'], { stdio: 'pipe' });
let code = fs.readFileSync(tmp, 'utf8'); fs.unlinkSync(tmp);

const fileFor = (route) => route.replace(/^\//, '');
let changed = 0, added = 0;
for (const name of TABLES) {
  const re = new RegExp('const ' + name + '=(\\{.*?\\});\\n', 's');
  const m = re.exec(code); if (!m) throw new Error(name + ' not found');
  const table = JSON.parse(m[1]);
  for (const [route, entry] of Object.entries(table)) {
    if (route === '/purchases' || route === '/purchases.html') { const b = fs.readFileSync('purchases.html', 'utf8'); if (entry.body !== b) { entry.body = b; changed++; } continue; }
    if (route === '/sw.js') continue; // replaced by build-worker-artifact
    const f = fileFor(route);
    if (!fs.existsSync(f)) continue; // not a repo file (kept as is)
    const b = fs.readFileSync(f, 'utf8');
    if (entry.encoding) continue;
    if (entry.body !== b) { entry.body = b; changed++; }
  }
  if (name === 'NOVA_PURCHASING_ASSETS') for (const [route, [f, type]] of Object.entries(EXTRA_ROUTES)) {
    if (!table[route]) { table[route] = { body: fs.readFileSync(f, 'utf8'), type }; added++; }
  }
  code = code.replace(re, () => 'const ' + name + '=' + JSON.stringify(table) + ';\n');
}
fs.writeFileSync(out, code);
console.log('wrote', out, Buffer.byteLength(code), 'bytes; asset bodies refreshed:', changed, 'added routes:', added, 'sha256', crypto.createHash('sha256').update(code).digest('hex'));
