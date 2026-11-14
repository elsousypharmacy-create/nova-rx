// UX243: markers test for worker/live/nova-rx-preview.qa-231.js (UX232-UX242 + earlier). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.qa-231.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.qa-219.js');
const tmp = fs.mkdtempSync('/tmp/qa231-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  UX232: ['wa-root'],
  UX233: ['data-wa-reload', 'data-wa-back', 'data-wa-lock'],
  UX234: ['wa-sk-in', 'wa-chat-err', 'wa-chat-loading', 'aria-busy'],
  UX235: ['data-wa-locked-empty', 'UX235'],
  UX236: ['UX236', 'wa-search'],
  UX237: ['wa-date'],
  UX238: ['aria-label', 'data-wa-older'],
  UX239: ['wa-head-lock', 'wa-sub', 'wa-head-txt'],
  UX240: ['wa-lockform', 'wa-pintog', 'wa-pinsubmit', 'wa-lockst'],
  UX241: ['UX241', 'data-wa-latest'],
  UX242: ['wa-state', 'data-retry', 'wa-pin-hint', 'wa-lock-err'],
  qa219: ['nova-ret-badge', 'nova-ret-full', 'nova-ret-head', 'nova-return-overlay', 'nova-ret-history', 'nova-act-ghost', 'aria-modal'],
  earlier: ['nova-tab', 'novaCatalog', 'data-return'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
// worker code outside the HTML literal is byte-identical to qa-219
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to qa-219', strip(art) === strip(base));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
