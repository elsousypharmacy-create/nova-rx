// Free D1 backups (no R2): scripts/d1-bookmark.sh + scripts/d1-backup.sh with a mocked wrangler.
// No network, no Cloudflare calls. Needs bash, jq, openssl, gzip (present on ubuntu runners).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(import.meta.dirname, '../..');
const BM = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
let pass = 0;
const ok = (name) => { pass++; console.log('ok -', name); };

function mock(dir) {
  const p = join(dir, 'wrangler');
  writeFileSync(p, `#!/usr/bin/env bash
case "$MOCK_MODE" in
  denied) echo '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]' >&2; exit 1;;
  broken) echo 'boom' >&2; exit 1;;
esac
if [ "$1 $2 $3" = "d1 time-travel info" ]; then
  [ "$MOCK_MODE" = text ] && { echo "The current bookmark is '${BM}'"; exit 0; }
  echo '{"bookmark":"${BM}","timestamp":"2026-11-13T15:00:00Z"}'; exit 0
fi
if [ "$1 $2" = "d1 export" ]; then
  [ "$MOCK_MODE" = exportdenied ] && { echo 'not authorized to access this service [code: 7403] https://x.example/signed?sig=abc' >&2; exit 1; }
  for a in "$@"; do case "$a" in --output=*) out="\${a#--output=}";; esac; done
  [ "$4" = "--remote" ] || { echo "expected --remote" >&2; exit 3; }
  cat > "$out" <<'SQL'
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE sales (id TEXT PRIMARY KEY, total INTEGER);
INSERT INTO "tenants" ("id","name") VALUES('t1','صيدلية');
INSERT INTO "sales" ("id","total") VALUES('s1',100);
INSERT INTO "sales" ("id","total") VALUES('s2',250);
SQL
  echo "🌀 Downloading SQL to $out from https://signed.example/very-secret-url"; exit 0
fi
echo "unexpected: $*" >&2; exit 9
`);
  chmodSync(p, 0o755);
  return p;
}

function run(script, env, args = []) {
  return spawnSync('bash', [join(ROOT, 'scripts', script), ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(), ...env },
  });
}

const dir = mkdtempSync(join(tmpdir(), 'd1bk-'));
const WRANGLER = mock(dir);

// bookmark: JSON output
{
  const r = run('d1-bookmark.sh', { WRANGLER });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true); assert.equal(j.bookmark, BM); assert.equal(j.db, 'nova-rx-staging');
  ok('bookmark parsed from JSON');
}
{
  const r = run('d1-bookmark.sh', { WRANGLER, MOCK_MODE: 'text' }, ['nova-rx-x']);
  assert.equal(r.status, 0); const j = JSON.parse(r.stdout);
  assert.equal(j.bookmark, BM); assert.equal(j.db, 'nova-rx-x');
  ok('bookmark parsed from text output');
}
{
  const r = run('d1-bookmark.sh', { WRANGLER, MOCK_MODE: 'denied' });
  assert.equal(r.status, 2); const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false); assert.match(j.reason, /Account\.D1:Read/);
  ok('permission error names the missing permission');
}
{
  const r = run('d1-bookmark.sh', { WRANGLER, MOCK_MODE: 'broken' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).ok, false);
  ok('other failure -> exit 1 with JSON');
}

// backup: missing passphrase
{
  const out = mkdtempSync(join(dir, 'o0-'));
  const r = run('d1-backup.sh', { WRANGLER, BACKUP_OUTDIR: out });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /MISSING SECRET: BACKUP_PASSPHRASE/);
  assert.equal(readdirSync(out).length, 0);
  ok('refuses without passphrase');
}

// backup: happy path, encryption round-trip, manifest checksum, no plaintext left
const PASS = 'test-passphrase-not-a-secret-0123456789';
{
  const out = mkdtempSync(join(dir, 'o1-'));
  const r = run('d1-backup.sh', { WRANGLER, BACKUP_OUTDIR: out, BACKUP_PASSPHRASE: PASS });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes(PASS) && !r.stderr.includes(PASS), 'passphrase never printed');
  const files = readdirSync(out).sort();
  assert.equal(files.length, 2, files.join(','));
  const enc = files.find((f) => f.endsWith('.sql.gz.enc'));
  assert.ok(enc && files.includes('manifest.json'));
  assert.ok(!files.some((f) => f.endsWith('.sql')), 'no plaintext in output dir');
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const buf = readFileSync(join(out, enc));
  assert.equal(m.sha256, createHash('sha256').update(buf).digest('hex'));
  assert.equal(m.bytes, buf.length); assert.equal(m.file, enc);
  assert.equal(m.bookmark, BM); assert.equal(m.tables, 2);
  assert.deepEqual(m.rows, { sales: 2, tenants: 1 });
  assert.ok(!buf.includes(Buffer.from('INSERT INTO')), 'ciphertext is not plaintext');
  assert.ok(!JSON.stringify(m).includes('INSERT'), 'manifest has no SQL');
  ok('manifest sha256, rows, bookmark');
  const dec = spawnSync('bash', ['-c', `openssl enc -d -aes-256-cbc -pbkdf2 -iter ${m.iter} -pass env:P -in "$1" | gunzip`, '_', join(out, enc)],
    { encoding: 'utf8', env: { PATH: process.env.PATH, P: PASS } });
  assert.equal(dec.status, 0, dec.stderr);
  assert.match(dec.stdout, /INSERT INTO "sales"/);
  assert.equal(createHash('sha256').update(dec.stdout).digest('hex'), m.plaintext_sha256);
  ok('decrypt round-trip matches plaintext sha256');
  const bad = spawnSync('bash', ['-c', `openssl enc -d -aes-256-cbc -pbkdf2 -iter ${m.iter} -pass env:P -in "$1" | gunzip`, '_', join(out, enc)],
    { encoding: 'utf8', env: { PATH: process.env.PATH, P: 'wrong-passphrase-0123456789' } });
  assert.ok(bad.status !== 0 || !bad.stdout.includes('INSERT'), 'wrong passphrase must not decrypt');
  ok('wrong passphrase fails');
  assert.ok(!r.stdout.includes('signed.example'), 'signed URLs not echoed');
  ok('no signed URL in output');
}

// backup: export permission error -> exit 2, names permission, scrubs URL, writes nothing
{
  const out = mkdtempSync(join(dir, 'o2-'));
  const r = run('d1-backup.sh', { WRANGLER, BACKUP_OUTDIR: out, BACKUP_PASSPHRASE: PASS, MOCK_MODE: 'exportdenied' });
  assert.equal(r.status, 2); assert.match(r.stdout, /Account\.D1:Read/);
  assert.ok(!r.stdout.includes('sig=abc'));
  assert.equal(readdirSync(out).length, 0);
  ok('export permission error -> exit 2, nothing written');
}

// workflow uploads only the ciphertext + manifest; R2 not bound in wrangler.toml
{
  const wf = readFileSync(join(ROOT, '.github/workflows/d1-backup.yml'), 'utf8');
  assert.match(wf, /retention-days: 30/);
  assert.match(wf, /\*\.sql\.gz\.enc/);
  assert.ok(!/\.sql\s*$/m.test(wf), 'workflow never uploads a .sql path');
  assert.match(wf, /workflow_dispatch/); assert.match(wf, /cron:/);
  assert.ok(!/^\s*\[\[.*r2_buckets\]\]/m.test(readFileSync(join(ROOT, 'backend/wrangler.toml'), 'utf8')));
  ok('workflow: encrypted-only upload, 30 days; no R2 binding');
}
assert.ok(existsSync(join(ROOT, 'docs/ops/backup-restore.md')));
console.log(`backend-d1-backup: ${pass} passed`);
