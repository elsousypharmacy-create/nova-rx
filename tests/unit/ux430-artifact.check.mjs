// UX430: worker/live/nova-rx-preview.ux-430.js = ux400 artifact (newest, PIN-free conversations) + the UX430 WhatsApp KPIs block.
// Proves: node --check passes, auto-deploy markers present, worker code outside the HTML is unchanged, and the app HTML is
// byte-identical to ux400 outside the UX430 block (conversations regions intact). No deploy, no network, prints no secrets.
// Run: node --no-warnings tests/unit/ux430-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = path.join(ROOT, 'worker/live/nova-rx-preview.ux-430.js'), BASE = path.join(ROOT, 'worker/live/nova-rx-preview.ux400.js');
execFileSync(process.execPath, ['--check', ART], { stdio: 'pipe' });
const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux430-'));
const extract = (f, name) => { const o = path.join(dir, name); execFileSync(process.execPath, [path.join(ROOT, 'tools/build-worker-artifact.mjs'), '--extract', f, o], { stdio: 'pipe' }); return readFileSync(o, 'utf8'); };
const app = extract(ART, 'new.html'), base = extract(BASE, 'base.html');
const BEGIN = '<!-- UX430:BEGIN WhatsApp KPIs -->', END = '<!-- UX430:END -->';
const i = app.indexOf(BEGIN), j = app.indexOf(END);
assert.ok(i > 0 && j > i, 'UX430 block present');
assert.equal(app.slice(0, i) + app.slice(j + END.length).replace(/^\n/, ''), base, 'HTML outside the UX430 block == ux400 (conversations untouched)');
const blk = app.slice(i, j);
for (const m of ['id="UX430_WA_KPI"', 'novaWaKpiCard', 'novaWaKpiView', '/api/v1/inbox/history/metrics', 'function kpCompute(', 'function kpTrend(', 'data-kp-chat', 'data-kp-preset']) assert.ok(blk.includes(m), 'block marker ' + m);
assert.ok(!/method:\s*'(POST|PUT|DELETE|PATCH)'|X-Nova-Pin|sessionStorage\.setItem/.test(blk), 'KPI block is GET-only, PIN-free and never persists chat data');
assert.ok(!/localStorage\.setItem/.test(blk), 'KPI block never writes localStorage');
// the same block is in index.html
const idx = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.equal(idx.slice(idx.indexOf(BEGIN), idx.indexOf(END)), blk, 'index.html carries the identical UX430 block');
// conversations + deploy markers (tools/preview_auto_deploy.py REQUIRED_MARKERS) and UX400 PIN-free state
for (const m of ['novaWaBtn', 'hLoad', 'inbox/history', 'data-wa-inbox-open', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed', 'function hOn()', 'hSend', '/sw.js?v=4']) assert.ok(app.includes(m), 'marker ' + m);
for (const m of ['wa-lockform', 'waHistPin', 'X-Nova-Pin', 'PIN_REQUIRED', 'function hPin(']) assert.ok(!app.includes(m), 'PIN leftover ' + m);
const art = readFileSync(ART, 'utf8');
const strip = (c) => c.split('\n').map((l) => (l.includes('new Response("<!DOCTYPE html>') ? 'HTML_LINE' : l)).join('\n');
assert.equal(strip(art), strip(readFileSync(BASE, 'utf8')), 'worker code outside HTML unchanged');
assert.ok(art.includes("const CACHE='nova-rx-shell-v4'"));
console.log('ux430 artifact check OK', art.length, 'bytes');
