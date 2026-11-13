// Checks worker/live/nova-rx-preview.ux-fixes1.js (UX7): parses, embeds the UX1-UX6 frontend
// fixes, and keeps every handler present in phase10-1. Offline: no deploy, no Cloudflare calls.
// Run: node tests/unit/ux-fixes1-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux-fixes1.js';
const PREV = 'worker/live/nova-rx-preview.phase10-1.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });

const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux7-'));
const html = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, html], { stdio: 'pipe' });
const app = readFileSync(html, 'utf8');
const art = readFileSync(ART, 'utf8');
const prev = readFileSync(PREV, 'utf8');

const markers = {
  'UX1 mobile topbar wrap rule': /@media \(max-width:600px\)\{\s*\.top-header\{flex-wrap:wrap!important/,
  'UX2 nav scrollIntoView': /scrollIntoView/,
  'UX2 nav edge fade': /UX2: mobile nav edge fade/,
  'UX3 sw HEAD guard': /fetch\(swUrl, \{method:'HEAD'/,
  'UX4 labels fab padding': /UX4: reserve room for the floating labels button/,
  'UX4 icon-only fab on phones': /#novaAiLaunch\{width:44px;height:44px/,
  'UX5 12px floor': /\.status-pill\{font-size:12px/,
  'UX6 products empty-column handling': /shown\.some\(p=>p\.pack\)/,
};
for (const [name, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${name}`);
assert.ok(!/\.status-pill\{font-size:11px/.test(app), 'old 11px status-pill rule still present');

// Black Edition Arabic RTL page preserved.
assert.match(app, /<html[^>]*dir="rtl"/i);
assert.match(app, /lang="ar"/);

// Handlers from phase10-1 are all still present.
for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML',
  'novaSecretsRequest', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML']) {
  assert.ok(prev.includes(s), `phase10-1 baseline lost ${s}?`);
  assert.ok(art.includes(s), `artifact lost ${s}`);
}
// Everything outside the app HTML literal is byte-identical to phase10-1.
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML changed');
console.log('ux-fixes1-artifact.check: OK');
