import { handleWhatsAppApi } from '../../integrations/whatsapp/secure-bridge.mjs';
import assert from 'node:assert/strict';

const HEX = '0f'.repeat(32);
const TOKEN = 'T'.repeat(40);
const URL_OK = 'https://script.google.com/macros/s/AKfycbyTEST123/exec';
async function enc(value) {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(HEX.match(/.{2}/g).map(x => parseInt(x, 16))), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return JSON.stringify({ v: 1, iv: Array.from(iv), data: Array.from(data) });
}
const store = { 'secret:WA_BACKEND_URL': await enc(URL_OK), 'secret:NOVA_WA_BRIDGE_TOKEN': await enc(TOKEN) };
const baseEnv = { NOVA_SECRETS_KV: { get: async k => store[k] ?? null }, NOVA_SECRET_ENCRYPTION_KEY: HEX,
  WA_TRUST_ACCESS_HEADER: '1', WA_ALLOWED_EMAILS: 'owner@example.com' };
const asOwner = { 'Cf-Access-Authenticated-User-Email': 'Owner@Example.com' };

const calls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); calls.push({ url: String(url), body });
  return new Response(JSON.stringify({ ok: true, chats: [], echo: body.operation }), { status: 200 });
};
const call = (path, { method = 'GET', headers = asOwner, body, env = baseEnv } = {}) =>
  handleWhatsAppApi(new Request('https://x.test' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) }), env);
const status = async (p, o) => (await call(p, o)).status;

// not configured / not logged in / wrong user
assert.equal(await status('/api/whatsapp/chats', { env: { ...baseEnv, WA_TRUST_ACCESS_HEADER: '0' } }), 503);
assert.equal(await status('/api/whatsapp/chats', { headers: {} }), 401);
assert.equal(await status('/api/whatsapp/chats', { headers: { 'Cf-Access-Authenticated-User-Email': 'evil@example.com' } }), 401);
assert.equal(calls.length, 0, 'no backend call before auth');

// secrets missing or bad token length -> 503, no backend call
assert.equal(await status('/api/whatsapp/chats', { env: { ...baseEnv, NOVA_SECRETS_KV: { get: async () => null } } }), 503);
assert.equal(calls.length, 0);

// list / get / reply / hold go to Apps Script with the bridge token, never to the browser
let r = await call('/api/whatsapp/chats'); assert.equal(r.status, 200);
const text = await r.text(); assert.ok(!text.includes(TOKEN) && !text.includes('AKfycby'), 'no secret in response');
assert.equal(calls[0].url, URL_OK); assert.equal(calls[0].body.action, 'novaWhatsAppBridge');
assert.equal(calls[0].body.bridgeToken, TOKEN); assert.equal(calls[0].body.operation, 'list');
await call('/api/whatsapp/chats/wa_123'); assert.equal(calls.at(-1).body.operation, 'get'); assert.equal(calls.at(-1).body.chatId, 'wa_123');
await call('/api/whatsapp/chats/wa_123/reply', { method: 'POST', body: { text: 'اهلا' } });
assert.equal(calls.at(-1).body.operation, 'reply'); assert.equal(calls.at(-1).body.text, 'اهلا');
await call('/api/whatsapp/chats/wa_123/hold', { method: 'POST', body: { hold: true } });
assert.equal(calls.at(-1).body.operation, 'hold'); assert.equal(calls.at(-1).body.hold, true);

// input validation, no backend call
const n = calls.length;
assert.equal(await status('/api/whatsapp/chats/wa_1/reply', { method: 'POST', body: { text: '  ' } }), 400);
assert.equal(await status('/api/whatsapp/chats/wa_1/reply', { method: 'POST', body: { text: 'x'.repeat(4001) } }), 400);
assert.equal(await status('/api/whatsapp/chats/wa_1/hold', { method: 'POST', body: { hold: 'yes' } }), 400);
assert.equal(await status('/api/whatsapp/chats/../etc', {}), 400);
assert.equal(await status('/api/whatsapp/chats', { method: 'POST', body: {} }), 405);
assert.equal(await status('/api/whatsapp/chats', { method: 'DELETE' }), 405);
assert.equal(calls.length, n, 'invalid requests never reach the backend');

// backend host is locked to script.google.com
store['secret:WA_BACKEND_URL'] = await enc('https://evil.example.com/macros/s/abc/exec');
assert.equal(await status('/api/whatsapp/chats'), 503);
assert.equal(calls.length, n);

console.log('whatsapp-bridge.check: PASS');
