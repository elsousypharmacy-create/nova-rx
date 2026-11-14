// Combined FIX50+FIX51: worker/live/nova-rx-preview.wa-live2.js = wa-send1 Worker code
// + current index.html (iOS 16px/no-zoom, visualViewport composer, live poll, 24h window).
// Offline, no deploy. Run: node tests/unit/wa-live2-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.wa-live2.js', PREV = 'worker/live/nova-rx-preview.wa-send1.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const out = path.join(mkdtempSync(path.join(tmpdir(), 'nova-walive2-')), 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
for (const re of [
  /id="NOVA_FIX50"/,
  /font-size:16px!important/,
  /interactive-widget=resizes-content/,
  /viewport-fit=cover/,
  /id="NOVA_FIX50_VV"/,
  /function hSend\(id,text\)/,
  /hUrl\(\)\+'send'/,
  /'X-Nova-Pin':p/,
  /maxlength="1000"/,
  /data-tick="sending"/,
  /data-send-err/,
  /function histSel\(\)/,
  /function hPoll\(\)/,
  /function winClosed\(id\)/,
  /data-wa-window/,
  /setInterval\(hPoll,4000\)/,
]) assert.match(app, re);
assert.ok(!/user-scalable=no/.test(app), 'pinch zoom stays enabled');
const blk = app.slice(app.indexOf('function hSend(id,text)'), app.indexOf('function convs(){'));
assert.ok(blk.length > 300 && !/localStorage\.setItem/.test(blk), 'send path never writes localStorage');
assert.ok(!/body:JSON\.stringify\(\{[^}]*(to|phone)\s*:/.test(blk), 'client never sends a phone number');
assert.ok(!/h_[ubps]_[0-9a-f]{24}/.test(readFileSync(ART, 'utf8')), 'no backfilled message ids in the artifact');
const strip = (c) => c.split('\n').map((l) => (l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l)).join('\n');
assert.equal(strip(readFileSync(ART, 'utf8')), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('wa-live2 artifact check OK');
