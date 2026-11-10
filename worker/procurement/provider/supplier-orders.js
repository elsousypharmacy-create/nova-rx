import { createSignedPlans } from './signed-plan.js';
import { createSupplierAccounts } from './supplier-account.js';
import { createPharmaOverseasCart } from './pharmaoverseas-cart.js';
import { createOperationJournal } from './operation-journal.js';
const safeId=x=>/^[A-Za-z0-9_-]{1,100}$/.test(String(x??''));
const num=x=>{const n=Number(x);if(x==null||!Number.isFinite(n)||n<0)throw Error('order-schema-changed');return n;};
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export function createSupplierOrders(options){
 const {store,secret,db}=options,accounts=createSupplierAccounts(options),plans=createSignedPlans(secret),journal=createOperationJournal(db),po=createPharmaOverseasCart(options);
 async function snapshot(supplier,allowedSellers=[]){
  const c=await accounts.context(supplier);let cart,body,view,fingerprint;
  if(supplier==='aumet'){
   const d=await accounts.request(c,'/api/v2/cart/'+c.cart+'/items');cart=d.data;
   if(!cart||String(cart.buyer?.id)!==c.entity||!Array.isArray(cart.sellers))throw Error('order-schema-changed');
   const sellers=cart.sellers.filter(s=>(s.items||[]).some(i=>Number(i.is_selected)===1));
   if(!sellers.length)throw Error('order-cart-empty');
   const allow=new Set(allowedSellers.map(String));
   for(const s of sellers){
    // Cart display entities can include a payment-method suffix. Offers and saved warehouse choices use each entityProduct.entity_id.
    if(s.items.some(i=>Number(i.is_selected)===1&&!allow.has(String(i.entityProduct?.entity_id))))throw Error('order-extra-sellers');
    if(s.entity?.is_locked||s.entity?.is_offline)throw Error('order-seller-unavailable');
    if(s.items.some(i=>Number(i.is_selected)===1&&(i.has_issue||i.entityProduct?.is_locked||i.is_offline)))throw Error('order-cart-needs-review');
    if(num(s.seller_total)<num(s.minimum_order_value_area?.limit??0))throw Error('order-minimum-not-met');
   }
   const lines=sellers.flatMap(s=>s.items.filter(i=>Number(i.is_selected)===1).map(i=>({productId:String(i.entityProduct?.id),sellerId:String(i.entityProduct.entity_id),seller:s.entity.name||String(s.entity.id),name:typeof (i.entityProduct?.product?.label?.name??i.entityProduct?.product?.label)==='string'?(i.entityProduct.product.label.name??i.entityProduct.product.label):'صنف '+i.entityProduct?.id,quantity:num(i.quantity),unitPrice:num(i.unit_price),total:num(i.total),payment:String(i.payment_method_id)})));
   if(lines.some(l=>!safeId(l.productId)||!Number.isInteger(l.quantity)||l.quantity<1)||lines.length>300)throw Error('order-schema-changed');
   body={entity_id:Number(c.entity),sellers:sellers.map(s=>({entity_id:s.id,note:s.note??null,promo_code:null}))};
   if(typeof cart.currency?.symbol!=='string'||!cart.currency.symbol.trim())throw Error('order-currency-unverified');
   view={supplierId:supplier,cartId:c.cart,lines,total:num(cart.total),currency:cart.currency?.symbol||'',subtotal:num(cart.subTotal),tax:num(cart.vat),discount:num(cart.discount),payment:[...new Set(lines.map(l=>l.payment))].join(', '),delivery:'عنوان التوصيل المسجل في حساب أوميت'};
   // Selection, all account-cart lines, prices, notes, limits and totals are bound to approval.
   fingerprint={cart:c.cart,buyer:c.entity,body,view,sellers:cart.sellers.map(s=>({id:s.id,items:s.items,minimum:s.minimum_order_value_area,payment:s.paymentMethod,total:s.seller_total}))};
  }else{
   cart=await po.active(c);if(!cart||!cart.entries.length)throw Error('order-cart-empty');
   if(!safeId(cart.code)||cart.entries.length>300)throw Error('order-schema-changed');
   const lines=cart.entries.map(e=>({productId:String(e.product?.code),name:e.product?.name||String(e.product?.code),quantity:num(e.quantity),unitPrice:num(e.basePrice?.value),total:num(e.totalPrice?.value),payment:cart.paymentType?.code||''}));
   if(lines.some(l=>!safeId(l.productId)||!Number.isInteger(l.quantity)||l.quantity<1))throw Error('order-schema-changed');
   const currency=cart.totalPrice?.currencyIso;if(currency!=='EGP')throw Error('order-currency-unverified');
   view={supplierId:supplier,cartId:cart.code,lines,total:num(cart.totalPrice.value),currency,subtotal:num(cart.subTotal?.value),tax:num(cart.totalTax?.value),discount:num(cart.totalDiscounts?.value),payment:cart.paymentType?.code||'غير محدد',delivery:cart.deliveryAddress?[cart.deliveryAddress.line1,cart.deliveryAddress.line2,cart.deliveryAddress.town].filter(Boolean).join('، '):'عنوان التوصيل المسجل في حساب أوفرسيز'};
   body={cartId:cart.code};fingerprint={view,deliveryAddress:cart.deliveryAddress??null,deliveryMode:cart.deliveryMode??null,paymentInfo:cart.paymentInfo??null,paymentType:cart.paymentType,appliedVouchers:cart.appliedVouchers};
  }
  const hash=await plans.sign(JSON.stringify(canonical(fingerprint)));
  return {c,body,view,hash};
 }
 async function preview({supplierId,aumetSellerIds=[]}={}){
  if(!['aumet','pharmaoverseas'].includes(supplierId)||!Array.isArray(aumetSellerIds)||aumetSellerIds.length>500)throw Error('bad-request');
  // Validate durable execution storage even when the supplier cart is empty.
  try{await journal.lookup('readiness');}catch{throw Error('cart-journal-read-failed');}
  let snap;try{snap=await snapshot(supplierId,aumetSellerIds);}catch(e){if(/^(cart-|order-)/.test(e.message))throw e;throw Error('order-cart-read-failed');}
  const p=await plans.pack({kind:'supplier-order',supplierId,binding:snap.c.record.savedAt,hash:snap.hash,allowedSellers:aumetSellerIds,orderCount:snap.body.sellers?.length||1,total:snap.view.total,currency:snap.view.currency});return {...p,cart:snap.view};
 }
 async function apply(input={}){
  if(input.confirmed!==true)throw Error('order-confirmation-required');
  const p=await plans.unpack(input,true);if(p.kind!=='supplier-order')throw Error('cart-plan-invalid');
  const old=await journal.lookup(input.signature);if(old?.state==='verified')return {...JSON.parse(old.receipt),alreadyApplied:true};if(old)throw Error(old.state==='failed'?'order-not-started':'cart-operation-pending');
  if(p.expires<Date.now())throw Error('cart-plan-expired');
  if(p.supplierId==='pharmaoverseas'&&input.termsAccepted!==true)throw Error('order-terms-required');
  const claim=await journal.claim(input.signature,p.supplierId);if(!claim.claimed)return claim.receipt;
  let snap;
  try{snap=await snapshot(p.supplierId,p.allowedSellers);if(snap.c.record.savedAt!==p.binding)throw Error('cart-session-changed');if(snap.hash!==p.hash)throw Error('order-cart-changed');}
  catch(e){await journal.finish(input.signature,'failed');throw e;}
  let ids=[];
  try{
   if(p.supplierId==='aumet'){
    const response=await accounts.request(snap.c,'/api/v2/order',{method:'POST',body:snap.body});
    if(!Array.isArray(response.data)||!response.data.length||response.data.some(x=>!safeId(x.id)))throw Error('order-response-unverified');
    ids=response.data.map(x=>String(x.id));
    if(ids.length!==snap.body.sellers.length)throw Error('order-partial');
    for(const id of ids){const r=await accounts.request(snap.c,'/api/v2/order/'+id);if(String(r.data?.id)!==id)throw Error('order-readback-unavailable');}
   }else{
    const response=await accounts.request(snap.c,'/occ/v2/pharma/orgUsers/current/orders?fields=FULL&cartId='+encodeURIComponent(snap.body.cartId)+'&termsChecked=true&lang=en&curr=EGP',{method:'POST',body:'',form:true});
    if(!safeId(response.code))throw Error('order-response-unverified');ids=[String(response.code)];
    const r=await accounts.request(snap.c,'/occ/v2/pharma/users/current/orders/'+encodeURIComponent(ids[0])+'?fields=FULL&lang=en&curr=EGP');if(String(r.code)!==ids[0])throw Error('order-readback-unavailable');
   }
   const receipt={ok:true,state:'verified',supplierId:p.supplierId,orderIds:ids,total:snap.view.total,currency:snap.view.currency,verifiedAt:new Date().toISOString()};
   await journal.finish(input.signature,'verified',receipt);return receipt;
  }catch{
   const result={ok:false,state:'unknown',supplierId:p.supplierId,orderIds:ids,error:'order-outcome-unknown'};
   await journal.finish(input.signature,'unknown',result);return result;
  }
 }
 async function status(input){
  const p=await plans.unpack(input,true);if(p.kind!=='supplier-order')throw Error('cart-plan-invalid');
  const old=await journal.lookup(input.signature);if(!old)return {ok:false,state:'not-started',error:'order-not-started'};
  if(old.state==='verified')return JSON.parse(old.receipt);
  let receipt;try{receipt=JSON.parse(old.receipt||'null');}catch{}
  const ids=receipt?.orderIds||[];
  if(ids.length===p.orderCount&&ids.every(safeId)){
   try{const c=await accounts.context(p.supplierId);for(const id of ids){const r=await accounts.request(c,p.supplierId==='aumet'?'/api/v2/order/'+id:'/occ/v2/pharma/users/current/orders/'+encodeURIComponent(id)+'?fields=FULL&lang=en&curr=EGP');if(String(p.supplierId==='aumet'?r.data?.id:r.code)!==id)throw Error('order-readback-unavailable');}
    const verified={ok:true,state:'verified',supplierId:p.supplierId,orderIds:ids,total:p.total,currency:p.currency,verifiedAt:new Date().toISOString()};await journal.finish(input.signature,'verified',verified);return verified;
   }catch{/* Outcome remains unresolved; never resubmit. */}
  }
  return {ok:false,state:old.state,orderIds:ids,error:old.state==='failed'?'order-not-started':'order-outcome-unknown'};
 }
 return {preview,apply,status,snapshot};
}
