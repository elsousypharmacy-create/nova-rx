// S1-03 preview artifact: worker/live/nova-rx-preview.s1-03.js = s1-01 Worker code (byte-identical outside the app HTML literal)
// + current index.html (POS sale/return -> offline outbox + stock ledger wiring, scripts inlined, no new routes/assets).
// Built in CI by .github/workflows/build-preview-artifact.yml. No deploy, never prints secrets.
// Run: node tests/unit/artifact-s103.check.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = join(ROOT, 'worker/live/nova-rx-preview.s1-03.js');
const BASE = join(ROOT, 'worker/live/nova-rx-preview.s1-01.js');
const BUILD = join(ROOT, 'tools/build-worker-artifact.mjs');
let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };

execFileSync(process.execPath, ['--check', ART]);
ck('node --check', true);
const dir = mkdtempSync(join(tmpdir(), 's103-art-'));
execFileSync(process.execPath, [BUILD, '--extract', ART, join(dir, 'app.html')], { stdio: 'pipe' });
const app = readFileSync(join(dir, 'app.html'), 'utf8');
rmSync(dir, { recursive: true });
const raw = readFileSync(ART, 'utf8');

ck('app HTML equals main index.html', app === readFileSync(join(ROOT, 'index.html'), 'utf8'));
const noHtml = (s) => s.split('\n').filter((l) => !l.includes('"<!DOCTYPE html>')).join('\n');
ck('worker code outside the app HTML literal is identical to s1-01', noHtml(raw) === noHtml(readFileSync(BASE, 'utf8')));
ck('one app HTML literal line', raw.split('\n').filter((l) => l.includes('new Response("<!DOCTYPE html>') || l.includes('novaWhatsAppSpaHtml(url.pathname,"<!DOCTYPE html>')).length === 1);
for (const m of ['S1-03:BEGIN', 'S1-03:END', 'window.NovaOutbox', 'window.NovaStockLedger', 'root.novaSync', 'window.novaSync.afterSale(sale)', 'window.novaSync.afterReturn(sale, r)', 'novaSyncChip', 'function hHdr(', 'function hLock('])
  ck('marker ' + m, app.includes(m));
ck('S1-01 lock still present (no PIN in localStorage)', !/localStorage\.(setItem|getItem)\([^)]*novaHistPin/.test(app));
ck('no secrets in artifact', !/VAPID_PRIVATE_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/.test(raw) && !/-----BEGIN/.test(raw));
ck('artifact size sane', raw.length > 1_000_000);
console.log('sha256', createHash('sha256').update(raw).digest('hex'), raw.length, 'bytes');
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
