#!/usr/bin/env node
// Replace ONLY the app HTML string literal inside a Worker export. Routes and bindings are not touched.
// Usage: node tools/build-worker-artifact.mjs BASE_WORKER.js NEW_APP.html OUT_WORKER.js
//        node tools/build-worker-artifact.mjs --extract WORKER.js OUT_APP.html
// UX406: optional trailing `--sw sw.js` also replaces the embedded "/sw.js" asset body (Service Worker) and nothing else.
import fs from 'node:fs';
import crypto from 'node:crypto';

function locate(code) {
  const lines = code.split('\n');
  const idx = lines.findIndex(l => l.includes('new Response("<!DOCTYPE html>'));
  if (idx < 0) throw new Error('app HTML literal not found');
  const line = lines[idx];
  const start = line.indexOf('"<!DOCTYPE html>');
  let i = start + 1;
  while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === '"') break; i++; }
  return { lines, idx, line, start, end: i + 1 };
}

function replaceSw(code, swSrc) {
  const k = '"/sw.js":{"body":';
  const i = code.indexOf(k);
  if (i < 0 || code.indexOf(k, i + 1) >= 0) throw new Error('exactly one /sw.js asset expected');
  const j = i + k.length;
  if (code[j] !== '"') throw new Error('/sw.js body is not a string literal');
  let e = j + 1;
  while (e < code.length) { if (code[e] === '\\') { e += 2; continue; } if (code[e] === '"') break; e++; }
  const old = JSON.parse(code.slice(j, e + 1));
  if (typeof old !== 'string') throw new Error('bad /sw.js body');
  return code.slice(0, j) + JSON.stringify(swSrc) + code.slice(e + 1);
}

const argv = process.argv.slice(2);
const swAt = argv.indexOf('--sw');
const swPath = swAt >= 0 ? argv.splice(swAt, 2)[1] : null;
const [a, b, c] = argv;
if (a === '--extract') {
  const code = fs.readFileSync(b, 'utf8');
  const { line, start, end } = locate(code);
  const lit = line.slice(start, end);
  const html = (0, eval)(lit);
  if (JSON.stringify(html) !== lit) throw new Error('literal does not round-trip; refusing');
  fs.writeFileSync(c, html);
  console.log('extracted', html.length, 'chars');
} else {
  const code = fs.readFileSync(a, 'utf8');
  const html = fs.readFileSync(b, 'utf8');
  const { lines, idx, line, start, end } = locate(code);
  lines[idx] = line.slice(0, start) + JSON.stringify(html) + line.slice(end);
  let out = lines.join('\n');
  if (swPath) out = replaceSw(out, fs.readFileSync(swPath, 'utf8'));
  fs.writeFileSync(c, out);
  console.log('wrote', c, Buffer.byteLength(out), 'bytes, sha256', crypto.createHash('sha256').update(out).digest('hex'));
}
