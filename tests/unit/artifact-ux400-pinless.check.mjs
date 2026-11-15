// UX400 preview artifact: conversations UI has no PIN form; SW cache-bust is v4.
// Extracts the embedded app HTML; never prints secrets.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.ux400.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');

const raw = readFileSync(ART);
const dir = mkdtempSync(join(tmpdir(), 'ux400-art-'));
const htmlPath = join(dir, 'app.html');
execFileSync(process.execPath, [BUILD, '--extract', ART, htmlPath], { stdio: 'pipe' });
const app = readFileSync(htmlPath, 'utf8');

const forbidden = [
  'wa-lockform',
  'waHistPin',
  'waHistForm',
  'X-Nova-Pin',
  'PIN_REQUIRED',
  'PIN_INVALID',
  'function hPin(',
  'المحادثات مقفولة',
  'محمية بـ PIN',
  'اكتب رقم PIN',
];
const missingForbidden = forbidden.filter((s) => app.includes(s));
if (missingForbidden.length) {
  throw new Error('PIN UI leftovers in extracted HTML: ' + missingForbidden.join(', '));
}

const required = [
  'data-wa-inbox-open',
  'function hOn()',
  'function hLoad()',
  'inbox/history',
  'hPoll',
  'winClosed',
  'hSend',
  'GATED',
  '/sw.js?v=4',
  'NOVA_FIX50',
  'NOVA_FIX50_VV',
];
const missing = required.filter((s) => !app.includes(s));
if (missing.length) {
  throw new Error('missing markers in extracted HTML: ' + missing.join(', '));
}

if (!raw.includes("const CACHE='nova-rx-shell-v4'")) {
  throw new Error('worker /sw.js cache name was not bumped to nova-rx-shell-v4');
}
if (raw.includes("const CACHE='nova-rx-shell-v3'")) {
  throw new Error('worker still serves nova-rx-shell-v3');
}

const sha = createHash('sha256').update(raw).digest('hex');
if (raw.length < 1_000_000) throw new Error('artifact unexpectedly small: ' + raw.length);
console.log('ok ux400 pinless artifact', raw.length, 'bytes sha256', sha);
