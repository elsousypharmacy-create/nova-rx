// FIX52: markers test for worker/live/nova-rx-preview.wa-live3.js (PIN history + FIX50 + FIX51 + WA-SEND). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.wa-live3.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.wa-live2.js');
const tmp = fs.mkdtempSync('/tmp/fix52-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
execFileSync('node', ['--check', art]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  history: ['hLoad', 'inbox/history', 'waHistPin'],
  FIX50: ['NOVA_FIX50', 'NOVA_FIX50_VV'],
  FIX51: ['hPoll', 'winClosed', 'data-wa-window'],
  WASEND: ['hSend', 'X-Nova-Pin'],
  UX: ['wa-root', 'wa-lockform', 'wa-date'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
ck('no user-scalable=no', !/user-scalable\s*=\s*no/.test(html));
ck('app HTML equals main index.html', html === fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to wa-live2', strip(art) === strip(base));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
