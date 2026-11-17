// S1-12: the private-repo checklist exists with the owner steps, and the backup workflow still uploads only ciphertext.
// Run: node tests/unit/s1-12-private-checklist.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const doc = r('docs/ops/S1-12_REPO_PRIVATE_CHECKLIST.md');
for (const m of ['gh repo edit elsousypharmacy-create/nova-rx --visibility private', 'Billing', 'secret-scan', '.sql.gz.enc', 'Change visibility']) assert.ok(doc.includes(m), 'checklist mentions ' + m);
const wf = r('.github/workflows/d1-backup.yml');
assert.match(wf, /\*\.sql\.gz\.enc/); assert.ok(!/\.sql\s*$/m.test(wf), 'never uploads plaintext SQL');
assert.match(r('scripts/d1-backup.sh'), /openssl enc -aes-256-cbc -pbkdf2/);
console.log('s1-12-private-checklist OK');
