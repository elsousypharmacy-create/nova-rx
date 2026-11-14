// Checks worker/live/nova-rx-preview.qa-203.js (UX218): parses, HTML == index.html, UX204-UX217 markers + earlier markers,
// Worker code outside the HTML literal byte-identical to qa-82. purchases.html / supplier-lookup.js are separate static assets.
// Offline, no deploy. Run: node tests/unit/qa-203-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.qa-203.js', PREV = 'worker/live/nova-rx-preview.qa-82.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux218-'));
const out = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
assert.equal(app, readFileSync('index.html', 'utf8'), 'artifact HTML == index.html');
const markers = {
  'UX204 wordmark': /UX204: keep the NOVA Rx wordmark whole/, 'UX205 scroll-snap': /UX205: mobile nav scroll-snap/,
  'UX206 cart row': /<style id="ux206-mobile-cart-row">/, 'UX207 fab padding': /UX207: products list ends above the floating stickers FAB/,
  'UX208 inbox dark': /var WA_CSS = '\.wa-root\{direction:rtl;display:flex;height:calc\(100vh - 120px\);min-height:420px;background:#0d0f12/,
  'UX209 wa target': /<style id="ux209-wa-target">/, 'UX210 compact header': /UX210: compact single-row sale header/,
  'UX211 row fill': /__novaRowFillTok/, 'UX212 kpis': /id="novaProductsKpis"/, 'UX213 reports empty': /id="novaRepEmpty"/,
  'UX214 splash': /<div id="novaSplash"/, 'UX216 pay disabled': /UX216: disabled pay button/,
  'UX83 unknown barcode': /UX83: unknown barcode-looking query/, 'UX200 renderWa': /function renderWa\(/,
  'FIX43 inbox lib': /<script id="fix43-inbox-lib">/, 'wa button': /id="novaWaBtn"/,
  'UX60 split cash': /UX60: in split mode the cash field auto-fills/, 'UX61 shift close': /id="novaShiftClose"/,
  'UX65 shortage': /id="novaShortageBtn"/, 'UX66 undo': /function showUndoToast/, 'UX10 mobile sale': /id="ux10-mobile-sale"/,
  'novaVat': /window\.novaVat=\(function\(\)/, 'supplier-lookup script': /<script defer src="supplier-lookup\.js">/,
};
for (const [n, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${n}`);
assert.match(app, /<html[^>]*dir="rtl"/i); assert.match(app, /lang="ar"/);
// separate static assets
const pur = readFileSync('purchases.html', 'utf8');
assert.match(pur, /scrollTo/, 'UX205 nav script in purchases.html');
assert.match(pur, /rel="icon"/, 'UX217 icon link in purchases.html');
assert.match(readFileSync('supplier-lookup.js', 'utf8'), /su-unknown/, 'UX84 marker in supplier-lookup.js');
const strip = c => c.split('\n').map(l => l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l).join('\n');
assert.equal(strip(readFileSync(ART, 'utf8')), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('qa-203 artifact check OK');
