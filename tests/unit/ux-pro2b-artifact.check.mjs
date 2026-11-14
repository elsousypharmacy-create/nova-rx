// Checks worker/live/nova-rx-preview.ux-pro2b.js (UX54): parses, embeds the UX40-UX48/UX52 frontend
// changes on top of ux-pro2, keeps feature flags default OFF and keeps all Worker code outside the
// app HTML literal byte-identical. Offline: no deploy, no Cloudflare calls.
// Run: node tests/unit/ux-pro2b-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux-pro2b.js';
const PREV = 'worker/live/nova-rx-preview.ux-pro2.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });

const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux54-'));
const html = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, html], { stdio: 'pipe' });
const app = readFileSync(html, 'utf8');
const art = readFileSync(ART, 'utf8');
const prev = readFileSync(PREV, 'utf8');

const markers = {
  'UX40 icon set loaded': /<script src="\/nova-icons\.js" defer><\/script>/,
  'UX41 labels FAB only on products': /UX41: FAB only on the products page/,
  'UX42 merged About card': /id="novaAboutCard"/,
  'UX42 VAT row styled': /class="nova-vat-row"/,
  'UX42 wide settings cards': /nova-setting-card nova-card-wide/,
  'UX43 products toolbar': /class="nova-products-toolbar"/,
  'UX43 products cards with data-label': /data-label="الباركود"/,
  'UX44 mobile totals': /<style id="ux44-mobile-totals">/,
  'UX44 discount toggle': /id="btnDiscountToggle"/,
  'UX45 tokens stylesheet': /<link rel="stylesheet" href="\/ux-tokens\.css">/,
  'UX45 spacing token usage': /gap:var\(--sp-3\)/,
  'UX45 radius token usage': /border-radius:var\(--r-2\)/,
  'UX46 dialog 44px': /UX46: dialog controls >=44px/,
  'UX47 customers empty card': /nova-empty-card/,
  'UX47 customers add action': /novaCustAdd/,
  'UX48 inbox tab script': /UX48: hidden local inbox tab/,
  'UX52 transfers block': /id="novaTransfers"/,
};
for (const [name, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${name}`);
// Carried over from ux-pro2 / ux-pro1.
assert.match(app, /window\.novaVat=\(function\(\)/);
assert.match(app, /id="ux10-mobile-sale"/);
assert.match(app, /id="nova-credit-ledger"/);

// Flags default OFF: only an explicit '1' in localStorage enables them.
assert.match(app, /localStorage\.getItem\('nova\.flags\.inbox'\)==='1'/);
assert.match(app, /localStorage\.getItem\('nova\.flags\.transfers'\)==='1'/);
assert.ok(!/localStorage\.setItem\('nova\.flags\./.test(app), 'a flag is switched on by code');
assert.match(app, /Flag nova\.flags\.inbox==='1' \(default OFF/);

// Black Edition Arabic RTL page preserved.
assert.match(app, /<html[^>]*dir="rtl"/i);
assert.match(app, /lang="ar"/);

// Handlers unchanged (supplier / whatsapp / emergency stock).
for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML',
  'novaSecretsRequest', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML', 'NOVA_PURCHASING_ASSETS']) {
  assert.ok(prev.includes(s), `ux-pro2 baseline lost ${s}?`);
  assert.ok(art.includes(s), `artifact lost ${s}`);
}
// Everything outside the app HTML literal is byte-identical to ux-pro2.
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML changed');
console.log('ux-pro2b-artifact.check: OK');
