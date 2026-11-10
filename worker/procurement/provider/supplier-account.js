// Only these two pharmacy-owned storefronts are reachable. Never accepts a URL from the client.
export function createSupplierAccounts({store,fetch:fetchImpl=globalThis.fetch}){
 async function context(supplier){
  if(!['aumet','pharmaoverseas'].includes(supplier))throw Error('cart-not-supported');
  let record;try{record=await store.load(supplier);}catch{throw Error('cart-session-load-failed');}const s=record?.session;
  if(!s)throw Error('cart-session-required');
  if(supplier==='aumet'){
   const t=s.cartRequestTemplate;if(!t||!/^\/api\/v2\/cart\/\d+\/items$/.test(t.path)||!/^\d+$/.test(String(t.body?.entity_id)))throw Error('cart-session-required');
   return {supplier,s,record,cart:t.path.match(/\/cart\/(\d+)\//)[1],entity:String(t.body.entity_id)};
  }
  if(!s.accessToken)throw Error('cart-session-required');return {supplier,s,record};
 }
 async function request(c,path,{method='GET',body,form=false}={}){
  const a=c.supplier==='aumet';
  if(a?!path.startsWith('/api/'):!path.startsWith('/occ/v2/pharma/'))throw Error('cart-invalid-path');
  const headers={Accept:'application/json','Content-Type':form?'application/x-www-form-urlencoded':'application/json'};
  if(a)Object.assign(headers,{Authorization:c.s.authorization||'',Cookie:c.s.cookie||'','X-XSRF-TOKEN':c.s.xsrf||'','X-Requested-With':'XMLHttpRequest'});
  else headers.Authorization='Bearer '+c.s.accessToken;
  let r;try{r=await fetchImpl((a?'https://marketplace.aumet.com':'https://api.pharmaemarket.com')+path,{method,headers,...(body!==undefined?{body:form?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'manual'});}catch(e){throw Error(e.name==='TypeError'?'cart-request-runtime-error':'cart-network-error');}
  if(r.status>=300&&r.status<400)throw Error('cart-upstream-redirect');
  if(r.status===401||r.status===403)throw Error('cart-session-required');if(!r.ok)throw Error('cart-upstream-error');
  let d;try{d=await r.json();}catch{throw Error('cart-schema-changed');}return d;
 }
 return {context,request};
}
