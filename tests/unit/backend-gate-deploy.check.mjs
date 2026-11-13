// Auto gate deploys: scheduler dispatch/reconcile + gate_result (python, no network) and
// static guards on the deploy workflow (GATE-17 refused, backup before deploy, rollback paths).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const ROOT = resolve(import.meta.dirname, '../..');
const r = spawnSync('python3', [join(ROOT, 'tests/unit/scheduler_gates_test.py')], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
assert.equal(r.status, 0, r.stdout + r.stderr);
console.log(r.stdout.trim());
const wf = readFileSync(join(ROOT, '.github/workflows/deploy-backend-staging.yml'), 'utf8');
assert.match(wf, /GATE-14\|GATE-15\|GATE-16\) ;;/);
assert.match(wf, /GATE-17 is owner-only/);
assert.ok(wf.indexOf('d1-backup.sh') < wf.indexOf('deploy_backend_staging.sh'), 'backup runs before deploy');
assert.ok(!/nova-rx-preview/.test(wf.replace(/Never touches nova-rx-preview/, '')), 'workflow never targets the frontend');
const sh = readFileSync(join(ROOT, '.github/scripts/deploy_backend_staging.sh'), 'utf8');
assert.match(sh, /wrangler@4 rollback "\$PREV_VERSION"/);
assert.match(sh, /time_travel\/restore\?bookmark=/);
assert.match(sh, /if \[ "\$MIGRATED" != 1 \]; then say "no migrations applied in this run/);
assert.match(sh, /SCRIPT_NAME="nova-rx-api-staging"/);
console.log('backend-gate-deploy: ok');
