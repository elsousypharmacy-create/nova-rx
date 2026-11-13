// Checks worker/live/nova-rx-preview.ux-pro1.js (UX20): parses, embeds the UX9-UX19 frontend
// changes on top of ux-fixes1, and keeps all Worker code outside the app HTML literal byte-identical.
// Offline: no deploy, no Cloudflare calls. Run: node tests/unit/ux-pro1-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux-pro1.js';
const PREV = 'worker/live/nova-rx-preview.ux-fixes1.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });

const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux20-'));
const html = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, html], { stdio: 'pipe' });
const app = readFileSync(html, 'utf8');
const art = readFileSync(ART, 'utf8');
const prev = readFileSync(PREV, 'utf8');

const markers = {
  'UX9 closed modal not Tab-reachable': /closed modals are not Tab-reachable/,
  'UX9 checkout Tab trap': /\.modal-backdrop\.active/,
  'UX10 mobile sale style': /id="ux10-mobile-sale"/,
  'UX11 credit ledger inlined': /id="nova-credit-ledger"/,
  'UX11 ledger charge on credit sale': /createCreditLedger\(localStorage, 'nova\.credit'\)\.charge/,
  'UX11 debt ledger helper': /const ledger=\(\)=>window\.NovaCredit/,
  'UX12 low-stock KPI filter': /id="novaLowKpi"/,
  'UX12 pack fallback': /const packOf=p=>/,
  'UX12 arabic categories': /const catAr=\{Chronic:/,
  'UX13 report period selector': /data-rep-period/,
  'UX13 print end-of-day report': /novaPrintDay/,
  'UX14 return-all button': /id="novaRetAll"/,
  'UX14 quick reason chips': /data-ret-chip/,
  'UX15 refill box': /custRefillBox/,
  'UX15 refill function': /function refillLastInvoice/,
  'UX16 tap targets 44px': /#novaNearExpiryDays\{min-height:44px!important\}/,
  'UX17 shortcuts button F1': /Keyboard Shortcuts \(F1\)/,
  'UX18 shortcut tooltip arabic': /عرض اختصارات الكيبورد/,
  'UX19 receive deep link': /const wantReceive=/,
};
for (const [name, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${name}`);
// UX1-UX6 markers carried over from ux-fixes1.
assert.match(app, /UX2: mobile nav edge fade/);
assert.match(app, /UX4: reserve room for the floating labels button/);

// Black Edition Arabic RTL page preserved.
assert.match(app, /<html[^>]*dir="rtl"/i);
assert.match(app, /lang="ar"/);

// Handlers unchanged.
for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML',
  'novaSecretsRequest', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML', 'NOVA_PURCHASING_ASSETS']) {
  assert.ok(prev.includes(s), `ux-fixes1 baseline lost ${s}?`);
  assert.ok(art.includes(s), `artifact lost ${s}`);
}
// Everything outside the app HTML literal is byte-identical to ux-fixes1.
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML changed');
console.log('ux-pro1-artifact.check: OK');
