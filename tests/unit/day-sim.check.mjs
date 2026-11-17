// Runs the seeded pharmacy-day simulation (tests/sim/pharmacy-day.sim.mjs) for a few seeds / device counts: offline periods, dropped requests,
// lost responses, sales, returns, credit, receipts, shift closes -> after settling every device and the server must agree.
// Run: node tests/unit/day-sim.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sim = fileURLToPath(new URL('../sim/pharmacy-day.sim.mjs', import.meta.url));
for (const [seed, steps, devices] of [[1, 250, 3], [23, 300, 3], [7, 250, 2], [11, 250, 4]]) {
  let out = '';
  try { out = execFileSync(process.execPath, [sim, String(seed), String(steps), String(devices)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.ok(/SIM OK/.test(out), `simulation seed=${seed} devices=${devices} failed:\n` + out.split('\n').filter((l) => /^ - |STEP ERROR/.test(l)).slice(0, 5).join('\n'));
}
console.log('day-sim OK');
