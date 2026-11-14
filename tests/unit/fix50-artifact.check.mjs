// FIX50: worker/live/nova-rx-preview.fix50.js = wa-send1 Worker code + index.html with 16px touch inputs, viewport meta, visualViewport chat fit.
// Offline, no deploy. Run: node tests/unit/fix50-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.fix50.js', PREV = 'worker/live/nova-rx-preview.wa-send1.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const out = path.join(mkdtempSync(path.join(tmpdir(), 'nova-wasend-')), 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
for (const re of [/id="NOVA_FIX50"/, /font-size:16px!important/, /interactive-widget=resizes-content/, /viewport-fit=cover/, /id="NOVA_FIX50_VV"/, /function hSend\(id,text\)/]) assert.match(app, re);
assert.ok(!/user-scalable=no/.test(app), 'pinch zoom stays enabled');
const strip = (c) => c.split('\n').map((l) => (l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l)).join('\n');
assert.equal(strip(readFileSync(ART, 'utf8')), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('fix50 artifact check OK');
