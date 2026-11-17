// Check a preview Worker artifact without printing its content: node --check, app HTML equals index.html, the listed
// same-origin assets equal the repo files, and the rest of the Worker equals BASE (outside the HTML literal and asset tables).
// Usage: node tools/check-preview-artifact.mjs ARTIFACT.js BASE.js [/asset.js ...]
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [, , ART, BASE, ...assets] = process.argv;
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 'art-'));
execFileSync(process.execPath, ['tools/build-worker-artifact.mjs', '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8'); rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');
ck('app HTML equals index.html', app === readFileSync('index.html', 'utf8'));
const TABLE = /^\s*const (?:NOVA_PURCHASING_ASSETS|NOVA_STATIC_ASSETS)\s*=\s*(\{.*\});\s*$/;
const strip = (s) => s.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>') && !TABLE.test(l)).join('\n');
ck('worker code equals base outside the HTML literal and asset tables', strip(raw) === strip(readFileSync(BASE, 'utf8')));
const tables = raw.split('\n').map((l) => l.match(TABLE)).filter(Boolean).map((m) => JSON.parse(m[1]));
for (const a of assets) ck('asset ' + a + ' equals repo file', tables.some((t) => t[a] && t[a].body === readFileSync(a.slice(1), 'utf8')));
console.log('sha256', createHash('sha256').update(raw).digest('hex'), Buffer.byteLength(raw), 'bytes');
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
