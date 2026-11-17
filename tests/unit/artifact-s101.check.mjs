// S1-01 preview artifact: worker/live/nova-rx-preview.s1-01.js = ux-407 Worker code (byte-identical outside the app HTML literal)
// + current index.html (chat PIN lock card, X-Nova-Pin on every inbox/history call, media through authenticated blob URLs).
// Checks node --check, app HTML equals main index.html, worker code outside the HTML literal equals ux-407, lock markers, no secrets.
// No deploy, never prints secrets. Run: node tests/unit/artifact-s101.check.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.s1-01.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.ux-407.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

execFileSync(process.execPath, ['--check', ART]);
ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 's101-art-'));
execFileSync(process.execPath, [BUILD, '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8');
rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');

// S1-03: index.html moved on (offline sync wiring). The exact-equality check lives in the newest artifact's check (artifact-s103.check.mjs); here s1-01 stays a frozen snapshot.
ck('app HTML is a frozen s1-01 snapshot', app.startsWith('<!DOCTYPE html>') && app.includes('function hLock(') && app.length > 500000);
const noHtml = (s) => s.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside the app HTML literal is identical to ux-407', noHtml(raw) === noHtml(readFileSync(BASE, 'utf8')));
ck('one app HTML literal line', raw.split('\n').filter((l) => l.includes('new Response("<!DOCTYPE html>') || l.includes('novaWhatsAppSpaHtml(url.pathname,"<!DOCTYPE html>')).length === 1);
for (const m of ['function hHdr(', 'function hLock(', 'function hUnlockShow(', "sessionStorage.getItem('novaHistPin')", "sessionStorage.setItem('novaHistPin'", 'اكتب رقم PIN الصيدلية', "headers:hHdr({Accept:'application/json'})", 'var mBlob={},mBusy={};', "hLock(hist.lockMsg||'')"])
  ck('lock marker ' + m, app.includes(m));
ck('PIN never in localStorage', !/localStorage\.(setItem|getItem)\([^)]*novaHistPin/.test(app));
ck('old pinless claim removed from the history comment', !app.includes('no PIN on staging/preview, the UI never sends a PIN header'));
ck('no secrets in artifact', !/VAPID_PRIVATE_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/.test(raw) && !/-----BEGIN/.test(raw));
ck('artifact size sane', raw.length > 1_000_000);
console.log('sha256', createHash('sha256').update(raw).digest('hex'), raw.length, 'bytes');
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
