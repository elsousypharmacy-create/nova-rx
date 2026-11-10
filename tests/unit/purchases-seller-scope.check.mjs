import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createSupplierHub} from '../../worker/procurement/provider/hub.js';
import {SchemaDriftError} from '../../worker/procurement/connector-contract.js';
let prefs={suppliers:['aumet','pharmaoverseas'],aumetSellers:['allowed']},sent;
const context={window:{},localStorage:{getItem:k=>k==='novaApiPin'?'test':JSON.stringify(prefs)},fetch:async(p,init)=>{sent=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({results:[]})};}};
vm.runInNewContext(fs.readFileSync('supplier-provider.js','utf8'),context);
await context.window.NOVA_SUPPLIER_PROVIDER.search('Panadol');assert.deepEqual(JSON.parse(JSON.stringify(sent.aumetSellerIds)),['allowed']);assert.equal(sent.supplierIds.length,2);
prefs.aumetSellers=[];await context.window.NOVA_SUPPLIER_PROVIDER.search('Panadol');assert(!sent.supplierIds.includes('aumet'));
const offer=id=>({supplierId:'aumet',supplierProductId:id,sellerId:id,productName:'Panadol Extra 24 tabs',unitPrice:id==='excluded'?1:40,netEffectivePrice:null,publicPrice:60,stockStatus:'in_stock',lastUpdated:new Date().toISOString()});
const hub=createSupplierHub({store:{load:async()=>({session:{}})},connectors:{aumet:{search:async()=>({offers:[offer('allowed'),offer('excluded')]}),toOffer:r=>r}}});
const r=await hub.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['allowed']});assert.equal(r.results[0].offers.length,1);assert.equal(r.results[0].best.sellerId,'allowed');
const empty=await hub.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:[]});assert.equal(empty.results[0].offers.length,0);
// --- #112: complete, per-seller, fail-closed pagination (synthetic pages of 24, no network) ---
const row=(id,price)=>({...offer(id),unitPrice:price});
function pagedHub(pages,{failAt=0,totalPages=pages.length}={}){
 const calls=[];
 const connectors={aumet:{toOffer:r=>r,search:async(q,{page})=>{calls.push(page);if(page===failAt)throw new Error('upstream');return {offers:pages[page-1]||[],page,pageSize:24,totalPages};}}};
 return {calls,hub:createSupplierHub({store:{load:async()=>({session:{}})},connectors})};
}
const filler=n=>Array.from({length:24},(_,i)=>row('other'+n+'-'+i,50));
{ // selected seller exists only on page 3 of 4: must be found, every page read once
 const {calls,hub:h}=pagedHub([filler(1),filler(2),[row('target',30),...filler(3).slice(1)],filler(4)]);
 const out=await h.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['target']});
 assert.deepEqual(calls,[1,2,3,4]);assert.equal(out.results[0].offers.length,1);assert.equal(out.results[0].best.sellerId,'target');assert.equal(out.suppliers[0].state,'ok');
}
{ // first-page-only filtering is the bug this guards: with 1 page nothing extra is fetched
 const {calls,hub:h}=pagedHub([[row('target',30),...filler(1).slice(1)]]);
 const out=await h.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['target']});assert.deepEqual(calls,[1]);assert.equal(out.results[0].offers.length,1);
}
{ // empty selection never fetches extra pages and returns nothing
 const {calls,hub:h}=pagedHub([filler(1),filler(2)]);
 const out=await h.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:[]});assert.deepEqual(calls,[1]);assert.equal(out.results[0].offers.length,0);
}
{ // catalog larger than the 12-page cap fails closed: no partial offers, honest message, exactly 12 pages read
 const pages=Array.from({length:20},(_,i)=>i===0?[row('target',30),...filler(0).slice(1)]:filler(i+1));
 const {calls,hub:h}=pagedHub(pages);
 const out=await h.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['target']});
 assert.equal(calls.length,12);assert.equal(out.suppliers[0].state,'error');assert.match(out.suppliers[0].message,/لم يكتمل/);assert.doesNotMatch(out.suppliers[0].message,/تعذر الاتصال/);assert.equal(out.results[0].offers.length,0,'page-1 hit must not leak from an incomplete scan');
}
{ // a page failing mid-scan discards what earlier pages found
 const {hub:h}=pagedHub([[row('target',30),...filler(1).slice(1)],filler(2),filler(3)],{failAt:2});
 const out=await h.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['target']});assert.equal(out.suppliers[0].state,'error');assert.equal(out.results[0].offers.length,0);
}
{ // the timeout stops the background scan too: no more upstream pages after nobody is waiting
 const calls=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const slow=createSupplierHub({aumetSearchTimeoutMs:80,store:{load:async()=>({session:{}})},connectors:{aumet:{toOffer:r=>r,search:async(q,{page})=>{calls.push(page);await sleep(50);return {offers:[row('target',30)],page,pageSize:24,totalPages:12};}}}});
 const out=await slow.search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['target']});
 assert.equal(out.suppliers[0].state,'error');assert.match(out.suppliers[0].message,/لم يكتمل/);assert.equal(out.results[0].offers.length,0,'a timed-out scan leaks no offers');
 const atTimeout=calls.length;await sleep(500);
 assert.ok(calls.length<=atTimeout+1,'scan must stop after the timeout (pages at timeout '+atTimeout+', later '+calls.length+')');assert.ok(calls.length<6);
}
// --- silent empty results must be diagnosable and, when every row is unreadable, visible as an error ---
{
 const hubFor=(rows,toOffer)=>createSupplierHub({store:{load:async()=>({session:{}})},connectors:{aumet:{search:async()=>({offers:rows,page:1,pageSize:24,totalPages:1}),toOffer}}});
 const drift=()=>{throw new SchemaDriftError('shape changed');};
 // every row unreadable: an error with an honest message, never a quiet "ok" with zero offers
 let out=await hubFor([{},{},{}],drift).search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['allowed']});
 assert.equal(out.suppliers[0].state,'error');assert.match(out.suppliers[0].message,/اتغيّر/);assert.equal(out.suppliers[0].rows,3);assert.equal(out.suppliers[0].readable,0);assert.equal(out.suppliers[0].drifted,3);assert.equal(out.results[0].offers.length,0);
 // some rows unreadable: still ok, with the numbers exposed
 let n=0;out=await hubFor([{},{}],()=>{if(n++===0)throw new SchemaDriftError('x');return offer('allowed');}).search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['allowed']});
 assert.equal(out.suppliers[0].state,'ok');assert.deepEqual([out.suppliers[0].rows,out.suppliers[0].readable,out.suppliers[0].drifted,out.suppliers[0].selected,out.suppliers[0].shown],[2,1,1,1,1]);
 // rows readable but the selection excludes them all: ok, selected 0 (distinguishable from "no rows")
 out=await hubFor([{}],()=>offer('other')).search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['allowed']});
 assert.equal(out.suppliers[0].state,'ok');assert.deepEqual([out.suppliers[0].rows,out.suppliers[0].readable,out.suppliers[0].selected,out.suppliers[0].shown],[1,1,0,0]);
 // no rows at all
 out=await hubFor([],()=>offer('x')).search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['allowed']});
 assert.equal(out.suppliers[0].state,'ok');assert.equal(out.suppliers[0].rows,0);
}
// --- #112: preference writes go through the provider, keep other fields, drop non-plain values ---
{
 const store=new Map();const ctx={window:{},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}};
 vm.runInNewContext(fs.readFileSync('supplier-provider.js','utf8'),ctx);const pr=ctx.window.NOVA_SUPPLIER_PROVIDER;
 pr.savePurchasePrefs({days:21,level:'ideal',suppliers:['aumet'],aumetSellers:['7','8'],fn:()=>1,nested:{password:'x'}});
 const saved=JSON.parse(store.get('novaPurchasePrefsV1'));assert.deepEqual(saved,{days:21,level:'ideal',suppliers:['aumet'],aumetSellers:['7','8']});
 assert.throws(()=>pr.savePurchasePrefs(null),/prefs-invalid/);assert.throws(()=>pr.savePurchasePrefs([1]),/prefs-invalid/);
}
console.log('PASS sale provider forwards saved seller scope; empty scope excludes Aumet; server removes unselected cheapest seller before ranking');
