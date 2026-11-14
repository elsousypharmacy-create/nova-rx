// UX300: worker/live/nova-rx-preview.ux300.js = wa-live2 Worker code + current index.html (WhatsApp response-time dashboard). No deploy.
// Run: node tests/unit/ux300-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux300.js', PREV = 'worker/live/nova-rx-preview.wa-live2.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });
const out = path.join(mkdtempSync(path.join(tmpdir(), 'nova-ux300-')), 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, out], { stdio: 'pipe' });
const app = readFileSync(out, 'utf8');
assert.equal(app, readFileSync('index.html', 'utf8'), 'artifact HTML == index.html');
for (const re of [/UX300: WhatsApp customer-service dashboard/, /UX300-SHARED-BEGIN/, /function waCompute\(/, /id="waDashOpen"/, /hGet\('metrics'\)/, /Africa\/Cairo/,
  /data-drill/, /id="waHistForm"/, /FIX46: old WhatsApp chats/]) assert.match(app, re);
const blk = app.slice(app.indexOf('/* UX300: WhatsApp customer-service dashboard'), app.indexOf('/* UX241: bounded DOM'));
assert.ok(blk.length > 5000 && !/localStorage\.setItem|sessionStorage\.setItem|method:\s*'(POST|PUT|DELETE|PATCH)'/.test(blk), 'dashboard is read-only and never persists data');
const art = readFileSync(ART, 'utf8');
assert.ok(!/h_[ubps]_[0-9a-f]{24}/.test(art), 'no backfilled message ids in the artifact');
const strip = (c) => c.split('\n').map((l) => (l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l)).join('\n');
assert.equal(strip(art), strip(readFileSync(PREV, 'utf8')), 'worker code outside HTML changed');
console.log('ux300 artifact check OK');
