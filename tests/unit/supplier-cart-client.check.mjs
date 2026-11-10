import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const storage=new Map([['novaApiPin','test-pin']]);let previews=0,writes=0,lose=false,accepted=true,complete,lastPreview=null;
const context={window:{prompt:()=>null},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Map,Promise,JSON,Error};
context.fetch=async(path,opts)=>{
 if(path.endsWith('/preview')){previews++;lastPreview=JSON.parse(opts.body);return Response.json({ok:true,plan:'signed-plan',signature:'signature',before:2,quantity:3,target:5});}
 writes++;if(lose)throw Error('timeout');if(complete)await complete;return Response.json({ok:true,state:'verified',quantity:5});
};
vm.runInNewContext(fs.readFileSync('supplier-provider.js','utf8'),context);
const p=context.window.NOVA_SUPPLIER_PROVIDER,line={supplierId:'aumet',productId:'1',sellerId:'2',quantity:3,price:40,query:'test'};
const confirm=()=>accepted;
accepted=false;assert.equal((await p.addToSupplierCart(line,confirm)).state,'cancelled');assert.equal(writes,0);
accepted=true;lose=true;await assert.rejects(p.addToSupplierCart(line,confirm));assert.equal(previews,2);assert.ok(storage.get('novaPendingSupplierCartsV1').includes('signed-plan'));
lose=false;await p.addToSupplierCart(line,confirm);assert.equal(previews,2);assert.equal(writes,2);assert.equal(storage.get('novaPendingSupplierCartsV1'),'{}');
let release;complete=new Promise(r=>release=r);const a=p.addToSupplierCart(line,confirm),b=p.addToSupplierCart(line,confirm);assert.equal(a,b);release();await a;assert.equal(writes,3);
// Aumet previews always carry the saved warehouse selection as strings; no selection means an empty list, never "all".
const fresh=id=>({supplierId:'aumet',productId:id,sellerId:'2',quantity:1,price:10,query:'x'});
await p.prepareSupplierCart('aumet',fresh('8'));assert.deepEqual(JSON.parse(JSON.stringify(lastPreview.aumetSellerIds)),[]);
storage.set('novaPurchasePrefsV1',JSON.stringify({aumetSellers:[2,'5']}));
await p.prepareSupplierCart('aumet',fresh('9'));assert.deepEqual(JSON.parse(JSON.stringify(lastPreview.aumetSellerIds)),['2','5']);
await p.previewSupplierCart('aumet',fresh('10'));assert.deepEqual(JSON.parse(JSON.stringify(lastPreview.aumetSellerIds)),['2','5']);
await p.previewAumetCart(fresh('11'));assert.deepEqual(JSON.parse(JSON.stringify(lastPreview.aumetSellerIds)),['2','5']);
await p.prepareSupplierCart('pharmaoverseas',{supplierId:'pharmaoverseas',productId:'A1',quantity:1,price:10,query:'x'});assert.equal('aumetSellerIds' in lastPreview,false);
console.log('PASS supplier add: cancellation never writes; unknown retries original signed target; double click shares one mutation');
