#!/usr/bin/env node
// SALE-02: add a same-origin static-asset route to a nova-rx-preview Worker export.
// The app HTML loads these files by relative/absolute URL; before this route they returned 404 on the Worker.
// Inserts one NOVA_STATIC_ASSETS table (GET/HEAD only) just before the fetch listener; nothing else changes.
// Usage: node tools/build-static-assets-artifact.mjs BASE_WORKER.js OUT_WORKER.js
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// URL path -> repo file. Conversations files (integrations/whatsapp/*, whatsapp-inbox.html) are NOT here on purpose.
export const STATIC_ASSETS = [
  ['/auth-local.js', 'auth-local.js'],
  ['/auth-permissions.js', 'auth-permissions.js'],
  ['/auth-ui.js', 'auth-ui.js'],
  ['/credit-ledger.js', 'credit-ledger.js'],
  ['/bi-dictionary.js', 'bi-dictionary.js'],
  ['/supplier-lookup.js', 'supplier-lookup.js'],
  ['/supplier-lookup.css', 'supplier-lookup.css'],
  ['/worker/procurement/ui-model.js', 'worker/procurement/ui-model.js'],
  ['/icon.svg', 'icon.svg'],
  ['/nova-icons.js', 'nova-icons.js'],
  ['/nova-icons.css', 'nova-icons.css'],
  ['/ux-tokens.css', 'ux-tokens.css'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/sw.js', 'sw.js'],
];

const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function buildTable(root = '.') {
  const table = {};
  for (const [url, file] of STATIC_ASSETS) {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!TYPES[ext]) throw new Error('no content type for ' + file);
    table[url] = { body: fs.readFileSync(root + '/' + file, 'utf8'), type: TYPES[ext] };
  }
  return table;
}

const ROUTE = "if(NOVA_STATIC_ASSETS[url.pathname]&&(event.request.method==='GET'||event.request.method==='HEAD')){const a=NOVA_STATIC_ASSETS[url.pathname];const h={'Content-Type':a.type+'; charset=utf-8','Cache-Control':url.pathname==='/sw.js'?'no-cache':'no-store','X-Content-Type-Options':'nosniff'};if(url.pathname==='/sw.js')h['Service-Worker-Allowed']='/';event.respondWith(new Response(event.request.method==='HEAD'?null:a.body,{headers:h}));return;}";
const ANCHOR = "addEventListener('fetch', event => { const url=new URL(event.request.url);";

export function inject(code, table) {
  if (code.includes('/* NOVA_STATIC_ASSETS_BEGIN */')) throw new Error('static assets already present; refusing');
  const lines = code.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(ANCHOR));
  if (idx < 0 || lines.findIndex((l, i) => i > idx && l.startsWith(ANCHOR)) >= 0) throw new Error('fetch listener anchor not found exactly once');
  lines[idx] = ANCHOR + ROUTE + lines[idx].slice(ANCHOR.length);
  lines.splice(idx, 0, '/* NOVA_STATIC_ASSETS_BEGIN */', 'const NOVA_STATIC_ASSETS=' + JSON.stringify(table) + ';', '/* NOVA_STATIC_ASSETS_END */');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [base, out] = process.argv.slice(2);
  if (!base || !out) { console.error('usage: build-static-assets-artifact.mjs BASE_WORKER.js OUT_WORKER.js'); process.exit(2); }
  const code = inject(fs.readFileSync(base, 'utf8'), buildTable('.'));
  fs.writeFileSync(out, code);
  console.log('wrote', out, Buffer.byteLength(code), 'bytes, sha256', crypto.createHash('sha256').update(code).digest('hex'));
}
