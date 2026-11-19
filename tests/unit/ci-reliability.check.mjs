import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const RETRY_SH = path.join(ROOT, '.github/scripts/retry.sh');
const ACTION_YML = path.join(ROOT, '.github/actions/setup-playwright/action.yml');
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows');

// 1. retry.sh syntax and behavior
assert(fs.existsSync(RETRY_SH), 'retry.sh must exist');
execFileSync('bash', ['-n', RETRY_SH], { stdio: 'inherit' });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-retry-test-'));
try {
  // 1a. Succeeds immediately on exit 0
  const ok = spawnSync('bash', [RETRY_SH, '3', '0', '--', 'true'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, 'retry.sh must exit 0 when command succeeds on first try');

  // 1b. Retries transient failures and succeeds on attempt 3
  const counterFile = path.join(tmpDir, 'count.txt');
  const flakyScript = path.join(tmpDir, 'flaky.sh');
  fs.writeFileSync(
    flakyScript,
    `#!/usr/bin/env bash
set -euo pipefail
n=0
[ -f "${counterFile}" ] && n="$(cat "${counterFile}")"
n=$((n + 1))
echo "$n" > "${counterFile}"
[ "$n" -ge 3 ] || exit 17
echo "recovered-on-$n"
`,
    { mode: 0o755 }
  );
  const recovered = spawnSync('bash', [RETRY_SH, '3', '0', '--', 'bash', flakyScript], { encoding: 'utf8' });
  assert.equal(recovered.status, 0, `expected recovery on attempt 3, got ${recovered.status}: ${recovered.stderr}`);
  assert(recovered.stdout.includes('recovered-on-3'), 'expected recovered-on-3 in stdout');
  assert.equal(fs.readFileSync(counterFile, 'utf8').trim(), '3', 'should have attempted exactly 3 times');

  // 1c. Preserves non-zero exit code when all attempts fail
  const failed = spawnSync('bash', [RETRY_SH, '2', '0', '--', 'bash', '-c', 'exit 42'], { encoding: 'utf8' });
  assert.equal(failed.status, 42, `expected exit code 42 after exhausting retries, got ${failed.status}`);

  // 1d. Rejects malformed arguments
  const badArgs = spawnSync('bash', [RETRY_SH, '0', '0', '--', 'true'], { encoding: 'utf8' });
  assert.equal(badArgs.status, 2, 'max_attempts=0 must be rejected with exit 2');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// 2. setup-playwright composite action checks
assert(fs.existsSync(ACTION_YML), 'setup-playwright composite action must exist');
const actionText = fs.readFileSync(ACTION_YML, 'utf8');
assert(actionText.includes('actions/cache@v4'), 'setup-playwright must cache with actions/cache@v4');
assert(actionText.includes('~/.cache/ms-playwright'), 'setup-playwright must cache ~/.cache/ms-playwright');
assert(actionText.includes('~/.npm'), 'setup-playwright must cache ~/.npm');
assert(actionText.includes('retry.sh'), 'setup-playwright must wrap network installs with retry.sh');
assert(actionText.includes('playwright install chromium'), 'setup-playwright must install chromium without --with-deps');
assert(!actionText.includes('install --with-deps'), 'setup-playwright must not unconditionally pass --with-deps');
assert(actionText.includes('Acquire::Retries'), 'setup-playwright apt fallback must configure Acquire::Retries');

// 3. Workflow invariants across .github/workflows/*.yml
const workflowFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
assert(workflowFiles.length > 0, 'expected workflow files');

for (const file of workflowFiles) {
  const full = path.join(WORKFLOWS_DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  assert(!/playwright[^\n]*--with-deps/.test(text), `${file} must not call playwright --with-deps directly (use ./.github/actions/setup-playwright)`);
  if (/python3\s+-m\s+http\.server/.test(text)) {
    assert(text.includes('curl -fsS http://127.0.0.1:'), `${file} starts python3 -m http.server without a curl readiness loop`);
  }
}

// 4. Parse all modified YAML files with PyYAML when available
const pyCheck = spawnSync(
  'python3',
  [
    '-c',
    `
import glob, sys
try:
    import yaml
except ImportError:
    sys.exit(0)
files = sorted(glob.glob('.github/workflows/*.yml') + ['.github/actions/setup-playwright/action.yml'])
for p in files:
    with open(p, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    assert isinstance(data, dict), f'{p}: top-level YAML must be a mapping'
print(f'YAML valid ({len(files)} files)')
`,
  ],
  { cwd: ROOT, encoding: 'utf8' }
);
assert.equal(pyCheck.status, 0, `YAML validation failed: ${pyCheck.stderr}`);

console.log(`PASS ci-reliability (${workflowFiles.length} workflows checked, retry.sh + setup-playwright verified)`);
