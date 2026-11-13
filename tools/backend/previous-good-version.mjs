// Prints the version/sha to roll back to: the newest history entry that differs from live, is not older-than-nothing,
// and is not flagged bad. Usage: node tools/backend/previous-good-version.mjs [releases.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../backend/src/version.js';
import { checkDeploy } from './stale-artifact-guard.mjs';

const isBad = (h) => h.status === 'failed' || h.status === 'rolled_back' || h.bad === true;

// history is oldest->newest. Returns an entry or null. The result is always deployable per the stale-artifact guard
// semantics only when rolling back deliberately (rollback targets are older by design), so the guard is bypassed via --rollback.
export function computePreviousGood(record) {
  const live = record && record.live;
  if (!live || !live.sha) return null;
  const hist = Array.isArray(record.history) ? record.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h.sha === live.sha || isBad(h) || !h.version || !h.sha) continue;
    if (compareVersions(h.version, live.version) > 0) continue;
    if (live.env && h.env && h.env !== live.env) continue;
    return h;
  }
  return null;
}

export { checkDeploy };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'docs/backend/releases.json';
  let record = {};
  try { record = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none */ }
  const p = computePreviousGood(record);
  if (!p) { console.error('NONE: no previous good version recorded'); process.exit(1); }
  console.log(`${p.version} ${p.sha}`);
}
