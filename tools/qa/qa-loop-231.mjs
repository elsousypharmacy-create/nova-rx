// QA loop 231 repro: runs UX235 (locked state), UX237 (dates) and UX238 (keyboard/a11y) tests, screenshots to .nova/qa/qa-loop-231/
// Needs server on :8765 and @playwright/test
import { spawnSync } from 'node:child_process';
let code = 0;
for (const t of ['tests/ux/ux235-locked-empty.mjs', 'tests/ux/ux237-wa-dates.mjs', 'tests/ux/ux238-wa-keyboard.mjs']) {
  const r = spawnSync('node', [t], { stdio: 'inherit', env: { ...process.env, SHOTS: process.env.SHOTS || '.nova/qa/qa-loop-231' } });
  code = code || (r.status ?? 1);
}
process.exit(code);
