// UX404 preview artifact: worker/live/nova-rx-preview.ux-404.js = ux400 Worker code (byte-identical outside the app HTML literal)
// + current index.html (WhatsApp-smooth conversations). Checks node --check, UX404 + conversations markers, PIN stays removed,
// SW cache v4 kept. Extracts the embedded HTML into a temp dir; never prints secrets. No deploy.
// Run: node tests/unit/artifact-ux404.check.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.ux-404.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.ux400.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

execFileSync(process.execPath, ['--check', ART]);
ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 'ux404-art-'));
execFileSync(process.execPath, [BUILD, '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8');
rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');

// UX405 moved main index.html on; the UX404 artifact stays pinned to the exact app HTML it shipped.
ck('app HTML is the UX404 build (pinned sha256)', createHash('sha256').update(app).digest('hex') === 'ea288d23a570ea4af0e20a79f8eec551f49f151942bf507c1a4ae90f9defcbf4');
const strip = (s) => s.split('\n').filter((l) => !l.includes('new Response("<!DOCTYPE html>')).join('\n');
ck('worker code outside the HTML literal identical to ux400', strip(raw) === strip(readFileSync(BASE, 'utf8')));
ck('one app HTML literal line', raw.split('\n').filter((l) => l.includes('new Response("<!DOCTYPE html>')).length === 1);

const M = {
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
