import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const HEX = 'ab'.repeat(32), TOKEN = 'K'.repeat(40), BACKEND = 'https://script.google.com/macros/s/AKfycbyABC/exec';
async function enc(v) {
  const k = await crypto.subtle.importKey('raw', new Uint8Array(HEX.match(/.{2}/g).map(x => parseInt(x, 16))), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return JSON.stringify({ v: 1, iv: [...iv], data: [...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(v)))] });
}
const kv = { 'secret:WA_BACKEND_URL': await enc(BACKEND), 'secret:NOVA_WA_BRIDGE_TOKEN': await enc(TOKEN) };
const upstream = [];
const handlers = {};
const sandbox = {
  addEventListener: (t, h) => { handlers[t] = h; },
  NOVA_SECRETS_KV: { get: async k => kv[k] ?? null, put: async () => {} },
  NOVA_SECRET_ENCRYPTION_KEY: HEX,
  fetch: async (req, init) => {
    if (init && init.body) { upstream.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, chats: [{ id: 'wa_1', name: 'x' }] })); }
    return new Response('passthrough');
  },
  Response, Request, URL, crypto, TextEncoder, TextDecoder, AbortSignal, atob, btoa, Uint8Array, JSON, console, setTimeout,
};
vm.createContext(sandbox);
const code = fs.readFileSync(new URL('../../worker/live/nova-rx-preview.with-whatsapp.js', import.meta.url), 'utf8');
vm.runInContext(code, sandbox, { filename: 'worker.js' });
assert.equal(typeof handlers.fetch, 'function');

async function hit(path, headers = {}, init = {}) {
  let p; const request = new Request('https://x.test' + path, { headers, ...init });
  handlers.fetch({ request, respondWith: r => { p = r; }, waitUntil() {} });
  return p ? await p : null;
}
const owner = { 'Cf-Access-Authenticated-User-Email': 'elsousypharmacy@gmail.com' };

// new route
let r = await hit('/api/whatsapp/chats', owner); assert.equal(r.status, 200);
const body = await r.text(); assert.ok(body.includes('wa_1') && !body.includes(TOKEN));
assert.equal(upstream[0].operation, 'list'); assert.equal(upstream[0].bridgeToken, TOKEN);
assert.equal((await hit('/api/whatsapp/chats')).status, 401);
assert.equal((await hit('/api/whatsapp/chats', { 'Cf-Access-Authenticated-User-Email': 'other@x.com' })).status, 401);

// inbox page is the real one now, not the placeholder
r = await hit('/whatsapp-inbox.html', owner); const html = await r.text();
assert.ok(html.includes('/api/whatsapp/') && !html.includes('بانتظار ربط البوت'));

// existing routes still behave
r = await hit('/api/settings/secrets', {}); assert.equal(r.status, 403);
r = await hit('/api/settings/secrets', owner, { headers: owner }); assert.ok(r.status === 200);

console.log('worker-live-patch.check: PASS');
