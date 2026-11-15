// SALE-02: worker/live/nova-rx-preview.sale-02.js = ux-422 Worker + NOVA_STATIC_ASSETS route + current index.html.
// Served-asset check on the local Worker bundle (no network, fake env): files that returned 404 are now 200 with
// the exact repo bytes; conversations HTML/markers are not overwritten; worker code otherwise unchanged. No deploy.
// Run: node tests/unit/sale-02-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATIC_ASSETS, buildTable, inject } from '../../tools/build-static-assets-artifact.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ART = path.join(ROOT, 'worker/live/nova-rx-preview.sale-02.js');
const BASE = path.join(ROOT, 'worker/live/nova-rx-preview.ux-422.js');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

execFileSync('node', ['--check', ART]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sale02-'));
const extract = (f, o) => { execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', f, o]); return fs.readFileSync(o, 'utf8'); };
const html = extract(ART, path.join(tmp, 'a.html'));
const baseHtml = extract(BASE, path.join(tmp, 'b.html'));
const code = fs.readFileSync(ART, 'utf8');
const copy = path.join(tmp, 'w.mjs'); fs.copyFileSync(ART, copy);
const worker = (await import(pathToFileURL(copy))).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = (p, method = 'GET') => worker.fetch(new Request('https://preview.test' + p, { method }), {}, ctx);

const MUST = ['/auth-local.js', '/auth-permissions.js', '/auth-ui.js', '/credit-ledger.js', '/bi-dictionary.js', '/supplier-lookup.js',
  '/supplier-lookup.css', '/worker/procurement/ui-model.js', '/icon.svg', '/nova-icons.js', '/nova-icons.css', '/ux-tokens.css', '/sw.js'];

await t('all brief-listed assets are in the table', () => { for (const p of MUST) assert.ok(STATIC_ASSETS.some(([u]) => u === p), p); });
await t('base ux-422 returned 404 for them (regression guard is meaningful)', async () => {
  const b = path.join(tmp, 'base.mjs'); fs.copyFileSync(BASE, b);
  const w = (await import(pathToFileURL(b))).default;
  for (const p of MUST) assert.equal((await w.fetch(new Request('https://preview.test' + p), {}, ctx)).status, 404, p);
});
for (const [url, file] of STATIC_ASSETS) {
  await t('GET ' + url + ' = 200, repo bytes, right type', async () => {
    const r = await get(url + (url === '/sw.js' ? '?v=3' : ''));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const ext = file.slice(file.lastIndexOf('.'));
    assert.match(r.headers.get('content-type'), { '.js': /^application\/javascript/, '.css': /^text\/css/, '.svg': /^image\/svg\+xml/, '.webmanifest': /^application\/manifest\+json/ }[ext]);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
}
await t('HEAD /sw.js?v=3 ok (app registers SW only when HEAD is ok), scope header set', async () => {
  const r = await get('/sw.js?v=3', 'HEAD');
  assert.equal(r.status, 200); assert.equal(r.headers.get('service-worker-allowed'), '/'); assert.equal(r.headers.get('cache-control'), 'no-cache');
});
await t('non-GET never hits the static route', async () => {
  const r = await get('/auth-ui.js', 'POST');
  assert.notEqual(await r.text(), fs.readFileSync(path.join(ROOT, 'auth-ui.js'), 'utf8'));
});
await t('every same-origin script/style/icon the app HTML references is served (no 404)', async () => {
  const refs = new Set([...html.matchAll(/(?:src|href)="(\/?[A-Za-z0-9_\-\/.]+\.(?:js|css|svg|webmanifest))(?:\?[^"]*)?"/g)].map((m) => '/' + m[1].replace(/^\//, '')));
  refs.add('/worker/procurement/ui-model.js');
  assert.ok(refs.size >= 12, 'found refs ' + [...refs]);
  for (const p of refs) assert.equal((await get(p)).status, 200, p);
});
await t('app, purchasing, stock and conversations routes unchanged', async () => {
  for (const p of ['/', '/purchases', '/emergency/stock.json', '/supplier-provider.js', '/whatsapp-inbox.html', '/worker/procurement/normalize.js']) {
    const b = path.join(tmp, 'base2.mjs'); if (!fs.existsSync(b)) fs.copyFileSync(BASE, b);
    const w = (await import(pathToFileURL(b))).default;
    const [x, y] = [await get(p), await w.fetch(new Request('https://preview.test' + p), {}, ctx)];
    assert.equal(x.status, 200, p); assert.equal(y.status, 200, p);
    if (p !== '/') assert.equal(await x.text(), await y.text(), p);
  }
});
await t('conversations markers present and not fewer than ux-422; no conversations file in the table', () => {
  for (const m of ['hLoad', 'inbox/history', 'waHistPin', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed', 'data-wa-window', 'hSend', 'X-Nova-Pin', 'wa-root', 'wa-lockform', 'wa-date', 'novaWaBtn', 'novaInboxView', 'UX422_APP_SKIN']) {
    assert.ok(html.includes(m), m); assert.ok(html.split(m).length >= baseHtml.split(m).length, 'count ' + m);
  }
  assert.ok(!STATIC_ASSETS.some(([u, f]) => /whatsapp|inbox|conversation/i.test(u + f)));
});
await t('app HTML equals index.html; VAT default 14; demo customers gated to dev', () => {
  assert.equal(html, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  assert.ok(html.includes("var K='nova-rx-vat-rate',D=14;"));
  assert.ok(html.includes('if (!demo) DEMO_CUSTOMERS.length = 0;'));
  assert.ok(!html.includes('TASK-001'));
});
await t('worker = ux-422 + static table + route only (rebuild is byte-identical)', () => {
  const rebuilt = path.join(tmp, 'r1.js'), html2 = path.join(tmp, 'idx.html');
  fs.writeFileSync(rebuilt, inject(fs.readFileSync(BASE, 'utf8'), buildTable(ROOT)));
  fs.writeFileSync(html2, html);
  const out = path.join(tmp, 'r2.js');
  execFileSync('node', [path.join(ROOT, 'tools/build-worker-artifact.mjs'), rebuilt, html2, out]);
  assert.equal(fs.readFileSync(out, 'utf8'), code);
  assert.throws(() => inject(code, {}), /already present/);
});
fs.rmSync(tmp, { recursive: true });
console.log('sale-02 artifact check OK (' + n + ' checks)');
