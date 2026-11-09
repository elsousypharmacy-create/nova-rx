import { createAumetCart } from './aumet-cart.js';
import { createPharmaOverseasCart } from './pharmaoverseas-cart.js';
import { createOperationJournal } from './operation-journal.js';
import { createSignedPlans } from './signed-plan.js';
export function createSupplierCartService(options){
 const adapters={aumet:createAumetCart(options),pharmaoverseas:createPharmaOverseasCart(options)};
 const plans=createSignedPlans(options.secret),journal=createOperationJournal(options.db);
 function adapter(id){if(!adapters[id])throw Error('cart-not-supported');return adapters[id];}
 async function preview(id,line){return adapter(id).preview(line);}
 async function apply(id,input){
  const p=await plans.unpack(input,true);
  if(id==='aumet'?p.version!==1:p.kind!=='po-cart')throw Error('cart-plan-invalid');
  const old=await journal.lookup(input.signature);if(old?.state==='verified')return {...JSON.parse(old.receipt),alreadyApplied:true};
  if(p.expires<Date.now())throw Error('cart-plan-expired');
  const claim=await journal.claim(input.signature,id);
  if(!claim.claimed)return claim.receipt;
  let result;
  try{result=await adapter(id).apply(input);}
  catch(e){
   const preflight=/^cart-(?:plan-|session-|conflict$|payment-|duplicate-lines|schema-changed$)/.test(e.message);
   await journal.finish(input.signature,preflight?'failed':'unknown');throw e;
  }
  await journal.finish(input.signature,result.ok&&result.state==='verified'?'verified':'unknown',result);
  return result;
 }
 return {preview,apply,adapters};
}
