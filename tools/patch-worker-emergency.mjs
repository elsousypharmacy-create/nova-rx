#!/usr/bin/env node
// Adds the public static page /emergency to a NOVA Worker script (service-worker style).
// The page carries no data and no secrets (prices are loaded by staff on their own device), so no PIN.
// Usage: node tools/patch-worker-emergency.mjs BASE_WORKER.js OUT_WORKER.js   (repeatable, deterministic)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '/* NOVA_EMERGENCY_BEGIN */', END = '/* NOVA_EMERGENCY_END */';
const [baseFile, outFile] = process.argv.slice(2);
if (!baseFile || !outFile) throw new Error('Usage: node tools/patch-worker-emergency.mjs BASE OUT');

let html = fs.readFileSync(path.join(root, 'emergency-sales.html'), 'utf8');
const core = fs.readFileSync(path.join(root, 'emergency-core.js'), 'utf8');
const font = fs.readFileSync(path.join(root, 'fonts/cairo.woff')).toString('base64');
if (core.includes('</script')) throw new Error('core contains </script');
html = html.replace('<script src="emergency-core.js"></script>', () => '<script>\n' + core + '\n</script>')
           .replace('url(fonts/cairo.woff)', () => 'url(data:font/woff;base64,' + font + ')');
if (html.includes('emergency-core.js"') || html.includes('fonts/cairo.woff')) throw new Error('inlining failed');

let code = fs.readFileSync(baseFile, 'utf8');
const re = new RegExp(BEGIN.replace(/[*/]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[*/]/g, '\\$&') + '\\n?');
code = code.replace(re, '');
const ROUTE = "if(url.pathname==='/emergency'||url.pathname==='/emergency/'){event.respondWith(NOVA_EMERGENCY_PAGE());return;}";
code = code.split(ROUTE).join('');
const LISTENER = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
if (code.split(LISTENER).length !== 2) throw new Error('fetch listener not found exactly once');
code = code.replace(LISTENER, () => LISTENER + ROUTE);
const block = `${BEGIN}\nconst NOVA_EMERGENCY_HTML = ${JSON.stringify(html)};\nfunction NOVA_EMERGENCY_PAGE() {\n  return new Response(NOVA_EMERGENCY_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });\n}\n${END}\n`;
fs.writeFileSync(outFile, block + code);
console.log('wrote', outFile);
