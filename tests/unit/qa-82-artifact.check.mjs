// Checks worker/live/nova-rx-preview.qa-82.js (UX85): parses, HTML == index.html, UX83 marker + earlier markers,
// Worker code outside the HTML literal is byte-identical to ux-pro6. UX84 lives in supplier-lookup.js (not embedded in the Worker).
// Offline, no deploy. Run: node tests/unit/qa-82-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.qa-82.js', PREV = 'worker/live/nova-rx-preview.ux-pro6.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux85-'));
const out = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
assert.equal(app, readFileSync('index.html', 'utf8'), 'artifact HTML == index.html');
const markers = {
  'UX83 unknown barcode': /UX83: unknown barcode-looking query/, 'UX83 toast': /لا يوجد صنف بهذا الباركود/,
  'UX200 renderWa': /function renderWa\(/, 'FIX43 inbox lib': /<script id="fix43-inbox-lib">/, 'wa button': /id="novaWaBtn"/,
  'UX60 split cash': /UX60: in split mode the cash field auto-fills/, 'UX61 shift close': /id="novaShiftClose"/,
  'UX65 shortage': /id="novaShortageBtn"/, 'UX66 undo': /function showUndoToast/, 'UX10 mobile sale': /id="ux10-mobile-sale"/,
  'novaVat': /window\.novaVat=\(function\(\)/, 'supplier-lookup script': /<script defer src="supplier-lookup\.js">/,
};
for (const [n, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${n}`);
assert.match(app, /<html[^>]*dir="rtl"/i); assert.match(app, /lang="ar"/);
// UX84 source marker (supplier-lookup.js is a separate static asset)
assert.match(readFileSync('supplier-lookup.js', 'utf8'), /su-unknown/, 'UX84 marker in supplier-lookup.js');
// outside the HTML literal byte-identical to ux-pro6
const strip = c => c.split('\n').map(l => l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l).join('\n');
assert.equal(strip(readFileSync(ART, 'utf8')), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('qa-82 artifact check OK');
