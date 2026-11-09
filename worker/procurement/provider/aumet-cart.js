// Owner-account cart only. Observed Aumet v2 request, absolute quantities, signed
// short-lived plans and read-back. Never calls an order/checkout endpoint.
function fail(code){throw new Error(code);}
const id=x=>/^\d+$/.test(String(x??''))?String(x):null;
const enc=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export function createAumetCart({store,hub,secret,fetch:fetchImpl=globalThis.fetch,now=()=>Date.now()}){
 async function sign(value){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(value)));}
 async function context(){
  const rec=await store.load('aumet'),s=rec?.session,t=s?.cartRequestTemplate;
  if(!s||!t||t.method!=='POST'||!/^\/api\/v2\/cart\/\d+\/items$/.test(t.path)||!id(t.body?.entity_id)||!id(t.body?.payment_method_id))fail('cart-session-required');
  const cart=t.path.match(/\/cart\/(\d+)\//)[1];
  return {s,t,cart,binding:await sign(t.path+'|'+rec.savedAt)};
 }
 async function request(c,path,body){
  const res=await fetchImpl('https://marketplace.aumet.com'+path,{method:body?'POST':'GET',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:c.s.authorization||'',Cookie:c.s.cookie||'','X-XSRF-TOKEN':c.s.xsrf||'','X-Requested-With':'XMLHttpRequest'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(res.status===401||res.status===403)fail('cart-session-required');
  if(!res.ok)fail('cart-upstream-error');
  try{return await res.json();}catch{fail('cart-schema-changed');}
 }
 async function read(c){const d=await request(c,`/api/cart/${c.cart}/products-quantities`);const rows=d?.data?.product_in_cart??d?.product_in_cart;if(!Array.isArray(rows))fail('cart-schema-changed');return rows;}
 function existing(rows,product,seller,payment){
  const same=rows.filter(r=>String(r.entity_product_id)===product);
  if(same.some(r=>String(r.entity_seller_id)!==seller||String(r.payment_method_id)!==payment))fail('cart-payment-conflict');
  if(rows.some(r=>String(r.entity_seller_id)===seller&&String(r.payment_method_id)!==payment))fail('cart-payment-conflict');
  if(same.length>1)fail('cart-duplicate-lines');
  const n=same.length?Number(same[0].quantity):0;
  if(!Number.isInteger(n)||n<0)fail('cart-schema-changed');return n;
 }
 async function preview(line){
  if(!line||!id(line.productId)||!id(line.sellerId)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>10000||typeof line.query!=='string'||line.query.length>200||!Number.isFinite(line.price))fail('bad-request');
  const c=await context(),product=id(line.productId),seller=id(line.sellerId),payment=id(c.t.body.payment_method_id);
  if(!(c.s.sellers||[]).some(s=>String(s.id)===seller&&!s.locked))fail('cart-seller-unavailable');
  const fresh=await hub.search(line.query,{supplierIds:['aumet'],requestedQty:line.quantity});
  const offer=(fresh.results||[]).flatMap(r=>r.offers||[]).map(r=>r.offer||r).find(o=>o.supplierId==='aumet'&&String(o.supplierProductId)===product&&String(o.sellerId)===seller);
  if(!offer||offer.unitPrice!==line.price||!['in_stock','low'].includes(offer.stockStatus))fail('cart-offer-changed');
  const methods=offer.raw?.paymentMethod;
  if(!Array.isArray(methods)||!methods.some(m=>String(m.id)===payment))fail('cart-payment-unverified');
  const rows=await read(c),before=existing(rows,product,seller,payment),target=before+line.quantity;
  if(Number.isFinite(offer.availableQuantity)&&target>offer.availableQuantity)fail('cart-stock-changed');
  const payload={version:1,expires:now()+120000,binding:c.binding,product,seller,payment,before,target,price:line.price};
  const value=JSON.stringify(payload);return {ok:true,plan:value,signature:await sign(value),before,quantity:line.quantity,target,expires:payload.expires};
 }
 async function apply({plan,signature}={}){
  if(typeof plan!=='string'||plan.length>2000||typeof signature!=='string'||signature.length!==64)fail('bad-request');
  const expected=await sign(plan);let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^signature.charCodeAt(i);if(diff)fail('cart-plan-invalid');
  let p;try{p=JSON.parse(plan);}catch{fail('cart-plan-invalid');}
  if(p.expires<now())fail('cart-plan-expired');
  const c=await context();if(p.binding!==c.binding)fail('cart-session-changed');
  const beforeRows=await read(c),current=existing(beforeRows,p.product,p.seller,p.payment);
  if(current===p.target)return {ok:true,state:'verified',quantity:p.target,alreadyApplied:true};
  if(current!==p.before)fail('cart-conflict');
  let writeError=false;
  try{await request(c,c.t.path,{entity_id:c.t.body.entity_id,quantity:p.target,entity_product_id:Number(p.product),payment_method_id:Number(p.payment),withoutCartResponse:1,with_replace:1,source:null});}catch{writeError=true;}
  // A timeout is never retried as a mutation; read the actual account cart.
  let after;try{after=existing(await read(c),p.product,p.seller,p.payment);}catch{return {ok:false,state:'unknown',error:'cart-readback-unavailable'};}
  if(after===p.target)return {ok:true,state:'verified',quantity:after};
  return {ok:false,state:after===p.before?'not-added':'conflict',error:writeError?'cart-upstream-error':'cart-readback-mismatch',quantity:after};
 }
 return {preview,apply};
}
