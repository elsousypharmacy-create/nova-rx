// QA loop 231 repro: runs the UX238 keyboard/a11y test and saves screenshots to .nova/qa/qa-loop-231/
import { spawnSync } from 'node:child_process';
const r = spawnSync('node', ['tests/ux/ux238-wa-keyboard.mjs'], { stdio: 'inherit', env: { ...process.env, SHOTS: '.nova/qa/qa-loop-231' } });
process.exit(r.status ?? 1);
