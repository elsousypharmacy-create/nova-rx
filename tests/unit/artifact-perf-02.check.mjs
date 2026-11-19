// Preview artifact perf-02 = pur-08 Worker (newest on main: sec-01 + PUR-08) + PERF-02 split app: index.html is a shell, its big blocks are served from the
// NOVA_APP_ASSETS table (/assets/app-*.<hash>.js|css, Cache-Control immutable) and sw.js precaches them.
// Built by tools/build-preview-refresh.mjs. No deploy, no network. Run: node tests/unit/artifact-perf-02.check.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitTags, check as splitCheck, joinHtml } from '../../tools/split-index.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.perf-02.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.pur-08.js');
let fail = 0; const ck = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + d)); if (!ok) fail++; };
const art = readFileSync(ART, 'utf8');
const ix = readFileSync(join(ROOT, 'index.html'), 'utf8');

execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
ck('NOVA_BUILD stamp names perf-02', /^const NOVA_BUILD=\{[^\n]*"task":"perf-02"/m.test(art));
const dir = mkdtempSync(join(tmpdir(), 'perf02-'));
execFileSync(process.execPath, [join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8'); rmSync(dir, { recursive: true });
ck('app HTML equals index.html (the shell)', app === ix);
ck('index.html is under 150 KB', Buffer.byteLength(ix) < 150 * 1024, String(Buffer.byteLength(ix)));
ck('split files are in sync with app/', splitCheck(ROOT).length === 0, splitCheck(ROOT).join('; '));
const tags = splitTags(ix);
const table = (c, name) => JSON.parse(new RegExp('const ' + name + '=(\\{.*?\\});\\n', 's').exec(c)[1]);
const A = table(art, 'NOVA_APP_ASSETS'), P = table(art, 'NOVA_PURCHASING_ASSETS'), S = table(art, 'NOVA_STATIC_ASSETS');
const PB = table(readFileSync(BASE, 'utf8'), 'NOVA_PURCHASING_ASSETS'), SB = table(readFileSync(BASE, 'utf8'), 'NOVA_STATIC_ASSETS');
ck('NOVA_APP_ASSETS has exactly the split files of index.html', Object.keys(A).length === tags.length && tags.every((t) => A['/' + t.file] && A['/' + t.file].body === readFileSync(join(ROOT, t.file), 'utf8')));
ck('no route removed from the base tables', Object.keys(PB).every((k) => k in P) && Object.keys(SB).every((k) => k in S));
ck('/sw.js is the repo sw.js', S['/sw.js'].body === readFileSync(join(ROOT, 'sw.js'), 'utf8'));
// every asset index.html / purchases.html load is served and current
const all = { ...S, ...P, ...A }; const refs = new Set(); const bad = [];
for (const f of ['index.html', 'purchases.html']) for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/(?:src|href)="(\/[A-Za-z0-9_.\-/]+\.(?:js|css))(?:\?[^"]*)?"/g)) refs.add(m[1]);
for (const r of refs) { const f = join(ROOT, r.slice(1)); if (!existsSync(f)) continue; if (!all[r]) bad.push('missing ' + r); else if (all[r].body !== readFileSync(f, 'utf8')) bad.push('stale ' + r); }
ck('every script/style the pages load is served with the current body (' + refs.size + ' referenced)', bad.length === 0, bad.join(', '));
// deploy markers (tools/preview_auto_deploy.py REQUIRED_MARKERS + the sec-01 list) are still in the artifact text
for (const m of ['NOVA_PUR02_EMBED', 'pur-tabs', 'sessionBanner', 'mountInvoiceHistory', 'NOVA_THEME_JS', 'novaThemeCard', 'novaPushCard', 'NOVA_PUSH_CARD_JS', 'waDims', 'novaWaBtn', 'hLoad', 'inbox/history', 'data-wa-inbox-open', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed', 'NOVA_STAFF_PRELOCK']) ck('deploy marker ' + m, art.includes(m));
ck('joined page (shell + split files) still carries the app markers', ['novaWaBtn', 'hLoad', 'hPoll', 'winClosed', 'data-wa-inbox-open'].every((m) => joinHtml(ix, ROOT).includes(m)));
{
  const dir2 = mkdtempSync(join(tmpdir(), 'perf02-run-')), file = join(dir2, 'worker.mjs');
  writeFileSync(file, art);
  const mod = await import(pathToFileURL(file).href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const get = async (path, method = 'GET') => { const r = await mod.default.fetch(new Request('https://x.test' + path, { method }), {}, ctx); return { s: r.status, t: r.headers.get('content-type') || '', c: r.headers.get('cache-control') || '', b: await r.text() }; };
  const home = await get('/'); ck('GET / serves the shell (no-store)', home.s === 200 && /html/.test(home.t) && home.b === ix && /no-store/.test(home.c), home.s + ' ' + home.c);
  const wa = await get('/whatsapp'); ck('GET /whatsapp serves the WhatsApp shell with the same split files', wa.s === 200 && wa.b.includes('NOVA WhatsApp') && tags.every((t) => wa.b.includes('/' + t.file)));
  let okAll = true, why = '';
  for (const t of tags) { const r = await get('/' + t.file); if (!(r.s === 200 && r.b === readFileSync(join(ROOT, t.file), 'utf8') && r.c === 'public, max-age=31536000, immutable' && (t.kind === 'js' ? /javascript/ : /text\/css/).test(r.t))) { okAll = false; why = t.file + ' ' + r.s + ' ' + r.t + ' ' + r.c; break; } }
  ck('GET every /assets/app-* file: 200, right type, immutable one-year cache', okAll, why);
  const head = await get('/' + tags[0].file, 'HEAD'); ck('HEAD on a split file is 200 with no body', head.s === 200 && head.b === '');
  const miss = await get('/assets/app-999-nope.0000000000.js'); ck('unknown /assets/app-* is not served as a split file', !/immutable/.test(miss.c));
  const sg = await get('/staff-gate.js'); ck('GET /staff-gate.js still served (sec-01)', sg.s === 200 && sg.b === readFileSync(join(ROOT, 'staff-gate.js'), 'utf8'));
  const sw = await get('/sw.js'); ck('GET /sw.js precaches every split file and caches them cache-first', sw.s === 200 && tags.every((t) => sw.b.includes('"/' + t.file + '"')) && sw.b.includes("indexOf('/assets/app-')===0"));
  rmSync(dir2, { recursive: true });
}
if (fail) { console.log('FAILED ' + fail); process.exit(1); } console.log('ALL PASS');
