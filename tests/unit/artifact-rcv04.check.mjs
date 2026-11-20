// Preview artifact rcv04 = rcv03 Worker code + current repo files: owner decisions — full encrypted backup (558), controlled
// drugs register (560), phone bottom navigation (562), sensitive-operations log (564), owner dashboard (566). No deploy, no network.
// Built by tools/build-preview-refresh.mjs. No deploy, no network. Run: node tests/unit/artifact-rcv04.check.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitTags, check as splitCheck } from '../../tools/split-index.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.rcv04.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.rcv03.js');
let fail = 0; const ck = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + d)); if (!ok) fail++; };
const art = readFileSync(ART, 'utf8'), base = readFileSync(BASE, 'utf8');

execFileSync(process.execPath, ['--check', ART]); ck('node --check', true);
// NOVA_BUILD stamp check (PERF-07 rule)
const stampMatch = /const NOVA_BUILD=(\{[^\n;]*\});/.exec(art);
const stamp = stampMatch ? JSON.parse(stampMatch[1]) : null;
ck('NOVA_BUILD stamp present with built_at, main_sha, task=rcv04', Boolean(stamp && stamp.built_at && stamp.main_sha && stamp.task === 'rcv04'));

// app HTML == index.html
const dir = mkdtempSync(join(tmpdir(), 'rcv04-'));
execFileSync(process.execPath, [join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
ck('app HTML equals index.html', readFileSync(join(dir, 'app.html'), 'utf8') === readFileSync(join(ROOT, 'index.html'), 'utf8')); rmSync(dir, { recursive: true });
// Worker code identical to the base outside the app HTML literal, content tables, and NOVA_BUILD stamp
const strip = (c) => c.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>') && !/^const NOVA_(PURCHASING|STATIC|APP)_ASSETS=/.test(l) && !/^const NOVA_BUILD\s*=/.test(l)).join('\n');
ck('Worker code outside the app HTML, asset tables and NOVA_BUILD stamp is identical to rcv03', strip(art) === strip(base));

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

// UX-FIX01: the three fixes are in the served files
{ const sl = (S['/supplier-lookup.js'] || P['/supplier-lookup.js'] || {}).body || ''; ck('UX-FIX01: supplier-lookup.js has no «غير متوفر» chip for unknown stock', sl.includes("unknown stock: no green dot") && !sl.includes("<small>' + tr('غير متوفر') + '</small>"));
  const css = Object.entries(A).filter(([k]) => /510-ux206-mobile-cart-row|210-nova-sticker-oneclick-v2/.test(k)).map(([, v]) => v.body).join('\n');
  ck('UX-FIX01: mobile qty control is max-content and the product name lines are clamped one by one', css.includes('width:max-content!important;max-width:none!important') && css.includes('.pc-name:has(>.nova-product-en-name)')); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('AUDIT-01: shift close no longer depends on the out-of-scope plOf', all.includes("periodLabel:(typeof plOf==='function'?plOf(d.per):")); ck('AUDIT-01: startNewSale reuses an unused invoice number', all.includes('if (!activeSaleNumber || window.novaPay.numberTaken(activeSaleNumber) || heldTaken(activeSaleNumber)) activeSaleNumber = nextSaleNumber();')); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('AUDIT-02: F2/F4 dialog present, no window.confirm in clearInvoice', all.includes('function openInvoiceActionDialog') && !/window\.confirm\(novaEn\(\) \? 'Clear all items/.test(all)); ck('AUDIT-02: refill button on the card', all.includes('novaCustCardRefill')); ck('AUDIT-02: cancel approval uses verifyAccount', all.includes('window.__novaCxPayload') && all.includes('verifyAccount')); const al = (S['/auth-local.js'] || P['/auth-local.js'] || {}).body || ''; ck('AUDIT-02: served auth-local.js has verifyAccount', al.includes('verifyAccount: function (name, password)')); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('AUDIT-03: supplier screen + provider in the app assets', all.includes('novaSupplierAccountsSection') && all.includes('window.__novaSupplierProvider')); ck('AUDIT-03: shift close subtracts cash-outs', all.includes('const shiftExpected=Math.round((shiftFloat+drawer+cashDebt-cashOut)*100)/100;')); ck('AUDIT-03: /supplier-accounts.js served as JavaScript and current', Boolean(P['/supplier-accounts.js']) && /javascript/.test(P['/supplier-accounts.js'].type) && P['/supplier-accounts.js'].body === readFileSync(join(ROOT, 'supplier-accounts.js'), 'utf8')); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('RCV-BONUS: bonus field + money on paid qty', all.includes('data-f=\"bonus\"') && all.includes('function lineMoney(l)')); ck('SUP-RET: supplier returns screen in the app assets', all.includes('window.novaSupplierReturns') && all.includes('data-sret-open')); ck('SUP-RET: served supplier-accounts.js has credit notes', P['/supplier-accounts.js'].body.includes('function credit(p)') && P['/supplier-accounts.js'].body === readFileSync(join(ROOT, 'supplier-accounts.js'), 'utf8')); }

{ ck('RCV02: lazy screens are prefetch links (not startup scripts) and served', /<link rel="prefetch" as="script" data-nova-lazy="1" href="\/assets\/app-552-supplier-returns\.[0-9a-f]+\.js">/.test(ix) && !/<script src="\/supplier-accounts\.js">/.test(ix) && tags.some(t => t.lazy && A['/' + t.file])); ck('RCV02: lazy loader present', Object.values(A).some(v => v.body.includes('window.novaLazy = { load: loadLazy }'))); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('ITEM-CARD: item card + adjustment lazy and served', all.includes('window.novaItemCard = {') && /data-nova-lazy="1" href="\/assets\/app-554-item-card\.[0-9a-f]+\.js"/.test(ix)); ck('CREDIT-LIMIT: credit limit lazy and served', all.includes('window.novaCreditLimit = {') && /data-nova-lazy="1" href="\/assets\/app-556-credit-limit\.[0-9a-f]+\.js"/.test(ix)); }

{ const all = Object.values(A).map(v => v.body).join('\n'); ck('OWNER-DECISIONS: backup, controlled register, sensitive log, owner dashboard served lazily', ['558-full-backup','560-controlled-drugs','564-sensitive-log','566-owner-dashboard'].every(n => new RegExp('data-nova-lazy="1" href="/assets/app-' + n + '\\.[0-9a-f]+\\.js"').test(ix)) && all.includes('window.novaFullBackup') && all.includes('window.novaControlled')); ck('NAV-01: bottom nav is a startup script', /<script src="\/assets\/app-562-mobile-bottom-nav\.[0-9a-f]+\.js"><\/script>/.test(ix) && all.includes('novaBottomNav')); }

// run the Worker's own fetch handler locally
{
  const dir2 = mkdtempSync(join(tmpdir(), 'rcv04-run-')), file = join(dir2, 'worker.mjs');
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
// NEEDS-PINLESS: stock route with a stubbed upstream (no network)
{
  const dir3 = mkdtempSync(join(tmpdir(), 'rcv04-stock-')), file = join(dir3, 'worker.mjs');
  writeFileSync(file, art);
  const mod = await import(pathToFileURL(file).href + '?stock');
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (u, init) => { if (String(u).startsWith('https://script.google.com/')) { const b = JSON.parse(init.body); sent.push(b); return new Response(JSON.stringify(b.pin === 'srv-test-pin' || b.pin === 'typed-pin' ? { ok: true, schemaVersion: 1, items: [] } : { pinError: true }), { headers: { 'content-type': 'application/json' } }); } return realFetch(u, init); };
  const post = async (host, env, pin) => { const r = await mod.default.fetch(new Request('https://' + host + '/api/purchases/stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dashboardPin: pin }) }), { NOVA_SECRETS_KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } }, NOVA_SECRET_ENCRYPTION_KEY: 'k'.repeat(44), ...env }, ctx); return { s: r.status, b: await r.json() }; };
  try {
    let n = sent.length, r = await post('nova-rx-preview.elsousypharmacy.workers.dev', { NOVA_STOCK_SOURCE_PIN: 'srv-test-pin' }, '');
    ck('preview host + server secret + no typed PIN -> 200, upstream gets the server PIN', r.s === 200 && r.b.ok === true && sent.length === n + 1 && sent[n].pin === 'srv-test-pin', JSON.stringify(r));
    n = sent.length; r = await post('nova-rx.elsousypharmacy.workers.dev', { NOVA_STOCK_SOURCE_PIN: 'srv-test-pin' }, '');
    ck('production host never uses the server secret -> 403 and no upstream call', r.s === 403 && r.b.error === 'source-auth-required' && sent.length === n, JSON.stringify(r));
    n = sent.length; r = await post('x.test', { NOVA_ENV: 'staging', NOVA_STOCK_SOURCE_PIN: 'srv-test-pin' }, '');
    ck('NOVA_ENV=staging uses the server secret', r.s === 200 && sent[n] && sent[n].pin === 'srv-test-pin', JSON.stringify(r));
    n = sent.length; r = await post('nova-rx-preview.elsousypharmacy.workers.dev', {}, '');
    ck('preview host without the secret -> 403, no upstream call', r.s === 403 && sent.length === n, JSON.stringify(r));
    n = sent.length; r = await post('nova-rx.elsousypharmacy.workers.dev', {}, 'typed-pin');
    ck('typed PIN still forwarded as before', r.s === 200 && sent[n] && sent[n].pin === 'typed-pin', JSON.stringify(r));
    r = await post('nova-rx-preview.elsousypharmacy.workers.dev', { NOVA_STOCK_SOURCE_PIN: 'srv-test-pin' }, '');
    ck('server PIN never echoed in the response', !JSON.stringify(r.b).includes('srv-test-pin'));
  } finally { globalThis.fetch = realFetch; rmSync(dir3, { recursive: true }); }
}
{ const pj = P['/purchases.js'].body; ck('NEEDS-PINLESS: client waits for the server PIN read (PINLESS_TIMEOUT_MS = 45000)', pj.includes('const PINLESS_TIMEOUT_MS = 45000;')); }
{ const pj = P['/purchases.js'].body; const m = /function showSessionBanner\(text\) \{([\s\S]*?)\n\}/.exec(pj);
  ck('owner 20 Nov: showSessionBanner never reveals the banner', Boolean(m) && !/hidden\s*=\s*false/.test(m[1]) && /hidden\s*=\s*true/.test(m[1])); }
if (fail) { console.log('FAILED ' + fail); process.exit(1); } console.log('ALL PASS');
