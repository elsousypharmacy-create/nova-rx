// UX329: markers test for worker/live/nova-rx-preview.qa-314.js (UX315-UX328 frontend changes embedded). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.qa-314.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.ux-407.js');
const tmp = fs.mkdtempSync('/tmp/qa314-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  UX315: ['--nova-brand-w', 'nova-nav-chev'],
  UX316: ['novaFilterClear', 'nova-search-wrap'],
  UX317: ['__novaCustFilter', 'debtMap', 'overdueMap'],
  UX318: ['novaCustAdd'],
  UX319: ['openCustDetail', 'novaCustDetail', 'novaCustDetailT', 'aria-sort'],
  UX320: ['openCustAdd', 'novaCustAddDlg', 'novaCustAddT'],
  UX321: ['dlgA11y'],
  UX322: ['novaChronic', 'CHRONIC_CYCLE_DAYS'],
  UX327: ['nova-cust-namebox', 'nova-cust-ar', 'nova-cust-en', 'data-cust-row'],
  UX328: ['nova-sale-number', 'novaHintHide', 'empty-invoice-state'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ck('embedded app equals index.html', html === src);
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to ux-407', strip(art) === strip(base));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
