#!/usr/bin/env node
// Replace ONLY the app HTML string literal inside a Worker export. Routes and bindings are not touched.
// Usage: node tools/build-worker-artifact.mjs BASE_WORKER.js NEW_APP.html OUT_WORKER.js
//        node tools/build-worker-artifact.mjs --extract WORKER.js OUT_APP.html
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

const [a, b, c] = process.argv.slice(2);
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
  const out = lines.join('\n');
  fs.writeFileSync(c, out);
  console.log('wrote', c, Buffer.byteLength(out), 'bytes, sha256', crypto.createHash('sha256').update(out).digest('hex'));
}
