#!/usr/bin/env node
// Refresh a nova-rx-preview Worker artifact from the current repo files, changing ONLY content, never routes or Worker code:
//  1. app HTML  <- index.html (build-worker-artifact.mjs), /sw.js <- sw.js
//  2. every route already in NOVA_PURCHASING_ASSETS / NOVA_STATIC_ASSETS gets the current body of its repo file
//  3. files the pages load that the base has no route for are ADDED to NOVA_PURCHASING_ASSETS (listed in EXTRA_ROUTES below)
//  4. PERF-02: the split app files (assets/app-*.<hash>.js|css, see tools/split-index.mjs) become the NOVA_APP_ASSETS table
//     (replaced as a whole on every build, so stale hashes disappear), served by one small route at the top of the fetch
//     handler with Cache-Control: public, max-age=31536000, immutable (names are content-hashed). Refuses to build when
//     index.html / assets / sw.js are out of sync with app/.
// Usage: node tools/build-preview-refresh.mjs BASE_WORKER.js OUT_WORKER.js     (local only: no network, no deploy)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stampBuild } from './build-worker-artifact.mjs';
import { splitTags, check as splitCheck } from './split-index.mjs';

const EXTRA_ROUTES = {
  '/receipt-operations.js': ['receipt-operations.js', 'application/javascript; charset=utf-8'],
  '/purchases-history.js': ['purchases-history.js', 'application/javascript; charset=utf-8'],
  '/purchases-history.css': ['purchases-history.css', 'text/css; charset=utf-8'],
  '/staff-gate.js': ['staff-gate.js', 'application/javascript; charset=utf-8'] // SEC-01 / S1-07 staff login gate
};
const TABLES = ['NOVA_PURCHASING_ASSETS', 'NOVA_STATIC_ASSETS'];
const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error('usage: build-preview-refresh.mjs BASE_WORKER.js OUT_WORKER.js'); process.exit(2); }

const tmp = out + '.tmp';
execFileSync(process.execPath, ['tools/build-worker-artifact.mjs', base, 'index.html', tmp, '--sw', 'sw.js'], { stdio: 'pipe' });
let code = fs.readFileSync(tmp, 'utf8'); fs.unlinkSync(tmp);

export const APP_BEGIN = '/* NOVA_APP_ASSETS_BEGIN */', APP_END = '/* NOVA_APP_ASSETS_END */', APP_ROUTE = '/*NOVA_APP_ASSETS_ROUTE*/';
export const APP_CACHE = 'public, max-age=31536000, immutable';
function refreshAppAssets(src) {
  const errs = splitCheck();
  if (errs.length) throw new Error('split app files out of sync (run node tools/split-index.mjs): ' + errs.join('; '));
  const table = {};
  for (const t of splitTags(fs.readFileSync('index.html', 'utf8'))) table['/' + t.file] = { body: fs.readFileSync(t.file, 'utf8'), type: t.kind === 'js' ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8' };
  const block = APP_BEGIN + '\nconst NOVA_APP_ASSETS=' + JSON.stringify(table) + ';\n' + APP_END + '\n';
  let c = src;
  if (c.includes(APP_BEGIN)) { const a = c.indexOf(APP_BEGIN), b = c.indexOf(APP_END) + APP_END.length + 1; c = c.slice(0, a) + block + c.slice(b); }
  else { const at = c.indexOf('/* NOVA_PURCHASING_ASSETS_BEGIN */'); if (at < 0) throw new Error('NOVA_PURCHASING_ASSETS_BEGIN not found'); c = c.slice(0, at) + block + c.slice(at); }
  if (!c.includes(APP_ROUTE)) {
    const anchor = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
    if (c.split(anchor).length !== 2) throw new Error('fetch listener anchor not unique');
    const route = APP_ROUTE + "if(NOVA_APP_ASSETS[url.pathname]&&(event.request.method==='GET'||event.request.method==='HEAD')){const a=NOVA_APP_ASSETS[url.pathname];event.respondWith(new Response(event.request.method==='HEAD'?null:a.body,{headers:{'Content-Type':a.type,'Cache-Control':'" + APP_CACHE + "','X-Content-Type-Options':'nosniff'}}));return;}";
    c = c.replace(anchor, () => anchor + route);
  }
  return { code: c, count: Object.keys(table).length };
}

const fileFor = (route) => route.replace(/^\//, '');
let changed = 0, added = 0;
for (const name of TABLES) {
  const re = new RegExp('const ' + name + '=(\\{.*?\\});\\n', 's');
  const m = re.exec(code); if (!m) throw new Error(name + ' not found');
  const table = JSON.parse(m[1]);
  for (const [route, entry] of Object.entries(table)) {
    if (route === '/purchases' || route === '/purchases.html') { const b = fs.readFileSync('purchases.html', 'utf8'); if (entry.body !== b) { entry.body = b; changed++; } continue; }
    if (route === '/sw.js') continue; // replaced by build-worker-artifact
    const f = fileFor(route);
    if (!fs.existsSync(f)) continue; // not a repo file (kept as is)
    const b = fs.readFileSync(f, 'utf8');
    if (entry.encoding) continue;
    if (entry.body !== b) { entry.body = b; changed++; }
  }
  if (name === 'NOVA_PURCHASING_ASSETS') for (const [route, [f, type]] of Object.entries(EXTRA_ROUTES)) {
    if (!table[route]) { table[route] = { body: fs.readFileSync(f, 'utf8'), type }; added++; }
  }
  code = code.replace(re, () => 'const ' + name + '=' + JSON.stringify(table) + ';\n');
}
const app = refreshAppAssets(code); code = app.code;
code = stampBuild(code, { outPath: out });
fs.writeFileSync(out, code);
console.log('wrote', out, Buffer.byteLength(code), 'bytes; asset bodies refreshed:', changed, 'added routes:', added, 'app files:', app.count, 'sha256', crypto.createHash('sha256').update(code).digest('hex'));
