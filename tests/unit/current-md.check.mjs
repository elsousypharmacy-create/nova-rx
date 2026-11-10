import assert from 'node:assert/strict';
import fs from 'node:fs';
// CURRENT.md is the cheap boot file every agent reads before anything else.
// It must stay short, keep its sections, point only at files that exist, and never hold secrets.
const text = fs.readFileSync('CURRENT.md', 'utf8');
const lines = text.split('\n');
assert.ok(lines.length <= 61, `CURRENT.md must stay at 60 lines or fewer (now ${lines.length}); move detail to HANDOFF.md`);
assert.match(text, /^Last updated: \d{4}-\d{2}-\d{2}/m, 'needs a "Last updated: YYYY-MM-DD" line');
for (const heading of ['Boot order', 'Priorities', 'Who is on what', 'Merged to main', 'Open PRs', 'Known breakages', 'Waiting on the owner', 'Never without specific owner approval', 'Update rule']) {
  assert.ok(text.includes('## ' + heading), `missing section: ${heading}`);
}
// Files the boot order depends on must exist on this branch.
for (const file of ['AGENTS.md', 'HANDOFF.md', 'docs/ERP_MASTER_PLAN.md', 'reports/erp-roadmap.json', 'docs/skills/nova/SKILL.md', 'docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md', '.github/workflows/deploy-worker.yml', 'tests/unit/worker-gemini-route.check.mjs']) {
  assert.ok(fs.existsSync(file), `CURRENT.md refers to ${file} but it does not exist`);
  const name = file.split('/').pop();
  assert.ok(text.includes(name), `CURRENT.md no longer mentions ${name}`);
}
// The history file stays, and tells readers to start from CURRENT.md.
const handoff = fs.readFileSync('HANDOFF.md', 'utf8');
assert.ok(handoff.split('\n').length > 600, 'HANDOFF.md is the archive and must not be truncated by this change');
assert.match(handoff.split('\n').slice(0, 8).join('\n'), /CURRENT\.md/, 'HANDOFF.md should point readers to CURRENT.md at the top');
// No secret-looking values (names are fine; public sha256 artifact hashes are allowed).
for (const pattern of [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{12,}/, /Bearer\s+[A-Za-z0-9._-]{20,}/, /(password|pin|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i]) {
  assert.ok(!pattern.test(text), `CURRENT.md must not contain secret-looking text: ${pattern}`);
}
console.log('PASS CURRENT.md: short, sectioned, references exist, HANDOFF.md kept and pointing here, no secrets');
