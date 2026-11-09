export function createSignedPlans(secret,now=()=>Date.now()){
 const enc=new TextEncoder();let key;
 async function sign(value){key??=crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await key,enc.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
 async function pack(payload){const plan=JSON.stringify({...payload,expires:now()+120000});return {ok:true,plan,signature:await sign(plan),expires:now()+120000};}
 async function unpack({plan,signature}={},allowExpired=false){
  if(typeof plan!=='string'||plan.length>150000||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))throw Error('cart-plan-invalid');
  const expected=await sign(plan);let diff=0;for(let i=0;i<64;i++)diff|=signature.charCodeAt(i)^expected.charCodeAt(i);if(diff)throw Error('cart-plan-invalid');
  let p;try{p=JSON.parse(plan);}catch{throw Error('cart-plan-invalid');}
  if(!allowExpired&&(!Number.isFinite(p.expires)||p.expires<now()))throw Error('cart-plan-expired');return p;
 }
 return {sign,pack,unpack};
}
