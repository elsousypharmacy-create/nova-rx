// UX313: markers test for worker/live/nova-rx-preview.qa-301.js (UX302-UX312 + earlier). No deploy.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.qa-301.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.ux-407.js');
const tmp = fs.mkdtempSync('/tmp/qa301-'); const out = path.join(tmp, 'app.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
const html = fs.readFileSync(out, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  UX302: ['novaNormAr', 'u0622\\u0623\\u0625'.slice(0, 0) + 'const hl=(txt,nq)'],
  UX303: ['novaNearExpiryKpi', 'nova-low-badge', 'أقرب صلاحية'],
  UX304: ['novaStockChips', 'novaStockFilter', 'fTests'],
  UX305: ['nova-sort-btn', 'data-sort-dir', 'nova-row-focus', '.nova-data-table thead th{position:sticky'],
  UX306: ['#novaAiLaunch{display:none!important}'],
  UX307: ['UX307: compact product cards', 'nova-kpis-prod'],
  UX308: ['UX308: mobile nav chevron', 'nova-nav-chev'],
  UX309: ['novaStockChip', 'nova-stock-ok', 'nova-stock-low', 'nova-stock-out'],
  UX310: ['btnCloseCheckout', 'btnCloseReceipt', 'btnCloseHelp', 'nova-help-chip'],
  UX311: ['nova-products-toolbar', 'nova-demo-chip', 'nova-kpis-compact'],
  UX312: ['nova-stock-missing-v1', 'nova-stock-snapshot-v1'],
  earlier: ['nova-tab', 'novaCatalog', 'data-return', 'nova-ret-badge', 'nova-return-overlay', 'wa-root', 'data-wa-reload'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to ux-407', strip(art) === strip(base));
ck('app HTML equals index.html', html === fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
