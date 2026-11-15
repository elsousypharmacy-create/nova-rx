// UX407 preview artifact: worker/live/nova-rx-preview.ux-407.js = ux-406 Worker code (byte-identical outside the app HTML literal; /sw.js unchanged)
// + current index.html (PR #467/#468 Home WhatsApp KPIs flag gate: localStorage nova.flags.waKpis==='1', default off; conversations: staff-reply prefix stripped on display, WhatsApp bubble sides, composer flush on the keyboard, no focus box).
// Checks node --check, UX401 + UX407 + UX406 + UX405 + UX404 + conversations markers, PIN stays removed, SW cache v4 kept. No deploy, never prints secrets.
// Run: node tests/unit/artifact-ux407.check.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.ux-407.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.ux-406.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

execFileSync(process.execPath, ['--check', ART]);
ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 'ux407-art-'));
execFileSync(process.execPath, [BUILD, '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8');
rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');

ck('app HTML equals main index.html', app === readFileSync(join(ROOT, 'index.html'), 'utf8'));
const SWK = '"/sw.js":{"body":';
const swBody = (code) => { const j = code.indexOf(SWK) + SWK.length; let e = j + 1; while (code[e] !== '"') { if (code[e] === '\\') e++; e++; } return [code.slice(0, j) + code.slice(e + 1), JSON.parse(code.slice(j, e + 1))]; };
const strip = (s) => swBody(s.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n'))[0];
ck('worker code outside the HTML literal and /sw.js body identical to ux-406', strip(raw) === strip(readFileSync(BASE, 'utf8')));
const sw = swBody(raw)[1];
ck('embedded /sw.js identical to ux-406', sw === swBody(readFileSync(BASE, 'utf8'))[1]);
ck('embedded /sw.js equals repo sw.js', sw === readFileSync(join(ROOT, 'sw.js'), 'utf8'));
for (const m of ["addEventListener('push'", "addEventListener('notificationclick'", 'showNotification(', "type:'nova-wa-push'", "type:'nova-wa-open'", "openWindow('/#wa')", "addEventListener('fetch'"]) ck('sw marker ' + m, sw.includes(m));
ck('no secrets in artifact', !/VAPID_PRIVATE_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/.test(raw) && !/-----BEGIN/.test(raw));
ck('UX407: no composer <form>', !app.includes('<form class="wa-composer"') && !app.includes("'<form class=\"wa-composer\""));
ck('one app HTML literal line', raw.split('\n').filter((l) => l.includes('new Response("<!DOCTYPE html>')).length === 1);

const M = {
  KPI: ['function kpFlagOn()', "localStorage.getItem('nova.flags.waKpis') === '1'", 'if (!kpFlagOn())', "Hidden unless localStorage nova.flags.waKpis==='1' (default OFF)"],
  UX407: ['function stripStaffPrefix(', 'function shownText(', '.wa-msg.wa-in{justify-content:flex-end}.wa-msg.wa-out{justify-content:flex-start}', 'data-wa-send', 'function waSubmit(){', '#waComposer #waInput:focus-visible', '-webkit-tap-highlight-color:transparent', '.wa-root[data-kbd] .wa-composer{padding-bottom:8px}', '(Number(vv.offsetTop)||0)+vv.height', 'function lock(on)', 'data-wa-kbd-off'],
  UX406: ['function createUnread(', 'function titleBadge(', 'function notifyHtml(', 'data-wa-notify', 'data-wa-mute', 'data-wa-tab-unread', 'window.NovaWaNotify', 'push/subscribe', 'push/key', 'Notification.requestPermission', 'nova.wa.seen.v1', "location.hash==='#wa'", 'notifHead:nHead()'],
  UX405: ['function mediaHtml(', 'function openLightbox(', 'data-wa-media-open', 'data-wa-lightbox', 'data-wa-mimg', 'data-wa-mplay', 'wa-mdoc', 'data-wa-media-miss', "media?id='", 'mediaUrl:mUrl,mediaFail:wa.mfail', 'function previewText('],
  UX401: ['function quoteBarHtml(', 'function quoteHtml(', 'function tick(', 'data-wa-quote-jump', 'data-wa-reply', 'data-wa-vplay', 'data-wa-emoji-panel', 'data-wa-attach-menu'],
  UX404: ['class="wa-gap"', 'data-wa-fab-n', "cTog('emoji'", "cTog('attach'", "cBtn('mic'", '@keyframes waOpen', 'prefers-reduced-motion:reduce){.wa-root[data-anim]',
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
