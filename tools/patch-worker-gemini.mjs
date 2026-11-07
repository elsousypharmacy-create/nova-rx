#!/usr/bin/env node
// Replace the embedded Gemini service (between /* KIMI_GEMINI_SERVICE_V1 */ and the end of __testing) with
// worker/gemini-label-service.js (export keywords removed) and add the batch route. The app HTML is NOT touched.
// Usage: node tools/patch-worker-gemini.mjs IN_WORKER.js OUT_WORKER.js
import fs from 'node:fs';
import crypto from 'node:crypto';

const [inp, out] = process.argv.slice(2);
const lines = fs.readFileSync(inp, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('KIMI_GEMINI_SERVICE_V1'));
if (start < 0) throw new Error('embedded Gemini service marker not found');
let end = -1;
for (let i = start; i < lines.length; i++) {
  if (lines[i].startsWith('};') && lines.slice(Math.max(start, i - 6), i).some(l => l.includes('resetModelCache'))) { end = i; break; }
}
if (end < 0) throw new Error('end of embedded Gemini service not found');
const source = fs.readFileSync(new URL('../worker/gemini-label-service.js', import.meta.url), 'utf8').replace(/^export /gm, '').trimEnd();
const rebuilt = [...lines.slice(0, start + 1), source, ...lines.slice(end + 1)];

const route = "if(url.pathname==='/api/ai/medication-label'){event.respondWith(handleMedicationLabelRequest(event.request,{GEMINI_API_KEY:typeof GEMINI_API_KEY!=='undefined'?GEMINI_API_KEY:''}));return;}";
const batchRoute = "if(url.pathname==='/api/ai/medication-labels'){event.respondWith(handleMedicationLabelsRequest(event.request,{GEMINI_API_KEY:typeof GEMINI_API_KEY!=='undefined'?GEMINI_API_KEY:''}));return;}";
let patched = 0;
for (let i = 0; i < rebuilt.length; i++) {
  if (rebuilt[i].includes(route) && !rebuilt[i].includes(batchRoute)) { rebuilt[i] = rebuilt[i].replace(route, route + ' ' + batchRoute); patched++; }
}
if (!patched && !rebuilt.some(l => l.includes(batchRoute))) throw new Error('dispatcher route not found');
const code = rebuilt.join('\n');
fs.writeFileSync(out, code);
console.log('wrote', out, Buffer.byteLength(code), 'bytes, sha256', crypto.createHash('sha256').update(code).digest('hex'));
