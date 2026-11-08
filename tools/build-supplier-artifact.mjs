#!/usr/bin/env node
// One command that turns a live Worker artifact into a new artifact with the supplier lookup:
//   1. extract the app HTML from BASE
//   2. inject the supplier UI (css + js packed into the page)
//   3. add the /api/suppliers/* routes to the Worker script
//   4. put the new HTML back into the Worker (routes and bindings untouched)
// Usage: node tools/build-supplier-artifact.mjs BASE_WORKER.js OUT_WORKER.js
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const [base, out] = process.argv.slice(2);
if (!base || !out) throw new Error('Usage: node tools/build-supplier-artifact.mjs BASE_WORKER.js OUT_WORKER.js');
const tool = (name, ...args) => execFileSync('node', [path.join('tools', name), ...args], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const dir = mkdtempSync(path.join(tmpdir(), 'nova-build-'));
const html = path.join(dir, 'app.html');
const htmlWithUi = path.join(dir, 'app-ui.html');
const patched = path.join(dir, 'patched.js');

console.log(tool('build-worker-artifact.mjs', '--extract', base, html));
console.log(tool('inject-supplier-ui.mjs', html, htmlWithUi));
console.log(tool('patch-worker-suppliers.mjs', base, patched));
console.log(tool('build-worker-artifact.mjs', patched, htmlWithUi, out));
const sha = createHash('sha256').update(fs.readFileSync(out)).digest('hex');
console.log(`built ${out}\nsha256 ${sha}`);
