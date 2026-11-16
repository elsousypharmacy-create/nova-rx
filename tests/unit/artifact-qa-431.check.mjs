// UX444: markers test for worker/live/nova-rx-preview.qa-431.js (UX432-UX443 frontend changes embedded). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.qa-431.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.ux-407.js');
const tmp = fs.mkdtempSync('/tmp/qa431-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  UX432: ['d.expected=Math.round((v+d.drawer+d.cashDebt)'],
  UX433: ['nova-rx-shift-closings-v1', 'novaShiftDo', 'إقفال الوردية'],
  UX434: ['__novaShiftNoteOk', "st==='short'?'▼ '+tr('عجز'"],
  UX436: ['novaShiftFormula', 'الصيغة: افتتاح'],
  UX437: ['novaKpiPeriod', 'novaKpiTotals'],
  UX438: ['sinceclose', 'من آخر إقفال'],
  UX439: ['data-top-head', 'الإيراد'],
  UX440: ['تحديث التطبيق', 'aria-label="تحديث التطبيق"'],
  UX441: ['phraseCache'],
  UX442: ['توقيع', 'novaDayReport'],
  UX443: ['بيانات تجريبية', 'nova-demo-label'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ck('embedded app equals index.html', html === src);
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to ux-407', strip(art) === strip(base));
execFileSync('node', ['--check', art]);
ck('node --check qa-431', true);
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
