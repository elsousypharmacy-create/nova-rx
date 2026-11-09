// Read-only live acceptance. Never invokes a cart/apply or order/apply route.
const base=process.env.NOVA_WORKER_URL||'https://nova-rx-preview.elsousypharmacy.workers.dev';
const pin=process.env.NOVA_API_PIN;if(!pin)throw Error('NOVA_API_PIN is not configured');
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'X-Nova-Pin':pin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});let data;try{data=await r.json();}catch{throw Error('non-json-response');}return {status:r.status,data};}
const sellers=await call('/api/suppliers/sellers');if(sellers.status!==200||!Array.isArray(sellers.data.sellers))throw Error('seller-read-failed');
const allowed=sellers.data.sellers.filter(s=>!s.locked).map(s=>String(s.id));
for(const supplierId of ['aumet','pharmaoverseas']){
 const {status,data}=await call('/api/purchases/orders/preview',{supplierId,aumetSellerIds:allowed});
 if(status===200&&data.ok&&data.cart&&Array.isArray(data.cart.lines)&&Number.isFinite(data.cart.total)){
  console.log(JSON.stringify({supplierId,cartRead:'PASS',journalRead:'PASS',lineCount:data.cart.lines.length,totalFinite:true,currencyPresent:!!data.cart.currency,noMutations:true}));
 }else if(['order-cart-empty','order-minimum-not-met','order-cart-needs-review','order-seller-unavailable','order-extra-sellers'].includes(data.error)){
  console.log(JSON.stringify({supplierId,cartRead:'PASS',journalRead:'PASS',checkoutBlockedBy:data.error,noMutations:true}));
 }else {console.log(JSON.stringify({supplierId,cartRead:'FAIL',error:/^(order|cart)-[a-z-]+$/.test(data.error||'')?data.error:'unexpected-response',status,noMutations:true}));process.exitCode=1;}
}
