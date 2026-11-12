#!/usr/bin/env node
// Adds the same-origin price-list route GET /emergency/stock.json to a MODULE-style NOVA Worker artifact.
// Prices only (public retail price list from data/emergency-stock.json); no stock, no secrets, no PIN.
// Usage: node tools/patch-worker-stock-route.mjs BASE.js OUT.js   (deterministic, idempotent)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '/* NOVA_STOCK_ROUTE_BEGIN */', END = '/* NOVA_STOCK_ROUTE_END */';
const [baseFile, outFile] = process.argv.slice(2);
if (!baseFile || !outFile) throw new Error('Usage: node tools/patch-worker-stock-route.mjs BASE OUT');
let code = fs.readFileSync(baseFile, 'utf8');
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
code = code.replace(new RegExp(esc(BEGIN) + '[\\s\\S]*?' + esc(END) + '\\n?'), '');
const ROUTE = "if(url.pathname==='/emergency/stock.json'&&(event.request.method==='GET'||event.request.method==='HEAD')){event.respondWith(new Response(event.request.method==='HEAD'?null:NOVA_STOCK_JSON,{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff'}}));return;}";
code = code.split(ROUTE).join('');
const LISTENER = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
if (code.split(LISTENER).length !== 2) throw new Error('fetch listener not found exactly once');
code = code.replace(LISTENER, () => LISTENER + ROUTE);
const stock = fs.readFileSync(path.join(root, 'data/emergency-stock.json'), 'utf8');
const j = JSON.parse(stock);
if (!Array.isArray(j.items) || j.items.length < 50) throw new Error('stock file too small');
const block = `${BEGIN}\nconst NOVA_STOCK_JSON = ${JSON.stringify(stock)};\n${END}\n`;
const MARK = 'export default {fetch(request,env,ctx){';
if (code.split(MARK).length !== 2) throw new Error('export default not found exactly once');
code = code.replace(MARK, () => block + MARK);
fs.writeFileSync(outFile, code);
console.log('wrote', outFile, Buffer.byteLength(code), 'bytes, sha256', crypto.createHash('sha256').update(code).digest('hex'));
