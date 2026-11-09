// Atomic cross-isolate claim. An uncertain upstream mutation never expires/unlocks itself.
export function createOperationJournal(db,now=()=>new Date().toISOString()) {
 const requireDb=()=>{if(!db?.prepare)throw Error('cart-journal-unavailable');};
 async function lookup(id){requireDb();return db.prepare('SELECT id,scope,state,receipt FROM supplier_operations WHERE id=?').bind(id).first();}
 async function claim(id,scope){
  requireDb();const at=now();
  const r=await db.prepare("INSERT OR IGNORE INTO supplier_operations(id,scope,state,created_at,updated_at) VALUES(?,?,'pending',?,?)").bind(id,scope,at,at).run();
  if(r.meta?.changes===1)return {claimed:true};
  const old=await lookup(id);
  if(old?.state==='verified')return {claimed:false,receipt:JSON.parse(old.receipt)};
  throw Error(old?'cart-operation-pending':'cart-account-busy');
 }
 async function finish(id,state,receipt){
  requireDb();if(!['unknown','verified','failed'].includes(state))throw Error('cart-journal-invalid-state');
  const r=await db.prepare('UPDATE supplier_operations SET state=?,receipt=?,updated_at=? WHERE id=? AND state IN (\'pending\',\'unknown\')').bind(state,receipt?JSON.stringify(receipt):null,now(),id).run();
  if(r.meta?.changes!==1)throw Error('cart-journal-write-failed');
 }
 return {lookup,claim,finish};
}
