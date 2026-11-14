// QA loop 231 repro: run the UX237 test with screenshots.
// SHOTS=.nova/qa/qa-loop-231 node tests/ux/ux237-wa-dates.mjs
import { spawnSync } from 'node:child_process';
process.exit(spawnSync('node', ['tests/ux/ux237-wa-dates.mjs'], { stdio: 'inherit', env: { ...process.env, SHOTS: '.nova/qa/qa-loop-231' } }).status ?? 1);
