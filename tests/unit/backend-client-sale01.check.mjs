import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
// SALE-01: production backend hookup behind a per-device flag, DEFAULT OFF. No network: every fetch is a mock.
// Run: node tests/unit/backend-client-sale01.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createBackendClient, resolveBaseUrl, PRODUCTION_URL, KEYS } = require('../../backend-client.js');

const PROD = 'https://nova-rx-api.elsousypharmacy.workers.dev';
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkFetch = () => { const f = async (url, o) => { f.calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ items: [], conversations: [] }) }; }; f.calls = []; return f; };

// backend-client.js: resolution
assert.equal(PRODUCTION_URL, PROD);
assert.equal(KEYS.token, 'novaBackend.token');
assert.equal(resolveBaseUrl(mem()), '', 'default OFF -> no base URL');
assert.equal(resolveBaseUrl(mem({ 'novaBackend.url': PROD })), '', 'url alone never enables');
assert.equal(resolveBaseUrl(mem({ 'novaBackend.enabled': '1' })), '', 'only the exact string "true" enables');
assert.equal(resolveBaseUrl(mem({ 'novaBackend.enabled': 'true' })), PROD, 'ON -> production');
assert.equal(resolveBaseUrl(mem({ 'novaBackend.enabled': 'true', 'novaBackend.url': 'https://b.test//' })), 'https://b.test', 'https override');
assert.equal(resolveBaseUrl(mem({ 'novaBackend.enabled': 'true', 'novaBackend.url': 'http://evil.test' })), PROD, 'non-https override ignored');
assert.equal(resolveBaseUrl({ getItem() { throw new Error('blocked'); } }), '', 'storage error -> OFF');

// backend-client.js: OFF = zero calls; ON = production with Bearer from getToken
{
  const st = mem(), f = mkFetch();
  const c = createBackendClient({ storage: st, fetch: f, getToken: () => 'tok-x' });
  assert.equal((await c.syncAll()).skipped, true);
  assert.equal((await c.pull()).skipped, true);
  assert.equal(f.calls.length, 0, 'flag off: no calls at all');
  c.setEnabled(true);
  await c.pull();
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.startsWith(PROD + '/api/v1/sync/pull'), f.calls[0].url);
  assert.equal(f.calls[0].o.method, 'GET');
  assert.equal(f.calls[0].o.headers.Authorization, 'Bearer tok-x');
}

// index.html inline helper (window.novaBackendFlag)
const html = readAppHtml('index.html', 'utf8');
const helperSrc = /<script id="sale01-backend-flag">([\s\S]*?)<\/script>/.exec(html)[1];
function runHelper(local = {}, session = {}) {
  const ls = mem(local), ss = mem(session);
  const ctx = { localStorage: ls, sessionStorage: ss, String, window: {} };
  vm.runInNewContext(helperSrc, ctx);
  return { f: ctx.window.novaBackendFlag, ls, ss };
}
{
  const { f, ls, ss } = runHelper();
  assert.equal(f.PRODUCTION_URL, PRODUCTION_URL, 'inline constant matches backend-client.js');
  assert.deepEqual({ ...f.config() }, { enabled: false, baseUrl: '', hasToken: false, production: false }, 'default OFF');
  f.setToken('  key-123  ');
  assert.equal(ss.getItem('novaBackend.token'), 'key-123', 'token in sessionStorage');
  assert.equal([...ls.m.values()].some((v) => String(v).includes('key-123')), false, 'token never in localStorage');
  f.setEnabled(true);
  const c = f.config();
  assert.equal(c.enabled, true); assert.equal(c.baseUrl, PROD); assert.equal(c.production, true); assert.equal(c.hasToken, true);
  f.setEnabled(false);
  assert.equal(ls.getItem('novaBackend.enabled'), null, 'off removes the flag');
  assert.equal(ss.getItem('novaBackend.token'), null, 'off clears the session token');
  assert.equal(f.config().enabled, false);
}
assert.equal(runHelper({ 'novaBackend.enabled': 'true', 'novaBackend.url': 'http://x.test' }).f.config().baseUrl, PROD);

// No global enable anywhere in shipped HTML; no token/PIN logged by the helper
for (const file of ['index.html', 'emergency-sales.html', 'purchases.html', 'sticker-studio.html', 'supplier-compare.html']) {
  const src = readFileSync(file, 'utf8');
  assert.doesNotMatch(src, /setItem\(\s*['"]novaBackend\.enabled['"]\s*,\s*['"]true['"]/, `${file}: no hard-coded enable`);
}
assert.doesNotMatch(helperSrc, /console\./, 'helper never logs');
assert.doesNotMatch(helperSrc, /localStorage[^;]*setItem\([^)]*KT/, 'token key never written to localStorage');

// Existing inline callers: flag ON with no url now default to production; flag OFF unchanged (zero calls)
const badgeSrc = /<script id="ux81-wa-badge"(?: defer="")?>([\s\S]*?)<\/script>/.exec(html)[1];
async function runBadge(store, session) {
  const f = mkFetch();
  const badge = { hidden: true, textContent: '' };
  const btn = { addEventListener() {}, setAttribute() {} };
  const doc = { readyState: 'complete', hidden: false, getElementById: (id) => (id === 'novaWaBadge' ? badge : id === 'novaWaBtn' ? btn : null) };
  const ctx = { document: doc, localStorage: { getItem: (k) => store[k] ?? null }, sessionStorage: { getItem: (k) => session[k] ?? null }, fetch: f, setInterval: () => 1, location: {}, JSON, Array, Number, String };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(badgeSrc, ctx);
  await new Promise((r) => setTimeout(r, 20));
  return f.calls;
}
assert.equal((await runBadge({}, { 'novaBackend.token': 't' })).length, 0, 'flag off: badge makes no call');
assert.equal((await runBadge({ 'novaBackend.url': PROD }, { 'novaBackend.token': 't' })).length, 0, 'url without flag: no call');
{
  const calls = await runBadge({ 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 't' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PROD + '/api/v1/inbox/conversations', 'flag on: production default');
}
assert.match(html, /baseUrl:function\(\)\{return localStorage\.getItem\('novaBackend\.url'\)\|\|'https:\/\/nova-rx-api\.elsousypharmacy\.workers\.dev'\}/, 'inbox remote defaults to production');
assert.match(html, /function hUrl\(\)\{var u='';try\{u=localStorage\.getItem\('novaBackend\.url'\)\|\|'';if\(!u&&localStorage\.getItem\('novaBackend\.enabled'\)==='true'\)u='https:\/\/nova-rx-api\.elsousypharmacy\.workers\.dev'\}/, 'history: production only when the flag is on');
assert.match(html, /id="novaBackendCard"/);
assert.match(html, /window\.novaBackendFlag\.mount\(document\.getElementById\('novaBackendCard'\)\)/);
console.log('backend-client-sale01.check OK');
