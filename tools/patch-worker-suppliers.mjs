#!/usr/bin/env node
// Adds the supplier API (/api/suppliers/*) to a NOVA Worker script (service-worker style,
// one `addEventListener('fetch', ...)`). The procurement modules are bundled into one
// isolated block (each module in its own function, so names cannot clash with the Worker's
// globals) and a single route check is added at the start of the fetch listener.
// Usage: node tools/patch-worker-suppliers.mjs BASE_WORKER.js OUT_WORKER.js
// Nothing else in the Worker is touched. Running it twice on the same base gives the same output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = [
  'worker/procurement/provider/session-store.js',
  'worker/procurement/provider/hub.js',
  'worker/procurement/provider/http.js',
];
const BEGIN = '/* NOVA_SUPPLIER_API_BEGIN */';
const END = '/* NOVA_SUPPLIER_API_END */';

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const modules = new Map(); // rel path -> { id, deps, names, body }
const order = [];

function idOf(rel) {
  return 'M_' + rel.replace(/^worker\/procurement\//, '').replace(/\.js$/, '').replace(/[^A-Za-z0-9]+/g, '_');
}

function load(rel) {
  if (modules.has(rel)) return;
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  if (/^export\s+default\b|^export\s*\{|^export\s*\*/m.test(src)) throw new Error(`${rel}: unsupported export form`);
  if (/^import\s+[^{]/m.test(src) || /\bimport\(/.test(src)) throw new Error(`${rel}: unsupported import form`);
  const deps = [];
  let body = src.replace(IMPORT_RE, (_all, names, from) => {
    const depRel = path.posix.normalize(path.posix.join(path.posix.dirname(rel), from));
    deps.push(depRel);
    const mapped = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${mapped} } = ${idOf(depRel)};`;
  });
  if (/^import\s/m.test(body)) throw new Error(`${rel}: an import was not handled`);
  const names = [...body.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
  body = body.replace(/^export\s+/gm, '');
  modules.set(rel, { id: idOf(rel), deps, names, body });
  for (const d of deps) load(d);
  order.push(rel);
}
for (const e of ENTRIES) load(e);
// `order` has dependencies before dependents because load() pushes after loading deps.

const bundle = order
  .map((rel) => {
    const m = modules.get(rel);
    return `const ${m.id} = (function () {\n${m.body}\nreturn { ${m.names.join(', ')} };\n})();`;
  })
  .join('\n');

const glue = `
const NOVA_SUPPLIER_HANDLER = (function () {
  let api = null;
  const noStore = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  return async function (request) {
    if (!api) {
      const kv = typeof NOVA_SECRETS_KV !== 'undefined' ? NOVA_SECRETS_KV : null;
      const secret = typeof NOVA_SECRET_ENCRYPTION_KEY !== 'undefined' ? NOVA_SECRET_ENCRYPTION_KEY : '';
      if (!kv || !secret) return new Response(JSON.stringify({ error: 'not-configured' }), { status: 503, headers: noStore });
      const env = {
        NOVA_SECRET_ENCRYPTION_KEY: secret,
        NOVA_API_PIN: typeof NOVA_API_PIN !== 'undefined' ? NOVA_API_PIN : '',
        NOVA_INGEST_SECRET: typeof NOVA_INGEST_SECRET !== 'undefined' ? NOVA_INGEST_SECRET : '',
      };
      const store = M_provider_session_store.createSessionStore({ kv, secret });
      const hub = M_provider_hub.createSupplierHub({ store });
      api = M_provider_http.createSupplierApi({ hub, store, env });
    }
    const res = await api(request);
    return res || new Response('Not found', { status: 404 });
  };
})();`;

const block = `${BEGIN}\n${bundle}\n${glue}\n${END}\n`;

const [baseFile, outFile] = process.argv.slice(2);
if (!baseFile || !outFile) throw new Error('Usage: node tools/patch-worker-suppliers.mjs BASE_WORKER.js OUT_WORKER.js');
let code = fs.readFileSync(baseFile, 'utf8');
// Remove a previous patch so this is repeatable.
code = code.replace(new RegExp(`${BEGIN.replace(/[*/]/g, '\\$&')}[\\s\\S]*?${END.replace(/[*/]/g, '\\$&')}\\n?`), '');

// Preserve the owner-dashboard CORS contract while extending same-origin purchase reads.
const route = "if(url.pathname.startsWith('/api/suppliers/')||url.pathname.startsWith('/api/purchases/')){const origin=event.request.headers.get('Origin');const allow=origin==='https://elsousypharmacy-create.github.io'&&['/api/suppliers/search','/api/suppliers/status','/api/suppliers/list'].includes(url.pathname);event.respondWith((async()=>{if(allow&&event.request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Nova-Pin','Access-Control-Max-Age':'600','Vary':'Origin'}});const res=await NOVA_SUPPLIER_HANDLER(event.request);if(!allow)return res;const headers=new Headers(res.headers);headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');return new Response(res.body,{status:res.status,headers});})());return;}";
const oldStart = code.indexOf("if(url.pathname.startsWith('/api/suppliers/')){");
if (oldStart >= 0) {
  const oldEnd = code.indexOf("if(url.pathname==='/api/settings/secrets')", oldStart);
  if (oldEnd < 0) throw new Error('existing supplier route boundary not found');
  code = code.slice(0, oldStart) + code.slice(oldEnd);
}
code = code.split(route).join('');
const LISTENER = "addEventListener('fetch', event => { const url=new URL(event.request.url);";
const at = code.indexOf(LISTENER);
if (at < 0) throw new Error('fetch listener not found in the base Worker; refusing');
if (code.indexOf(LISTENER, at + 1) >= 0) throw new Error('more than one fetch listener; refusing');
code = code.slice(0, at) + block + LISTENER + route + code.slice(at + LISTENER.length);
fs.writeFileSync(outFile, code);
console.log(`patched: +${block.length + route.length} chars, modules: ${order.map((r) => modules.get(r).id).join(', ')}`);

