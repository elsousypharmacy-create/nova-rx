import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {resolveSellerId} from '../../worker/procurement/provider/seller-id.js';
import {createSupplierHub} from '../../worker/procurement/provider/hub.js';
import {createAumetCart} from '../../worker/procurement/provider/aumet-cart.js';
import {createSupplierOrders} from '../../worker/procurement/provider/supplier-orders.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
// Real Aumet data (live read-only check 2026-11-10): the warehouse list says 38596 "Demo care", the search
// row and the cart item say 385960002. The selection, the cart adapter and the order allowlist must all
// work on the listed id, otherwise every real Aumet offer is hidden and checkout reports "extra sellers".
const LIST=['38596','30426','26661'];
// --- the resolver ---
assert.equal(resolveSellerId('385960002',LIST),'38596','suffixed row id resolves to the listed warehouse');
assert.equal(resolveSellerId('38596',LIST),'38596','an already listed id stays');
assert.equal(resolveSellerId('999990002',LIST),'999990002','an id whose base is not listed is returned unchanged');
assert.equal(resolveSellerId('385960002',[]),'385960002','without a list nothing is guessed');
assert.equal(resolveSellerId('385960002',undefined),'385960002');
assert.equal(resolveSellerId('38596',['3859']),'38596','short numeric ids are never trimmed');
assert.equal(resolveSellerId('allowed',['all']),'allowed','non-numeric ids are never trimmed');
assert.equal(resolveSellerId(null,LIST),null);assert.equal(resolveSellerId(undefined,LIST),null);
assert.equal(resolveSellerId(385960002,LIST),'38596','numbers are accepted');
// --- the hub: search rows are matched against the selection on the listed id ---
const offer=id=>({supplierId:'aumet',supplierProductId:'p1',sellerId:id,sellerName:'Demo care',productName:'Panadol Extra 24 tabs',unitPrice:40,netEffectivePrice:null,publicPrice:60,stockStatus:'in_stock',lastUpdated:new Date().toISOString()});
const hubWith=(sellers,rowId)=>createSupplierHub({store:{load:async()=>({session:{sellers}})},connectors:{aumet:{search:async()=>({offers:[{}],page:1,pageSize:24,totalPages:1}),toOffer:()=>offer(rowId)}}});
let out=await hubWith(LIST.map(id=>({id,name:'x'})),'385960002').search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['38596']});
assert.equal(out.suppliers[0].selected,1,'a selected warehouse keeps its offer');assert.equal(out.results[0].offers.length,1);assert.equal(out.results[0].best.sellerId,'38596','offers expose the listed id');
out=await hubWith(LIST.map(id=>({id,name:'x'})),'385960002').search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['30426']});
assert.equal(out.suppliers[0].selected,0,'another warehouse still excludes it');assert.equal(out.results[0].offers.length,0);
out=await hubWith([],'385960002').search('Panadol Extra 24 tabs',{supplierIds:['aumet'],aumetSellerIds:['385960002']});
assert.equal(out.suppliers[0].selected,1,'without a warehouse list the raw id still works');
// --- the cart adapter: a cart row with the suffixed seller id is the same warehouse, not a payment conflict ---
let qty=4,writes=0;
const session={authorization:'t',sellers:LIST.map(id=>({id,name:'x'})),cartRequestTemplate:{method:'POST',path:'/api/v2/cart/9/items',body:{entity_id:8,payment_method_id:1}}};
const cartOffer={...offer('38596'),supplierProductId:'5',availableQuantity:100,raw:{paymentMethod:[{id:1}]}};
const cart=createAumetCart({store:{load:async()=>({session,savedAt:'t'})},hub:{search:async()=>({results:[{offers:[{offer:cartOffer}]}]})},secret:'unit-only',fetch:async(url,opts)=>{
 if(opts.method==='POST'){writes++;qty=JSON.parse(opts.body).quantity;return Response.json({ok:true});}
 return Response.json({data:{product_in_cart:[{entity_product_id:5,entity_seller_id:385960002,payment_method_id:1,quantity:qty}]}});}});
const line={productId:'5',sellerId:'38596',quantity:3,price:40,query:'Panadol 24 tabs',aumetSellerIds:['38596']};
const plan=await cart.preview(line);assert.equal(plan.before,4,'the suffixed cart row is the same warehouse');assert.equal(plan.target,7);
assert.equal((await cart.apply(plan)).state,'verified');assert.equal(writes,1);
// --- the order allowlist: cart items carry the suffixed id; the owner selected the listed id ---
function database(){const s=new DatabaseSync(':memory:');s.exec(fs.readFileSync('worker/procurement/migrations/0001_supplier_operations.sql','utf8'));return {prepare(sql){return {bind(...p){return {async run(){return {meta:{changes:Number(s.prepare(sql).run(...p).changes)}};},async first(){return s.prepare(sql).get(...p)||null;}};}};}};}
const cartBody=id=>({data:{buyer:{id:8},currency:{symbol:'EGP'},total:100,subTotal:100,vat:0,discount:0,sellers:[{id:70001,entity:{id:70001,name:'Demo care'},seller_total:100,minimum_order_value_area:{limit:'20'},items:[{quantity:2,unit_price:50,total:100,is_selected:1,payment_method_id:1,entityProduct:{id:5,entity_id:id,product:{label:{name:'drug'}}}}]}]}});
const orders=createSupplierOrders({store:{load:async()=>({savedAt:'t',session})},secret:'unit-only',db:database(),fetch:async(url,opts)=>{const p=new URL(url).pathname;if(p==='/api/v2/cart/9/items')return Response.json(cartBody(385960002));throw Error('unexpected '+p);}});
const preview=await orders.preview({supplierId:'aumet',aumetSellerIds:['38596']});assert.equal(preview.cart.lines.length,1,'a listed warehouse passes the allowlist');
await assert.rejects(orders.preview({supplierId:'aumet',aumetSellerIds:['30426']}),/order-extra-sellers/,'a warehouse the owner did not select is still refused');
console.log('PASS Aumet warehouse ids: suffixed row/cart ids resolve to the listed warehouse in search, cart and order checks; unrelated ids still excluded');
