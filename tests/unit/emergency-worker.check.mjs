import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file = new URL('../../worker/live/nova-rx-preview.with-emergency2.js', import.meta.url);
const code = fs.readFileSync(file, 'utf8');
let handler; const ctx = { addEventListener: (t, h) => { if (t === 'fetch') handler = h; }, console, URL, Response, Request, Headers, fetch: async () => new Response('x'), crypto, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout };
vm.createContext(ctx); vm.runInContext(code, ctx);
async function get(p) { let res; await new Promise(r => { handler({ request: new Request('https://w.test' + p), respondWith: v => { res = v; r(); }, waitUntil() {} }); setTimeout(r, 50); }); return res && await res; }
for (const p of ['/emergency', '/emergency/']) {
  const r = await get(p); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  const t = await r.text();
  assert.ok(t.includes('NovaEmergency') && t.includes('فاتورة مؤقتة') && t.includes('data:font/woff;base64,'));
  assert.equal(t.includes('emergency-core.js"'), false); assert.equal(/X-Nova-Pin|api[_-]?key|secret/i.test(t), false, 'no secrets in the page');
}
const st = await get('/emergency/stock.json'); assert.equal(st.status, 200);
const sj = JSON.parse(await st.text()); assert.ok(sj.items.length > 1000 && sj.exportedAt, 'price list served');
assert.equal(JSON.stringify(sj).includes('"stock"'), false, 'stock levels are not published');
assert.ok(sj.items.every(i => i.price > 0 && i.code && i.namear));
const root = await get('/'); assert.ok(root && root.status === 200, 'main app still served');
console.log('emergency-worker checks passed');
