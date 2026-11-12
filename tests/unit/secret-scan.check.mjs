// Unit check for scripts/secret-scan.mjs. Fake secrets are assembled at runtime so this file holds none.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scanText, isAllowedPath, RULES } from '../../scripts/secret-scan.mjs';

const rep = (c, n) => c.repeat(n);
const cases = {
  'private-key-block': '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'github-token': 'x = "ghp_' + rep('a1', 20) + '"',
  'aws-access-key-id': 'id ' + 'AKIA' + rep('Q', 16),
  'google-api-key': 'k=' + 'AIza' + rep('b', 35),
  'anthropic-or-openai-key': 'sk-' + 'ant-' + rep('z', 40),
  'slack-token': 'xox' + 'b-' + rep('1', 12) + '-abc',
  'slack-webhook-url': 'https://hooks.slack.com/' + 'services/T' + rep('0', 8) + '/B' + rep('1', 8) + '/' + rep('x', 24),
  'discord-webhook-url': 'https://discord.com/api/' + 'webhooks/' + rep('1', 18) + '/' + rep('w', 30),
  'telegram-bot-token': rep('1', 9) + ':AA' + rep('c', 33),
  'jwt': 'eyJ' + rep('a', 12) + '.eyJ' + rep('b', 12) + '.' + rep('c', 12),
  'url-with-password': 'postgres://user:' + 'pa55word99@host/db',
  'hardcoded-secret-assignment': 'const apiKey = "' + rep('Ab1', 10) + '";',
};
for (const [rule] of RULES) {
  assert.ok(cases[rule], 'test missing for rule ' + rule);
  assert.ok(scanText(cases[rule]).some((h) => h.rule === rule), 'rule must fire: ' + rule);
}
// clean text, env-var references and short values do not fire
for (const ok of ['const k = process.env.API_KEY;', 'token: "abc"', 'https://example.com/a@b', 'سعر الدواء 25 ج.م', 'password = ""']) {
  assert.deepEqual(scanText(ok), [], ok);
}
// allow marker and reported line numbers
assert.deepEqual(scanText('a\n' + cases['github-token'] + ' // secret-scan:allow'), []);
assert.equal(scanText('a\nb\n' + cases['github-token'])[0].line, 3);
assert.ok(isAllowedPath('tests/fixtures/x.json') && !isAllowedPath('worker/x.js'));

// End to end: a temp repo with a leak fails, output never contains the value, a clean one passes.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = resolve('scripts/secret-scan.mjs');
const dir = mkdtempSync(join(tmpdir(), 'ss-'));
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
git('init', '-q');
writeFileSync(join(dir, 'ok.txt'), 'hello\n');
git('add', '.');
let r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr);
const value = cases['github-token'];
writeFileSync(join(dir, 'leak.js'), value + '\n');
git('add', '.');
r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
assert.equal(r.status, 1);
assert.ok(r.stderr.includes('leak.js:1 github-token'));
assert.ok(!(r.stdout + r.stderr).includes(rep('a1', 20)), 'secret value must never be printed');
console.log('secret-scan.check: PASS');
