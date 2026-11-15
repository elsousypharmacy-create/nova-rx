// UX405 preview artifact: worker/live/nova-rx-preview.ux-405.js = ux-404 Worker code (byte-identical outside the app HTML literal)
// + current index.html (conversations + incoming WhatsApp media). Checks node --check, UX405 + UX404 + conversations markers, PIN stays removed,
// SW cache v4 kept. Extracts the embedded HTML into a temp dir; never prints secrets. No deploy.
// Run: node tests/unit/artifact-ux405.check.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.ux-405.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.ux-404.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

execFileSync(process.execPath, ['--check', ART]);
ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 'ux405-art-'));
execFileSync(process.execPath, [BUILD, '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8');
rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');

ck('app HTML equals main index.html', app === readFileSync(join(ROOT, 'index.html'), 'utf8'));
const strip = (s) => s.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside the HTML literal identical to ux-404', strip(raw) === strip(readFileSync(BASE, 'utf8')));
ck('one app HTML literal line', raw.split('\n').filter((l) => l.includes('new Response("<!DOCTYPE html>')).length === 1);

const M = {
  UX405: ['function mediaHtml(', 'function openLightbox(', 'data-wa-media-open', 'data-wa-lightbox', 'data-wa-mimg', 'data-wa-mplay', 'wa-mdoc', 'data-wa-media-miss', "media?id='", 'mediaUrl:mUrl,mediaFail:wa.mfail', 'function previewText('],
  UX404: ['class="wa-gap"', 'data-wa-fab-n', "cBtn('emoji'", "cBtn('attach'", "cBtn('mic'", '@keyframes waOpen', 'prefers-reduced-motion:reduce){.wa-root[data-anim]',
    'env(safe-area-inset-top', 'function msgAnchor(', 'function olderAuto(', 'wa-first', 'passive:true', 'requestAnimationFrame(fit)'],
  conversations: ['data-wa-inbox-open', 'function hOn()', 'function hLoad()', 'inbox/history', 'hPoll', 'winClosed', 'hSend', 'GATED', 'data-wa-older', 'data-wa-latest',
    'NOVA_FIX50', 'NOVA_FIX50_VV', 'wa-root', 'novaInboxView', 'novaWaBtn'],
  sw: ['/sw.js?v=4'],
};
for (const [k, ms] of Object.entries(M)) for (const m of ms) ck(k + ' marker ' + m, app.includes(m));
for (const s of ['wa-lockform', 'waHistPin', 'waHistForm', 'X-Nova-Pin', 'PIN_REQUIRED', 'PIN_INVALID', 'function hPin(', 'المحادثات مقفولة', 'محمية بـ PIN', 'اكتب رقم PIN'])
  ck('no PIN UI: ' + s, !app.includes(s));
ck('worker /sw.js cache stays nova-rx-shell-v4', raw.includes("const CACHE='nova-rx-shell-v4'"));
ck('no user-scalable=no', !/user-scalable\s*=\s*no/.test(app));
ck('artifact size sane', raw.length > 1_000_000);
console.log('sha256', createHash('sha256').update(raw).digest('hex'), raw.length, 'bytes');
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
