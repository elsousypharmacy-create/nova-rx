#!/usr/bin/env node
// UX409: add /manifest.webmanifest, /manifest-whatsapp.webmanifest and NOVA WhatsApp PNG icons
// to a nova-rx-preview Worker export. Does not change NOVA_STATIC_ASSETS (whatsapp paths are
// excluded from that table on purpose). Idempotent: replaces an existing PWA block.
// Usage: node tools/inject-pwa-assets.mjs WORKER.js  (in-place)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PWA_ASSETS = [
  ['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json', 'utf8'],
  ['/manifest-whatsapp.webmanifest', 'manifest-whatsapp.webmanifest', 'application/manifest+json', 'utf8'],
  ['/icons/nova-whatsapp-180.png', 'icons/nova-whatsapp-180.png', 'image/png', 'base64'],
  ['/icons/nova-whatsapp-192.png', 'icons/nova-whatsapp-192.png', 'image/png', 'base64'],
  ['/icons/nova-whatsapp-512.png', 'icons/nova-whatsapp-512.png', 'image/png', 'base64'],
];

const BEGIN = '/* NOVA_PWA_ASSETS_BEGIN */';
const END = '/* NOVA_PWA_ASSETS_END */';
const ANCHOR = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
const ROUTE = "if(NOVA_PWA_ASSETS[url.pathname]&&(event.request.method==='GET'||event.request.method==='HEAD')){const a=NOVA_PWA_ASSETS[url.pathname];const body=a.encoding==='base64'?Uint8Array.from(atob(a.body),function(c){return c.charCodeAt(0)}):a.body;const h={'Content-Type':a.type+(a.encoding==='base64'?'':'; charset=utf-8'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};event.respondWith(new Response(event.request.method==='HEAD'?null:body,{headers:h}));return;}";

export function buildTable(root = '.') {
  const table = {};
  for (const [url, file, type, enc] of PWA_ASSETS) {
    const buf = fs.readFileSync(path.join(root, file));
    table[url] = enc === 'base64'
      ? { body: buf.toString('base64'), type, encoding: 'base64' }
      : { body: buf.toString('utf8'), type };
  }
  return table;
}

export function inject(code, table) {
  // drop a previous block + route
  if (code.includes(BEGIN)) {
    const a = code.indexOf(BEGIN);
    const b = code.indexOf(END);
    if (a < 0 || b < 0) throw new Error('broken PWA markers');
    code = code.slice(0, a) + code.slice(b + END.length).replace(/^\n/, '');
  }
  code = code.replace(ROUTE, '');
  const lines = code.split('\n');
  const idx = lines.findIndex((l) => l.includes(ANCHOR));
  if (idx < 0) throw new Error('fetch listener anchor not found');
  const line = lines[idx];
  const at = line.indexOf(ANCHOR);
  if (at < 0 || line.indexOf(ANCHOR, at + 1) >= 0) throw new Error('fetch listener anchor not unique on its line');
  lines[idx] = line.slice(0, at) + ANCHOR + ROUTE + line.slice(at + ANCHOR.length);
  lines.splice(idx, 0, BEGIN, 'const NOVA_PWA_ASSETS=' + JSON.stringify(table) + ';', END);
  return lines.join('\n');
}

export function stripPwa(code) {
  if (code.includes(BEGIN)) {
    const a = code.indexOf(BEGIN);
    const b = code.indexOf(END);
    if (a < 0 || b < 0) throw new Error('broken PWA markers');
    code = code.slice(0, a) + code.slice(b + END.length).replace(/^\n/, '');
  }
  return code.replace(ROUTE, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: inject-pwa-assets.mjs WORKER.js'); process.exit(2); }
  const out = inject(fs.readFileSync(file, 'utf8'), buildTable('.'));
  fs.writeFileSync(file, out);
  console.log('injected PWA assets into', file, Buffer.byteLength(out), 'bytes');
}
