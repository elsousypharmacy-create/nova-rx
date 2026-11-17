// S2-01 preview artifact check: worker/live/nova-rx-preview.s2-01.js = suppliers-pinless Worker + current index.html.
// Prints only PASS/FAIL lines and the sha256 (never bundle content). Run: node tools/check-s201-artifact.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const ART = 'worker/live/nova-rx-preview.s2-01.js', BASE = 'worker/live/nova-rx-preview.suppliers-pinless.js';
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 's201-'));
execFileSync(process.execPath, ['tools/build-worker-artifact.mjs', '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8'); rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');
ck('app HTML equals index.html', app === readFileSync('index.html', 'utf8'));
const noHtml = (s) => s.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside the app HTML identical to suppliers-pinless', noHtml(raw) === noHtml(readFileSync(BASE, 'utf8')));
for (const m of ["entity = 'sale_return'", "c.entity === 'sale_return'", 'createScheduler', 'S1-03:BEGIN']) ck('marker ' + m, app.includes(m) || raw.includes(m));
console.log('sha256', createHash('sha256').update(raw).digest('hex'), Buffer.byteLength(raw), 'bytes');
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
