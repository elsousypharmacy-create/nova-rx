// Preview artifact pur-01b = pur-02 Worker code + index.html with the receive-invoice confirm/expiry-hint fix. purchases.* assets unchanged. No deploy, no network. Run: node tests/unit/artifact-pur01b.check.mjs
// No deploy, no network. Run: node tests/unit/artifact-pur01b.check.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.pur-01b.js'), BASE = join(ROOT, 'worker/live/nova-rx-preview.pur-02.js');
let fail = 0; const ck = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + d)); if (!ok) fail++; };
const art = readFileSync(ART, 'utf8'), base = readFileSync(BASE, 'utf8');

execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
// app HTML == index.html
const dir = mkdtempSync(join(tmpdir(), 's303z-'));
execFileSync(process.execPath, [join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const NEWER = existsSync(join(ROOT, 'worker/live/nova-rx-preview.pur-04.js'));
if (!NEWER) ck('app HTML equals index.html', readFileSync(join(dir, 'app.html'), 'utf8') === readFileSync(join(ROOT, 'index.html'), 'utf8'));
ck('app HTML is a complete page', readFileSync(join(dir, 'app.html'), 'utf8').includes('novaWaBtn')); rmSync(dir, { recursive: true });
// Worker code identical to the base outside the app HTML literal and the content tables
const strip = (c) => c.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>') && !/^const NOVA_(PURCHASING|STATIC)_ASSETS=/.test(l) && !/^const NOVA_BUILD\s*=/.test(l)).join('\n');
ck('Worker code outside the app HTML and the two asset tables is identical to pur-02', strip(art) === strip(base));
// tables
const table = (c, name) => JSON.parse(new RegExp('const ' + name + '=(\\{.*?\\});\\n', 's').exec(c)[1]);
const P = table(art, 'NOVA_PURCHASING_ASSETS'), S = table(art, 'NOVA_STATIC_ASSETS'), PB = table(base, 'NOVA_PURCHASING_ASSETS'), SB = table(base, 'NOVA_STATIC_ASSETS');
ck('no route removed or renamed', Object.keys(PB).every((k) => k in P) && Object.keys(SB).every((k) => k in S));
ck('no route added or removed', Object.keys(P).length === Object.keys(PB).length && Object.keys(S).length === Object.keys(SB).length);
ck('content types unchanged for existing routes', Object.keys(PB).every((k) => P[k].type === PB[k].type) && Object.keys(SB).every((k) => S[k].type === SB[k].type));
ck('/receipt-operations.js is served as JavaScript', /javascript/.test(P['/receipt-operations.js'].type));
// every asset the pages load is served and current
const all = { ...S, ...P };
const refs = new Set();
for (const f of ['index.html', 'purchases.html']) for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/(?:src|href)="(\/[A-Za-z0-9_.\-/]+\.(?:js|css))(?:\?[^"]*)?"/g)) refs.add(m[1]);
const bad = [];
for (const r of refs) { const f = join(ROOT, r.slice(1)); if (!existsSync(f)) continue; if (!all[r]) bad.push('missing ' + r); else if (all[r].body !== readFileSync(f, 'utf8')) bad.push('stale ' + r); }
ck('every script/style the pages load is served (' + refs.size + ' referenced)' + (NEWER ? ' [bodies: checked by the newest artifact]' : ''), NEWER ? bad.every((x) => x.startsWith('stale') || x.includes('/purchases-history.')) : bad.length === 0, bad.join(', '));
ck('/purchases and /purchases.html serve purchases.html', (NEWER || P['/purchases'].body === readFileSync(join(ROOT, 'purchases.html'), 'utf8')) && P['/purchases.html'].body === P['/purchases'].body);
if (!NEWER) ck('/sw.js is the repo sw.js', S['/sw.js'].body === readFileSync(join(ROOT, 'sw.js'), 'utf8'));
// markers the auto-deploy requires
for (const m of ['NOVA_PUR02_EMBED', 'pur-tabs', 'sessionBanner', 'NOVA_THEME_JS', 'novaThemeCard', 'novaPushCard', 'NOVA_PUSH_CARD_JS', 'waDims', 'novaWaBtn', 'hLoad', 'inbox/history', 'data-wa-inbox-open', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed']) ck('deploy marker ' + m, art.includes(m));
// run the Worker's own fetch handler locally (module Worker: export default { fetch })
{
  const dir2 = mkdtempSync(join(tmpdir(), 's303z-run-')), file = join(dir2, 'worker.mjs');
  writeFileSync(file, art);
  const mod = await import(pathToFileURL(file).href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const get = async (path) => { const r = await mod.default.fetch(new Request('https://x.test' + path), {}, ctx); return { s: r.status, t: r.headers.get('content-type') || '', b: await r.text() }; };
  const home = await get('/'); ck('GET / serves the app', home.s === 200 && /html/.test(home.t) && home.b.includes('novaWaBtn'), home.s + ' ' + home.t);
  const ro = await get('/receipt-operations.js'); ck('GET /receipt-operations.js is 200 JavaScript with the module', ro.s === 200 && /javascript/.test(ro.t) && ro.b === readFileSync(join(ROOT, 'receipt-operations.js'), 'utf8'), ro.s + ' ' + ro.t);
  const pu = await get('/purchases'); ck('GET /purchases is 200 HTML', pu.s === 200 && /html/.test(pu.t), pu.s + ' ' + pu.t);
  const po = await get('/purchase-orders.js'); ck('GET /purchase-orders.js is the current file', po.s === 200 && po.b === readFileSync(join(ROOT, 'purchase-orders.js'), 'utf8'));
  const emb = await get('/?embed=receiving'); ck('GET /?embed=receiving serves the app with the embed flag script', emb.s === 200 && emb.b.includes('NOVA_PUR02_EMBED'), String(emb.s));
  ck('/purchases serves the tabs hub', pu.b.includes('id="tabReceive"') && pu.b.includes('id="renewSession"'));
  rmSync(dir2, { recursive: true });
}
if (fail) { console.log('FAILED ' + fail); process.exit(1); } console.log('ALL PASS');
