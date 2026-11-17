// S1-10: the restore drill passes (sale + stock + staff survive export -> import into a NEW database). No network.
// Run: node tests/unit/restore-drill-sales.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDrill } from '../../tools/backend/restore-drill-sales.mjs';

const r = await runDrill();
for (const c of r.checks) assert.ok(c.ok, 'drill check failed: ' + c.name);
assert.ok(r.checks.length >= 14, 'all drill checks ran');
const doc = readFileSync(new URL('../../docs/ops/backup-restore.md', import.meta.url), 'utf8');
assert.ok(/S1-10/.test(doc) && /throwaway|جديدة|NEW/i.test(doc), 'runbook has the S1-10 live drill checklist');
assert.ok(/never in-place|ممنوع/i.test(doc), 'runbook forbids in-place restore');
console.log('restore-drill-sales OK (' + r.checks.length + ' checks)');
