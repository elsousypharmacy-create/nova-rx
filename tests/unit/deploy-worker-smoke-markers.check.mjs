// Smoke markers in deploy_worker.sh must match UX400 (PIN-free preview UI).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sh = readFileSync(join(root, '.github/scripts/deploy_worker.sh'), 'utf8');
const m = sh.match(/for m in ([^\n;]+); do/);
if (!m) throw new Error('smoke marker loop not found in deploy_worker.sh');
const markers = m[1].trim().split(/\s+/);
if (markers.includes('waHistPin') || markers.includes('X-Nova-Pin')) {
  throw new Error('deploy_worker.sh smoke still requires the old PIN marker: ' + m[1]);
}
if (!markers.includes('data-wa-inbox-open')) {
  throw new Error('deploy_worker.sh smoke must require data-wa-inbox-open: ' + m[1]);
}
for (const keep of ['novaWaBtn', 'hLoad', 'inbox/history', 'NOVA_FIX50', 'NOVA_FIX50_VV', 'hPoll', 'winClosed']) {
  if (!markers.includes(keep)) throw new Error('missing kept marker ' + keep);
}
console.log('ok deploy_worker.sh smoke markers', markers.join(' '));
