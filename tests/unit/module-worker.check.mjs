import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const code=fs.readFileSync('worker/live/nova-rx-preview.purchases7.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let journalReads=0;
const env={NOVA_API_PIN:'fixture-pin',NOVA_INGEST_SECRET:'fixture-ingest',NOVA_SECRET_ENCRYPTION_KEY:'fixture-key',NOVA_SECRETS_KV:{get:async()=>null},NOVA_PURCHASE_OPS:{prepare:()=>({bind:()=>({first:async()=>{journalReads++;return null;}})})}};
const ctx={waitUntil(){},passThroughOnException(){}};
async function request(path,body,pin='fixture-pin'){return worker.fetch(new Request('https://fixture.test'+path,{method:body?'POST':'GET',headers:{'X-Nova-Pin':pin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);}
const home=await request('/');assert.equal(home.status,200);assert((await home.text()).includes('novaLabelsPanel'));
const purchases=await request('/purchases');assert.equal(purchases.status,200);assert((await purchases.text()).includes('openSupplierCarts'));
const provider=await request('/supplier-provider.js');assert((await provider.text()).includes('applySupplierOrder'));
const preview=await request('/api/purchases/orders/preview',{supplierId:'pharmaoverseas'});assert.equal(preview.status,409);assert.equal((await preview.json()).error,'cart-session-required');assert.equal(journalReads,1,'D1 env binding reaches the original API');
for(let i=0;i<8;i++)assert.equal((await request('/api/suppliers/status',null,'wrong-pin')).status,401);
assert.equal((await request('/api/suppliers/status',null,'wrong-pin')).status,429,'rate limiter persists across requests in module adapter');
console.log('PASS module Worker: original POS/stickers, purchasing assets, D1 scope, persistent auth limiter');
