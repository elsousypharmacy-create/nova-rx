// Preview artifact needs-nobanner = ops-needs Worker code + purchases.js without the supplier session/credentials banner (owner 20 Nov).
// Built by tools/build-preview-refresh.mjs. No deploy, no network. Run: node tests/unit/artifact-ops-needs.check.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitTags, check as splitCheck } from '../../tools/split-index.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.needs-nobanner.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.ops-needs.js');
let fail = 0; const ck = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + d)); if (!ok) fail++; };
const art = readFileSync(ART, 'utf8'), base = readFileSync(BASE, 'utf8');

execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
// NOVA_BUILD stamp check (PERF-07 rule)
const stampMatch = /const NOVA_BUILD=(\{[^\n;]*\});/.exec(art);
const stamp = stampMatch ? JSON.parse(stampMatch[1]) : null;
ck('NOVA_BUILD stamp present with built_at, main_sha, task=needs-nobanner', Boolean(stamp && stamp.built_at && stamp.main_sha && stamp.task === 'needs-nobanner'));

// app HTML == index.html
const dir = mkdtempSync(join(tmpdir(), 'nobanner-'));
execFileSync(process.execPath, [join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
ck('app HTML equals index.html', readFileSync(join(dir, 'app.html'), 'utf8') === readFileSync(join(ROOT, 'index.html'), 'utf8')); rmSync(dir, { recursive: true });
// Worker code identical to the base outside the app HTML literal, content tables, and NOVA_BUILD stamp
const strip = (c) => c.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>') && !/^const NOVA_(PURCHASING|STATIC|APP)_ASSETS=/.test(l) && !/^const NOVA_BUILD\s*=/.test(l)).join('\n');
ck('Worker code outside the app HTML and asset tables is identical to base', strip(art) === strip(base));

// tables
const table = (c, name) => JSON.parse(new RegExp('const ' + name + '=(\\{.*?\\});\\n', 's').exec(c)[1]);
const A = table(art, 'NOVA_APP_ASSETS'), P = table(art, 'NOVA_PURCHASING_ASSETS'), S = table(art, 'NOVA_STATIC_ASSETS');
const PB = table(base, 'NOVA_PURCHASING_ASSETS'), SB = table(base, 'NOVA_STATIC_ASSETS');
const ix = readFileSync(join(ROOT, 'index.html'), 'utf8');
const tags = splitTags(ix);
ck('split files are in sync with app/', splitCheck(ROOT).length === 0, splitCheck(ROOT).join('; '));
ck('NOVA_APP_ASSETS has all split files of index.html', Object.keys(A).length === tags.length && tags.every((t) => A['/' + t.file] && A['/' + t.file].body === readFileSync(join(ROOT, t.file), 'utf8')));
ck('no route removed or renamed', Object.keys(PB).every((k) => k in P) && Object.keys(SB).every((k) => k in S));
ck('content types unchanged for existing routes', Object.keys(PB).every((k) => P[k].type === PB[k].type) && Object.keys(SB).every((k) => S[k].type === SB[k].type));
ck('/receipt-operations.js is served as JavaScript', /javascript/.test(P['/receipt-operations.js'].type));
ck('/purchases-history.js is served as JavaScript', Boolean(P['/purchases-history.js']) && /javascript/.test(P['/purchases-history.js'].type));
ck('/purchases-history.css is served as CSS', Boolean(P['/purchases-history.css']) && /css/.test(P['/purchases-history.css'].type));

// every asset the pages load is served and current
const all = { ...S, ...P, ...A };
const refs = new Set();
for (const f of ['index.html', 'purchases.html']) for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/(?:src|href)="(\/[A-Za-z0-9_.\-/]+\.(?:js|css))(?:\?[^"]*)?"/g)) refs.add(m[1]);
const bad = [];
for (const r of refs) { const f = join(ROOT, r.slice(1)); if (!existsSync(f)) continue; if (!all[r]) bad.push('missing ' + r); else if (all[r].body !== readFileSync(f, 'utf8')) bad.push('stale ' + r); }
ck('every script/style the pages load is served with the current file body (' + refs.size + ' referenced)', bad.length === 0, bad.join(', '));
ck('/purchases and /purchases.html serve purchases.html', P['/purchases'].body === readFileSync(join(ROOT, 'purchases.html'), 'utf8') && P['/purchases.html'].body === P['/purchases'].body);
ck('/sw.js is the repo sw.js', S['/sw.js'].body === readFileSync(join(ROOT, 'sw.js'), 'utf8'));

// markers the auto-deploy requires
for (const m of ['NOVA_PUR02_EMBED', 'pur-tabs', 'sessionBanner', 'mountInvoiceHistory', 'NOVA_THEME_JS', 'novaThemeCard', 'novaPushCard', 'NOVA_PUSH_CARD_JS', 'waDims', 'novaWaBtn', 'hLoad', 'inbox/history', 'data-wa-inbox-open', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed']) ck('deploy marker ' + m, art.includes(m));

// OPS-NEEDS markers
{
  const ph = P['/purchases.html'].body;
  const pc = P['/purchases.css'].body;
  const pj = P['/purchases.js'].body;
  ck('OPS-NEEDS: index.html has direct النواقص tab (#novaPurchasesNav) and keeps #novaOpsNav', ix.includes('id="novaPurchasesNav" class="nova-tab" href="/purchases">النواقص</a>') && ix.includes('id="novaOpsNav"'));
  ck('OPS-NEEDS: purchases.html has direct النواقص tab, right rail, sticky search, stage pill, undo toast, and NO #dashboardPin', ph.includes('id="novaPurchasesNav"') && ph.includes('id="needsRail"') && ph.includes('id="needsSearchInput"') && ph.includes('id="needsStagePill"') && ph.includes('id="needsUndoToast"') && !ph.includes('id="dashboardPin"'));
  ck('OPS-NEEDS: purchases.js keeps PERF-05 fast-fail, sessionStorage PIN, autocomplete, undo, local-only draft', pj.includes('!dashboardPin && !PINLESS') && pj.includes('pinless-timeout') && pj.includes('PINLESS_TIMEOUT_MS') && pj.includes('SESSION_PIN_KEY') && pj.includes('prepareLocalOrder') && pj.includes('removeItemWithUndo'));
  ck('OPS-NEEDS: purchases.css has wide (>=768px) and phone (<768px) layouts', pc.includes('@media (min-width:768px)') && pc.includes('@media (max-width:767.98px)'));
  ck('artifact has no hardcoded PIN-like secret', !/NOVA_STOCK_SOURCE_PIN\s*[:=]\s*['"][^'"]+['"]/.test(art));
}

// run the Worker's own fetch handler locally
{
  const dir2 = mkdtempSync(join(tmpdir(), 'opsneeds-run-')), file = join(dir2, 'worker.mjs');
  writeFileSync(file, art);
  const mod = await import(pathToFileURL(file).href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const get = async (path) => { const r = await mod.default.fetch(new Request('https://x.test' + path), {}, ctx); return { s: r.status, t: r.headers.get('content-type') || '', b: await r.text() }; };
  const home = await get('/'); ck('GET / serves the app shell', home.s === 200 && /html/.test(home.t) && home.b === ix, home.s + ' ' + home.t);
  const splitAsset = await get('/' + tags[0].file); ck('GET split asset serves immutable file', splitAsset.s === 200 && splitAsset.b === readFileSync(join(ROOT, tags[0].file), 'utf8'));
  const pu = await get('/purchases'); ck('GET /purchases is 200 HTML with needsRail', pu.s === 200 && /html/.test(pu.t) && pu.b.includes('needsRail'), pu.s + ' ' + pu.t);
  const pj = await get('/purchases.js'); ck('GET /purchases.js is current file', pj.s === 200 && pj.b === readFileSync(join(ROOT, 'purchases.js'), 'utf8'));
  const pc = await get('/purchases.css'); ck('GET /purchases.css is current file', pc.s === 200 && pc.b === readFileSync(join(ROOT, 'purchases.css'), 'utf8'));
  rmSync(dir2, { recursive: true });
}
{ const pj = P['/purchases.js'].body; const m = /function showSessionBanner\(text\) \{([\s\S]*?)\n\}/.exec(pj);
  ck('owner 20 Nov: showSessionBanner never reveals the banner', Boolean(m) && !/hidden\s*=\s*false/.test(m[1]) && /hidden\s*=\s*true/.test(m[1])); }
if (fail) { console.log('FAILED ' + fail); process.exit(1); } console.log('ALL PASS');
