import { createSignedPlans } from './signed-plan.js';
import { createSupplierAccounts } from './supplier-account.js';
const root='/occ/v2/pharma';
const code=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
// Contracts: storefront chunk-7A7ZXZ46 + main override (run 42718480038).
// Active means saveTime is absent. Saved carts must never be used as the active cart.
export function createPharmaOverseasCart({store,hub,secret,fetch:fetchImpl=globalThis.fetch,now=()=>Date.now()}){
 const signed=createSignedPlans(secret,now),accounts=createSupplierAccounts({store,fetch:fetchImpl});
 async function active(c){
  const d=await accounts.request(c,root+'/users/current/carts?fields=carts(FULL)&lang=en&curr=EGP');
  if(!Array.isArray(d.carts))throw Error('cart-schema-changed');
  const carts=d.carts.filter(x=>x.saveTime===undefined);
  if(carts.length>1)throw Error('cart-multiple-active');
  const cart=carts[0]||null;if(cart&&(!code(cart.code)||!Array.isArray(cart.entries)))throw Error('cart-schema-changed');return cart;
 }
 function entry(cart,product){
  const rows=(cart?.entries||[]).filter(e=>String(e.product?.code)===product);
  if(rows.length>1)throw Error('cart-duplicate-lines');
  const e=rows[0],n=e?Number(e.quantity):0;
  if(!Number.isInteger(n)||n<0)throw Error('cart-schema-changed');return {row:e,quantity:n};
 }
 async function preview(line){
  if(!line||!code(line.productId)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>10000||typeof line.query!=='string'||line.query.length>200||!Number.isFinite(line.price))throw Error('bad-request');
  const c=await accounts.context('pharmaoverseas');
  const fresh=await hub.search(line.query,{supplierIds:['pharmaoverseas'],requestedQty:line.quantity});
  const offer=(fresh.results||[]).flatMap(r=>r.offers||[]).map(r=>r.offer||r).find(o=>o.supplierId==='pharmaoverseas'&&String(o.supplierProductId)===line.productId);
  if(!offer||offer.unitPrice!==line.price||!['in_stock','low'].includes(offer.stockStatus))throw Error('cart-offer-changed');
  const cart=await active(c),before=entry(cart,line.productId).quantity,target=before+line.quantity;
  if(Number.isFinite(offer.availableQuantity)&&target>offer.availableQuantity)throw Error('cart-stock-changed');
  const p=await signed.pack({kind:'po-cart',binding:c.record.savedAt,cart:cart?.code||null,product:line.productId,before,target,quantity:line.quantity,price:line.price});
  return {...p,before,target,quantity:line.quantity};
 }
 async function apply(input){
  const p=await signed.unpack(input);if(p.kind!=='po-cart')throw Error('cart-plan-invalid');
  const c=await accounts.context('pharmaoverseas');if(c.record.savedAt!==p.binding)throw Error('cart-session-changed');
  let cart=await active(c);if((cart?.code||null)!==p.cart)throw Error('cart-conflict');
  const current=entry(cart,p.product).quantity;
  if(current===p.target)return {ok:true,state:'verified',quantity:current,alreadyApplied:true};
  if(current!==p.before)throw Error('cart-conflict');
  if(!cart){
   // Creation is part of the explicitly confirmed addition; a timeout is never retried.
   try{cart=await accounts.request(c,root+'/users/current/carts?fields=FULL&lang=en&curr=EGP',{method:'POST',body:{}});}catch{return {ok:false,state:'unknown',error:'cart-create-unknown'};}
   if(!code(cart?.code))return {ok:false,state:'unknown',error:'cart-schema-changed'};
  }
  const e=entry(cart,p.product).row;
  // Existing entries use an absolute PATCH; a new entry uses the observed custom add route.
  try{
   if(e){
    if(!Number.isInteger(e.entryNumber)||e.entryNumber<0)throw Error('cart-schema-changed');
    await accounts.request(c,root+'/users/current/carts/'+cart.code+'/entries/'+e.entryNumber+'?lang=en&curr=EGP',{method:'PATCH',body:{quantity:p.target}});
   }else await accounts.request(c,root+'/orgUsers/current/carts/'+cart.code+'/entries?quantity='+p.quantity+'&code='+encodeURIComponent(p.product)+'&lang=en&curr=EGP',{method:'POST',body:'',form:true});
  }catch{/* A lost response is resolved by read-back, never by another POST. */}
  try{const after=await active(c);if(after?.code!==cart.code)return {ok:false,state:'unknown',error:'cart-conflict'};const qty=entry(after,p.product).quantity;if(qty===p.target)return {ok:true,state:'verified',quantity:qty};return {ok:false,state:'unknown',error:'cart-readback-mismatch',quantity:qty};}
  catch{return {ok:false,state:'unknown',error:'cart-readback-unavailable'};}
 }
 return {preview,apply,active,entry,accounts};
}
