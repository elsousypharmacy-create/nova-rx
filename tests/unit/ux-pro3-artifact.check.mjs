// Checks worker/live/nova-rx-preview.ux-pro3.js (UX80): parses, embeds the UX60-UX71 frontend changes
// on top of ux-pro2b (keeping UX1-UX53 markers) and keeps all Worker code outside the app HTML literal
// byte-identical to ux-pro2b. Offline: no deploy, no Cloudflare calls.
// Run: node tests/unit/ux-pro3-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux-pro3.js';
const PREV = 'worker/live/nova-rx-preview.ux-pro2b.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });

const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux80-'));
const html = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, html], { stdio: 'pipe' });
const app = readFileSync(html, 'utf8');
const art = readFileSync(ART, 'utf8');
const prev = readFileSync(PREV, 'utf8');

const markers = {
  'UX60 split cash auto-fill': /UX60: in split mode the cash field auto-fills/,
  'UX61 shift close panel': /id="novaShiftClose"/,
  'UX61 shift counted cash': /id="novaShiftCount"/,
  'UX62 manual receive dialog': /id="novaManualReceive"/,
  'UX62 receive cost field': /id="novaRcvCost"/,
  'UX63 alias table': /UX63: small static Arabic generic-name/,
  'UX64 stock warning': /function warnOversell/,
  'UX64 clamp to stock': /function clampLineToStock/,
  'UX65 shortage button': /id="novaShortageBtn"/,
  'UX65 shortages store': /nova-rx-shortages-v1/,
  'UX66 undo toast': /function showUndoToast/,
  'UX66 undo restore': /function restoreCart/,
  'UX67 unit pref': /function setUnitPref/,
  'UX67 add product fn': /function addProductToInvoice/,
  'UX68 statement dialog': /function openStatement/,
  'UX68 statement dialog id': /novaStatement/,
  'UX68 pay chips': /data-pay-chip="half"/,
  'UX69 first-run hint': /id="novaFirstRunHint"/,
  'UX69 help chip': /id="novaHelpChip"/,
  'UX70 open on sale': /switchPage\(hashPage\(\)\|\|'sale'\)/,
  'UX71 days since': /function daysSinceDate/,
  'UX71 refill hint': /id="custRefillHint"/,
  // earlier markers (UX40-UX53)
  'UX40 icon set loaded': /<script src="\/nova-icons\.js" defer><\/script>/,
  'UX42 merged About card': /id="novaAboutCard"/,
  'UX43 products toolbar': /class="nova-products-toolbar"/,
  'UX44 discount toggle': /id="btnDiscountToggle"/,
  'UX45 tokens stylesheet': /<link rel="stylesheet" href="\/ux-tokens\.css">/,
  'UX46 dialog 44px': /UX46: dialog controls >=44px/,
  'UX47 customers add action': /novaCustAdd/,
  'UX48 inbox tab script': /UX48: hidden local inbox tab/,
  'UX52 transfers block': /id="novaTransfers"/,
  // earlier markers (UX1-UX35)
  'UX10 mobile sale': /id="ux10-mobile-sale"/,
  'credit ledger': /id="nova-credit-ledger"/,
  'novaVat': /window\.novaVat=\(function\(\)/,
};
for (const [name, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${name}`);

assert.match(app, /localStorage\.getItem\('nova\.flags\.inbox'\)==='1'/);
assert.ok(!/localStorage\.setItem\('nova\.flags\./.test(app), 'a flag is switched on by code');
assert.match(app, /<html[^>]*dir="rtl"/i);
assert.match(app, /lang="ar"/);

for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML',
  'novaSecretsRequest', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML', 'NOVA_PURCHASING_ASSETS']) {
  assert.ok(prev.includes(s), `ux-pro2b baseline lost ${s}?`);
  assert.ok(art.includes(s), `artifact lost ${s}`);
}
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML changed');
console.log('ux-pro3-artifact.check: OK');
