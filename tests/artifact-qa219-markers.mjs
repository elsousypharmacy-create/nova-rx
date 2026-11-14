// UX230: markers test for worker/live/nova-rx-preview.qa-219.js (UX220-UX229 + earlier). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.qa-219.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.qa-203.js');
const tmp = fs.mkdtempSync('/tmp/qa219-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  UX220: ['nova-ret-badge', 'nova-ret-full', 'nova-act-done', 'aria-disabled'],
  UX221: ['nova-ret-head', 'nova-return-overlay', 'nova-dlg-x'],
  UX222: ['aria-invalid'],
  UX223: ['aria-labelledby', 'aria-modal'],
  UX224: ['nova-cx-body'],
  UX225: ['nova-ret-body', 'nova-ret-foot', 'nova-ret-actions'],
  UX226: ['aria-live', 'nova-return-btn'],
  UX227: ['nova-act-ghost', 'nova-act-return', 'nova-act-ico'],
  UX228: ['nova-ret-history'],
  earlier: ['nova-tab', 'novaCatalog', 'data-return'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
// worker code outside the HTML literal is byte-identical to qa-203
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to qa-203', strip(art) === strip(base));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
