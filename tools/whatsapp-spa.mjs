#!/usr/bin/env node
// UX412: /whatsapp is a dedicated WhatsApp-only SPA path.
// - patchWhatsAppHtml rewrites the POS index <head> so iOS reads NOVA WhatsApp
//   name, icon and manifest from the raw HTML (no JS injection needed).
// - injectWorkerRoute adds the /whatsapp Worker route and wraps the app HTML.
// Usage:
//   node tools/whatsapp-spa.mjs --write-index          # writes whatsapp/index.html
//   node tools/whatsapp-spa.mjs --inject WORKER.js     # in-place Worker route
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WA_PATHS = ['/whatsapp', '/whatsapp/', '/wa', '/wa/'];

export function isWhatsAppPath(pathname) {
  const p = String(pathname || '');
  return p === '/whatsapp' || p === '/whatsapp/' || p === '/wa' || p === '/wa/';
}

export const WA_HEAD_REPS = [
  ['<html lang="en" dir="ltr">', '<html lang="en" dir="ltr" class="app-whatsapp">'],
  ['<title>NOVA Rx | صيدلية السوسي</title>', '<title>NOVA WhatsApp</title>'],
  ['<meta name="application-name" content="NOVA Rx">', '<meta name="application-name" content="NOVA WhatsApp">'],
  ['<meta name="apple-mobile-web-app-title" content="NOVA Rx">', '<meta name="apple-mobile-web-app-title" content="NOVA WhatsApp">'],
  ['<link rel="manifest" href="/manifest.webmanifest?v=3">', '<link rel="manifest" href="/manifest-whatsapp.webmanifest?v=2">'],
  ['<link rel="icon" href="/icon.svg?v=3" type="image/svg+xml">', '<link rel="icon" href="/icons/nova-whatsapp-192.png" type="image/png">'],
  ['<link rel="apple-touch-icon" href="/icon.svg">', '<link rel="apple-touch-icon" href="/icons/nova-whatsapp-180.png">'],
];

export function patchWhatsAppHtml(html) {
  let out = String(html);
  for (const [a, b] of WA_HEAD_REPS) {
    if (out.includes(a)) out = out.replace(a, b);
  }
  return out;
}

export function novaWhatsAppSpaHtml(pathname, html) {
  if (!isWhatsAppPath(pathname)) return html;
  return patchWhatsAppHtml(html);
}

export const WA_SPA_BEGIN = '/* NOVA_WA_SPA_BEGIN */';
export const WA_SPA_END = '/* NOVA_WA_SPA_END */';

const OLD_GATE = "if(url.pathname!=='/'&&url.pathname!=='/index.html'){event.respondWith(new Response('Not found',{status:404}));return;} event.respondWith(new Response(";
const NEW_GATE = "if(!(url.pathname==='/'||url.pathname==='/index.html'||url.pathname==='/whatsapp'||url.pathname==='/whatsapp/'||url.pathname==='/wa'||url.pathname==='/wa/')){event.respondWith(new Response('Not found',{status:404}));return;} event.respondWith(new Response(novaWhatsAppSpaHtml(url.pathname,";
const OLD_CLOSE = "\",{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','x-nova-build'";
const NEW_CLOSE = "\"),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','x-nova-build'";

export const WA_SPA_FN = [
  novaWhatsAppSpaHtml.toString(),
  isWhatsAppPath.toString(),
  patchWhatsAppHtml.toString(),
  'const WA_HEAD_REPS=' + JSON.stringify(WA_HEAD_REPS) + ';',
].join('\n');

function fnSource() {
  return WA_SPA_FN;
}

export function stripWaSpa(code) {
  let out = code;
  if (out.includes(WA_SPA_BEGIN)) {
    const a = out.indexOf(WA_SPA_BEGIN);
    const b = out.indexOf(WA_SPA_END);
    if (a < 0 || b < 0) throw new Error('broken WA SPA markers');
    out = out.slice(0, a) + out.slice(b + WA_SPA_END.length).replace(/^\n/, '');
  }
  out = out.split(NEW_GATE).join(OLD_GATE).split(NEW_CLOSE).join(OLD_CLOSE);
  return out;
}

export function injectWorkerRoute(code) {
  let out = stripWaSpa(code);
  if (!out.includes(OLD_GATE)) throw new Error('SPA 404 gate not found');
  if (out.split(OLD_GATE).length !== 2) throw new Error('SPA 404 gate not unique');
  if (!out.includes(OLD_CLOSE)) throw new Error('SPA HTML close not found');
  if (out.split(OLD_CLOSE).length !== 2) throw new Error('SPA HTML close not unique');
  out = out.split(OLD_GATE).join(NEW_GATE).split(OLD_CLOSE).join(NEW_CLOSE);
  const block = `${WA_SPA_BEGIN}\n${fnSource()}\n${WA_SPA_END}\n`;
  const pwaEnd = '/* NOVA_PWA_ASSETS_END */\n';
  if (out.includes(pwaEnd)) {
    const at = out.indexOf(pwaEnd);
    out = out.slice(0, at + pwaEnd.length) + block + out.slice(at + pwaEnd.length);
  } else {
    const anchor = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
    const at = out.indexOf(anchor);
    if (at < 0) throw new Error('fetch listener anchor not found');
    out = out.slice(0, at) + block + out.slice(at);
  }
  return out;
}

function writeIndex(root = '.') {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dir = path.join(root, 'whatsapp');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'index.html');
  fs.writeFileSync(dest, patchWhatsAppHtml(src));
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cmd = process.argv[2];
  if (cmd === '--write-index') {
    const dest = writeIndex('.');
    console.log('wrote', dest);
  } else if (cmd === '--inject') {
    const file = process.argv[3];
    if (!file) { console.error('usage: whatsapp-spa.mjs --inject WORKER.js'); process.exit(2); }
    const out = injectWorkerRoute(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, out);
    console.log('injected /whatsapp route into', file, Buffer.byteLength(out), 'bytes');
  } else {
    console.error('usage: whatsapp-spa.mjs --write-index | --inject WORKER.js');
    process.exit(2);
  }
}
