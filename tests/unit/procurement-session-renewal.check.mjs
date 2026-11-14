import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { guardAumetApi, verifyAumetCart }=require('../../tools/sessions/aumet-renewal.cjs');
const template={method:'POST',path:'/api/v2/cart/123/items',body:{entity_id:456,payment_method_id:2,entity_product_id:789,quantity:1}};
let handler;const capture=await guardAumetApi({route:async(pattern,fn)=>{assert.equal(pattern,'**/api/**');handler=fn;}});
async function route(method,path,body){let action;await handler({request:()=>({url:()=>`https://marketplace.aumet.com${path}`,method:()=>method,postDataJSON:()=>body}),abort:async()=>{action='abort';},continue:async()=>{action='continue';}});return action;}
assert.equal(await route('GET','/api/products'),'continue');
for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(await route(method,'/api/v2/order/123',{}),'abort');
assert.equal(await route('POST',template.path,template.body),'abort');
assert.deepEqual(capture(),template);
assert.equal(await route('PUT',template.path,template.body),'abort');
assert.deepEqual(capture(),template);
let calls=0;
const request={get:async(url,options)=>{calls++;assert.equal(url,'https://marketplace.aumet.com/api/v2/cart/123/items');assert.equal(options.maxRedirects,0);return {status:()=>200,json:async()=>({data:{buyer:{id:456},sellers:[]}})};}};
await verifyAumetCart(request,template,'Bearer fake','fake-xsrf');assert.equal(calls,1);
for(const t of [null,{...template,method:'DELETE'},{...template,path:'/api/v2/order/123'},{...template,body:{entity_id:456}}])await assert.rejects(()=>verifyAumetCart(request,t,'fake',''),/cart-context-missing/);
for(const status of [302,401,403,500])await assert.rejects(()=>verifyAumetCart({get:async()=>({status:()=>status})},template,'fake',''),/cart-read-verification-failed/);
for(const data of [{data:{buyer:{id:999},sellers:[]}},{data:{buyer:{id:456}}},{}])await assert.rejects(()=>verifyAumetCart({get:async()=>({status:()=>200,json:async()=>data})},template,'fake',''),/cart-read-verification-failed/);
// The scheduled path must capture and verify before sending, without diagnostic opt-in.
const fs=await import('node:fs');const src=fs.readFileSync(new URL('../../tools/sessions/push-sessions.cjs',import.meta.url),'utf8');
assert.ok(src.indexOf('await guardAumetApi(ctx)')<src.indexOf("phase = 'open-login-page'"));
assert.ok(src.indexOf('await captureAumetCart(page, capturedCart)')<src.indexOf("if (process.env.INSPECT_CART === 'true')",src.indexOf('async function aumet')));
assert.ok(src.indexOf('await verifyAumetCart(')<src.indexOf("await send('aumet'"));
// Hardening: the Aumet context blocks service workers (they bypass the route guard); a 401 with the right buyer id must still fail.
const aumetStart = src.indexOf('async function aumet');
assert.ok(/newContext\(\{[^}]*serviceWorkers: 'block'/.test(src.slice(aumetStart, src.indexOf("phase = 'prepare'", aumetStart))), 'Aumet context blocks service workers');
await assert.rejects(() => verifyAumetCart({ get: async () => ({ status: () => 401, json: async () => ({ data: { buyer: { id: 456 }, sellers: [] } }) }) }, template, 'fake', ''), /cart-read-verification-failed/);
// FIX44: a failed/missing cart verification must not block saving the read-only search session, and must drop the template.
const vi=src.indexOf('await verifyAumetCart(',aumetStart);
assert.ok(/try \{ await verifyAumetCart\([^)]*\); \} catch \{ cartVerified = false; capturedCartRequest = null; \}/.test(src.slice(vi-8,vi+200)),'cart verification is best-effort');
assert.ok(!/throw/.test(src.slice(aumetStart,src.indexOf('async function aumet')+20000).split("phase = 'save-session'")[0].split("phase = 'verify-cart-session'")[1]||''),'no throw between verify and save');
console.log('PASS: renewal blocks writes, captures cart on normal refresh, rejects missing/wrong-account/expired cart before success');
