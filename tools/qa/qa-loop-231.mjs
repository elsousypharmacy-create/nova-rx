// QA loop 231 repro: runs the UX237 (dates) and UX238 (keyboard/a11y) tests, screenshots to .nova/qa/qa-loop-231/
import { spawnSync } from 'node:child_process';
let code = 0;
for (const t of ['tests/ux/ux237-wa-dates.mjs', 'tests/ux/ux238-wa-keyboard.mjs']) {
  const r = spawnSync('node', [t], { stdio: 'inherit', env: { ...process.env, SHOTS: '.nova/qa/qa-loop-231' } });
  code = code || (r.status ?? 1);
}
process.exit(code);
