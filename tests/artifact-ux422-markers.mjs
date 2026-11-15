// UX422: markers test for worker/live/nova-rx-preview.ux-422.js = wa-live3 Worker code + current index.html (main SPA design skin).
// Conversations markers (PIN-free/history, FIX50, FIX51, WA-SEND, wa UI) must survive. No deploy. Run: node tests/artifact-ux422-markers.mjs
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const art = path.join(ROOT, 'worker/live/nova-rx-preview.ux-422.js');
const base = path.join(ROOT, 'worker/live/nova-rx-preview.wa-live3.js');
const tmp = fs.mkdtempSync('/tmp/ux422-'); const out = path.join(tmp, 'app.html'), baseOut = path.join(tmp, 'base.html');
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', art, out]);
execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', base, baseOut]);
execFileSync('node', ['--check', art]);
const html = fs.readFileSync(out, 'utf8'), baseHtml = fs.readFileSync(baseOut, 'utf8');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const M = {
  history: ['hLoad', 'inbox/history', 'waHistPin'],
  FIX50: ['NOVA_FIX50', 'NOVA_FIX50_VV'],
  FIX51: ['hPoll', 'winClosed', 'data-wa-window'],
  WASEND: ['hSend', 'X-Nova-Pin'],
  UX: ['wa-root', 'wa-lockform', 'wa-date', 'novaWaBtn', 'novaInboxView'],
  UX422: ['id="UX422_APP_SKIN"', '#novaPageView .nova-kpi', 'nx422-in', 'prefers-reduced-motion:reduce){#novaPageView'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, html.includes(m));
for (const ms of Object.values(M).slice(0, 5)) for (const m of ms) ck('marker count not reduced vs wa-live3: ' + m, html.split(m).length >= baseHtml.split(m).length);
const skin = html.slice(html.indexOf('<style id="UX422_APP_SKIN">'), html.indexOf('</style>', html.indexOf('<style id="UX422_APP_SKIN">')));
ck('skin never targets conversations selectors', skin.length > 1000 && !/novaInboxView|novaWa|\.wa-|waHist|\[data-wa|nova-nav-brand|\.wd\b/.test(skin.replace(/\/\*[\s\S]*?\*\//g, '')));
ck('no user-scalable=no', !/user-scalable\s*=\s*no/.test(html));
ck('app HTML equals main index.html', html === fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside HTML literal identical to wa-live3', strip(art) === strip(base));
fs.rmSync(tmp, { recursive: true });
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
