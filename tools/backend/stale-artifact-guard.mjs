// Refuses a deploy whose version is older than the recorded live one.
// Usage: node tools/backend/stale-artifact-guard.mjs <candidateVersion> [releases.json]
// Record format: { "live": { "version": "x.y.z", "sha": "..." }, "history": [...] }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../backend/src/version.js';

export function checkDeploy(candidate, record) {
  const live = record && record.live && record.live.version;
  if (!live) return { ok: true, reason: 'no live release recorded' };
  const c = compareVersions(candidate, live);
  if (c < 0) return { ok: false, reason: `stale artifact: ${candidate} is older than live ${live}` };
  return { ok: true, reason: c === 0 ? 'same version (redeploy)' : 'newer than live' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [candidate, file = 'docs/backend/releases.json'] = process.argv.slice(2);
  if (!candidate) { console.error('usage: stale-artifact-guard <version> [releases.json]'); process.exit(2); }
  let record = {};
  try { record = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no record */ }
  const r = checkDeploy(candidate, record);
  console.log(r.ok ? 'OK: ' + r.reason : 'REFUSED: ' + r.reason);
  process.exit(r.ok ? 0 : 1);
}
