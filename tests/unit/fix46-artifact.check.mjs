// FIX46: worker/live/nova-rx-preview.fix46.js = qa-203 Worker code + current index.html (PIN-gated old WhatsApp chats).
// Offline, no deploy. Run: node tests/unit/fix46-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.fix46.js', PREV = 'worker/live/nova-rx-preview.qa-203.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const out = path.join(mkdtempSync(path.join(tmpdir(), 'nova-fix46-')), 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
// index.html moved on (UX300 and later); the exact-equality check lives in the newest artifact's check. Here: the FIX46 UI is still in index.html.
assert.ok(readFileSync('index.html', 'utf8').includes('FIX46: old WhatsApp chats come from the staging API'), 'index.html keeps FIX46');
for (const re of [/FIX46: old WhatsApp chats come from the staging API behind the pharmacy PIN/, /id="waHistForm"/, /'X-Nova-Pin':p/,
  /sessionStorage\.setItem\(HK,pv\)/, /m\.kind === 'sys'/, /if \(c && c\.history\) return 0;/, /id="novaWaBtn"/, /function renderWa\(/])
  assert.match(app, re);
// privacy: no chat data or PIN baked into the public artifact
const blk = app.slice(app.indexOf('/* FIX46: old WhatsApp chats'), app.indexOf("nav.addEventListener('click',function(e){if(e.target.closest('[data-page]')){box.hidden=true"));
assert.ok(blk.length > 1000 && !/localStorage\.setItem/.test(blk), 'FIX46 never writes localStorage (PIN or chats)');
assert.ok(!/h_[ubps]_[0-9a-f]{24}/.test(readFileSync(ART, 'utf8')), 'no backfilled message ids in the artifact');
const strip = (c) => c.split('\n').map((l) => (l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l)).join('\n');
assert.equal(strip(readFileSync(ART, 'utf8')), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('fix46 artifact check OK');
