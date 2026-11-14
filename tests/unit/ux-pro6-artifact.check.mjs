// Checks worker/live/nova-rx-preview.ux-pro6.js (UX202): parses, keeps ux-pro5 markers, adds UX200 WhatsApp-Web chat view + UX201 supplier status asset,
// worker code outside the app HTML and purchasing assets table is byte-identical to ux-pro5; clicking #novaWaBtn lands on the conversations view.
// Offline: no deploy, no Cloudflare calls. Run: node tests/unit/ux-pro6-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ART = 'worker/live/nova-rx-preview.ux-pro6.js', PREV = 'worker/live/nova-rx-preview.ux-pro5.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux202-'));
const htmlPath = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, htmlPath], { stdio: 'pipe' });
const app = readFileSync(htmlPath, 'utf8'), art = readFileSync(ART, 'utf8'), prev = readFileSync(PREV, 'utf8');
assert.equal(app, readFileSync('index.html', 'utf8'), 'artifact HTML == index.html');

const markers = {
  'UX200 renderWa': /function renderWa\(/, 'UX200 wired': /U\.renderWa\(/, 'UX200 wa-root': /wa-root/, 'UX200 composer': /wa-composer/,
  'FIX43 inline inbox lib': /<script id="fix43-inbox-lib">/, 'FIX43 opener': /window\.NovaOpenInbox=/,
  'UX81 wa badge': /id="ux81-wa-badge"/, 'wa button': /id="novaWaBtn"/, 'inbox tab': /id="novaInboxTab"|tab\.id='novaInboxTab'/,
  'UX60 split cash': /UX60: in split mode the cash field auto-fills/, 'UX61 shift close': /id="novaShiftClose"/,
  'UX65 shortage': /id="novaShortageBtn"/, 'UX66 undo': /function showUndoToast/, 'UX10 mobile sale': /id="ux10-mobile-sale"/,
  'novaVat': /window\.novaVat=\(function\(\)/,
};
for (const [n, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${n}`);
assert.match(app, /<html[^>]*dir="rtl"/i); assert.match(app, /lang="ar"/);
assert.ok(!/location\.href='integrations\/whatsapp\/inbox\.html'/.test(app));
assert.ok(!/localStorage\.setItem\('nova\.flags\./.test(app), 'a flag is switched on by code');

// UX201: purchasing assets carry the supplier-status lib and the current purchases files
const table = JSON.parse(art.match(/const NOVA_PURCHASING_ASSETS=([\s\S]*?);\n\/\* NOVA_PURCHASING_ASSETS_END/)[1]);
const ptable = JSON.parse(prev.match(/const NOVA_PURCHASING_ASSETS=([\s\S]*?);\n\/\* NOVA_PURCHASING_ASSETS_END/)[1]);
for (const k of Object.keys(ptable)) assert.ok(table[k], `purchasing asset lost: ${k}`);
assert.equal(table['/supplier-status.js'].body, readFileSync('supplier-status.js', 'utf8'));
assert.equal(table['/purchases.js'].body, readFileSync('purchases.js', 'utf8'));
assert.match(table['/purchases.html'].body, /supplier-status\.js/);
assert.match(table['/purchases.js'].body, /renderSupplierStatus/);

for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML']) assert.ok(art.includes(s), `artifact lost ${s}`);
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n').replace(/\/\* NOVA_PURCHASING_ASSETS_BEGIN \*\/[\s\S]*?\/\* NOVA_PURCHASING_ASSETS_END \*\//, '');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML / purchasing assets changed');

// Click #novaWaBtn in a minimal fake DOM -> conversations view (#novaInboxView visible, activePage=inbox, no navigation)
const scripts = [...app.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
const lib = scripts.find((m) => m[2].includes('function renderWa(') && m[2].includes('NovaUnifiedInbox'))[2];
const inboxTab = scripts.find((m) => m[2].includes('UX48: hidden local inbox tab'))[2];
const badge = scripts.find((m) => m[1].includes('ux81-wa-badge'))[2];
const mkEl = (id) => { const el = { id, hidden: false, style: {}, dataset: {}, children: [], attrs: {}, cls: new Set(), L: {}, className: '', innerHTML: '', textContent: '', scrollTop: 0,
  classList: { toggle: (c, f) => { f ? el.cls.add(c) : el.cls.delete(c); }, remove: (c) => el.cls.delete(c), add: (c) => el.cls.add(c), contains: (c) => el.cls.has(c) },
  addEventListener(t, f) { (el.L[t] ||= []).push(f); }, setAttribute(k, v) { el.attrs[k] = v; },
  click() { (el.L.click || []).forEach((f) => f({ target: { closest: () => null }, preventDefault() {} })); },
  querySelector: () => null, querySelectorAll: () => [], insertBefore(n) { el.children.push(n); }, parentNode: null, nextSibling: null };
  return el; };
const created = [], byId = {}, get = (id) => byId[id] ||= mkEl(id);
const nav = get('nav'); nav.querySelector = (s) => (s === '[data-page="settings"]' ? mkEl('s') : null);
nav.querySelectorAll = () => created.filter((e) => e.id === 'novaInboxTab');
const host = get('novaPageView'); host.parentNode = { insertBefore: () => {} };
const wa = get('novaWaBtn'), body = mkEl('body'), store = { 'nova.flags.inbox': '1' };
const doc = { readyState: 'complete', body, hidden: false, addEventListener() {}, getElementById: (id) => created.find((e) => e.id === id) || (['novaWaBtn', 'novaPageView', 'novaWaBadge'].includes(id) ? get(id) : null),
  createElement: (t) => { const e = mkEl(''); e.tagName = t; created.push(e); return e; }, querySelector: (s) => (s === '.nova-nav' ? nav : null), querySelectorAll: () => [] };
const win = { addEventListener() {}, location: { href: 'https://nova.test/' } };
const ctx = vm.createContext({ window: win, document: doc, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  sessionStorage: { getItem: () => null }, setInterval: () => 0, fetch: undefined, Date, console });
ctx.globalThis = win; Object.assign(win, { document: doc, localStorage: ctx.localStorage });
// the inline inbox lib attaches to `root` (window)
vm.runInContext(`var root=window;${lib.replace(/\}\)\(typeof window !== 'undefined' \? window : globalThis\);?\s*$/, '})(window);')}`, ctx);
vm.runInContext(inboxTab, ctx);
vm.runInContext(badge, ctx);
const before = win.location.href;
wa.click();
const view = created.find((e) => e.id === 'novaInboxView');
assert.ok(view, 'conversations view created by the WhatsApp icon click');
assert.equal(view.hidden, false, 'conversations view visible');
assert.equal(body.dataset.activePage, 'inbox', 'active page is inbox');
assert.match(view.innerHTML, /wa-root/, 'WhatsApp Web layout rendered');
assert.equal(win.location.href, before, 'no navigation');
console.log('ux-pro6-artifact.check: OK');
