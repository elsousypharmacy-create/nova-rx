import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createAumetCart} from '../../worker/procurement/provider/aumet-cart.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
let qty=4,writes=0,conflict=false,loseResponse=false;
const session={authorization:'test',sellers:[{id:'7'}],cartRequestTemplate:{method:'POST',path:'/api/v2/cart/9/items',body:{entity_id:8,payment_method_id:1}}};
const store={load:async()=>({session,savedAt:'test'})};
const offer={supplierId:'aumet',supplierProductId:'5',sellerId:'7',unitPrice:40,stockStatus:'in_stock',availableQuantity:100,raw:{paymentMethod:[{id:1}]}};
let searches=0;
const hub={search:async()=>{searches++;return {results:[{offers:[{offer}]}]};}};
const cart=createAumetCart({store,hub,secret:'unit-test-only',fetch:async(url,opts)=>{
 assert.ok(!/order|checkout/.test(url));
 if(opts.method==='POST'){writes++;const body=JSON.parse(opts.body);assert.equal(body.entity_product_id,5);qty=body.quantity;if(loseResponse)throw Error('timeout');return Response.json({ok:true});}
 return Response.json({data:{product_in_cart:[{entity_product_id:5,entity_seller_id:7,payment_method_id:conflict?2:1,quantity:qty}]}});
}});
const line={productId:'5',sellerId:'7',quantity:3,price:40,query:'Panadol 24 tabs',aumetSellerIds:['7']};
const p=await cart.preview(line);assert.equal(p.before,4);assert.equal(p.target,7);assert.equal(writes,0);
const invalid={...p,plan:p.plan.replace('"target":7','"target":70')};await assert.rejects(cart.apply(invalid),/cart-plan-invalid/);assert.equal(writes,0);
loseResponse=true;assert.equal((await cart.apply(p)).state,'verified');assert.equal(qty,7);assert.equal(writes,1);
assert.equal((await cart.apply(p)).alreadyApplied,true);assert.equal(writes,1);
const p2=await cart.preview(line);qty=8;await assert.rejects(cart.apply(p2),/cart-conflict/);assert.equal(writes,1);
conflict=true;await assert.rejects(cart.preview(line),/cart-payment-conflict/);assert.equal(writes,1);
conflict=false;offer.unitPrice=41;await assert.rejects(cart.preview(line),/cart-offer-changed/);
// Selected warehouses are enforced at cart-add time, before any upstream call or write.
offer.unitPrice=40;const w0=writes,s0=searches;
for(const bad of [undefined,[],['9'],'7',[7,{}]])await assert.rejects(cart.preview({...line,aumetSellerIds:bad}),/cart-seller-not-selected|bad-request/);
assert.equal(writes,w0);assert.equal(searches,s0,'rejected selection must not hit the supplier search');
await assert.rejects(cart.preview({...line,aumetSellerIds:['9']}),/cart-seller-not-selected/);
const ok=await cart.preview({...line,aumetSellerIds:['9','7']});assert.equal(ok.target,qty+3);assert.equal(writes,w0);
console.log('Aumet cart: signed plan, preserve qty, retry, conflict, payment, price, selected-warehouse checks PASS');
