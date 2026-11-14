// Checks worker/live/nova-rx-preview.ux-pro2.js (UX36): parses, embeds the UX22-UX35 frontend
// changes on top of ux-pro1, and keeps all Worker code outside the app HTML literal byte-identical.
// Offline: no deploy, no Cloudflare calls. Run: node tests/unit/ux-pro2-artifact.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ART = 'worker/live/nova-rx-preview.ux-pro2.js';
const PREV = 'worker/live/nova-rx-preview.ux-pro1.js';
execFileSync('node', ['--check', ART], { stdio: 'pipe' });

const dir = mkdtempSync(path.join(tmpdir(), 'nova-ux36-'));
const html = path.join(dir, 'app.html');
execFileSync('node', ['tools/build-worker-artifact.mjs', '--extract', ART, html], { stdio: 'pipe' });
const app = readFileSync(html, 'utf8');
const art = readFileSync(ART, 'utf8');
const prev = readFileSync(PREV, 'utf8');

const markers = {
  'UX22 single printer status': /function printerState\(\)/,
  'UX23 return dialog closeRet + Esc': /const closeRet=\(\)=>\{ov\.remove\(\);document\.removeEventListener\('keydown',retKey,true\)\}/,
  'UX23 credit return collects ledger': /l\.collect\(\{id:'ret-'\+res\.ret\.id/,
  'UX24 mobile cards tables': /nova-data-table nova-cards/,
  'UX25 toast bottom-center': /\.toast-container\{top:auto!important;bottom:calc\(10px/,
  'UX26 receipt formatting': /NovaFmt\.payLabel/,
  'UX27 dialog close button': /class="nova-dlg-x"/,
  'UX27 chip style': /\.nova-chip\{min-height:36px/,
  'UX29 single VAT source': /window\.novaVat=\(function\(\)/,
  'UX29 VAT settings input': /id="novaVatRate"/,
  'UX30 payment breakdown': /id="novaPayBreakdown"/,
  'UX30 demo data collapsed': /id="novaDemoData"/,
  'UX31 offline chip script': /id="offlineChip"/,
  'UX31 offline message': /بدون اتصال — الفواتير تُحفظ على هذا الجهاز/,
  'UX31 self-hosted logo': /class="elsousy-brand-mark" src="icon\.svg"/,
  'UX32 credit guard hint': /id="checkoutCreditHint"/,
  'UX33 nav active tab scroll': /querySelector\('\.nova-tab\.active'\)/,
  'UX33 compact mobile cart rows': /UX33: compact mobile cart rows/,
  'UX34 touch targets': /UX34: >=44px hit areas/,
  'UX35 arabic settings copy': /المظهر: Black Edition، خط Cairo، مناسب للتابلت/,
  'UX28 arabic i18n': /اختر لغة العرض/,
};
for (const [name, re] of Object.entries(markers)) assert.match(app, re, `missing marker: ${name}`);
// UX9-UX19 markers carried over from ux-pro1 and UX1-UX6 from ux-fixes1.
assert.match(app, /id="ux10-mobile-sale"/);
assert.match(app, /id="nova-credit-ledger"/);
assert.match(app, /UX2: mobile nav edge fade/);

// Black Edition Arabic RTL page preserved.
assert.match(app, /<html[^>]*dir="rtl"/i);
assert.match(app, /lang="ar"/);

// Handlers unchanged.
for (const s of ['/emergency/stock.json', '/whatsapp-inbox.html', '/api/suppliers', 'NOVA_SECRETS_ADMIN_HTML',
  'novaSecretsRequest', 'STICKER_STUDIO_HTML', 'NOVA_WA_HTML', 'NOVA_PURCHASING_ASSETS']) {
  assert.ok(prev.includes(s), `ux-pro1 baseline lost ${s}?`);
  assert.ok(art.includes(s), `artifact lost ${s}`);
}
// Everything outside the app HTML literal is byte-identical to ux-pro1.
const strip = (c) => c.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
assert.equal(strip(art), strip(prev), 'worker code outside app HTML changed');
console.log('ux-pro2-artifact.check: OK');
