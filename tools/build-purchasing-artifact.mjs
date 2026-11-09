// Add the purchasing page without replacing the deployed POS/AI/admin routes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const [base,out]=process.argv.slice(2);
if(!base||!out)throw new Error('Usage: node tools/build-purchasing-artifact.mjs BASE OUT');
const dir=fs.mkdtempSync(path.join(tmpdir(),'nova-purchases-'));
const run=(tool,...args)=>execFileSync('node',['tools/'+tool,...args],{stdio:'pipe'}).toString();
const supplier=path.join(dir,'suppliers.js'),app=path.join(dir,'app.html'),assembled=path.join(dir,'assembled.js');
run('build-supplier-artifact.mjs',base,supplier);run('build-worker-artifact.mjs','--extract',supplier,app);
let html=fs.readFileSync(app,'utf8');
if(!html.includes('id="novaPurchasesNav"')){
 const anchor='<button class="nova-tab" data-page="settings">';
 if(!html.includes(anchor))throw new Error('navigation anchor missing');
 html=html.replace(anchor,'<a id="novaPurchasesNav" class="nova-tab" style="text-decoration:none;display:inline-flex;align-items:center" href="/purchases">المشتريات</a>'+anchor);
}
fs.writeFileSync(app,html);run('build-worker-artifact.mjs',supplier,app,assembled);
let code=fs.readFileSync(assembled,'utf8');
const assets=[['/purchases','purchases.html','text/html'],['/purchases.html','purchases.html','text/html'],['/purchases.css','purchases.css','text/css'],['/purchases.js','purchases.js','application/javascript'],['/purchases-core.js','purchases-core.js','application/javascript'],['/supplier-provider.js','supplier-provider.js','application/javascript'],['/worker/procurement/normalize.js','worker/procurement/normalize.js','application/javascript']];
const block='/* NOVA_PURCHASING_ASSETS_BEGIN */\nconst NOVA_PURCHASING_ASSETS='+JSON.stringify(Object.fromEntries(assets.map(([route,file,type])=>[route,{body:fs.readFileSync(file,'utf8'),type}])))+';\n/* NOVA_PURCHASING_ASSETS_END */\n';
const listener="addEventListener('fetch', event => { const url=new URL(event.request.url);";
if(!code.includes(listener))throw new Error('fetch listener missing');
const route="if(NOVA_PURCHASING_ASSETS[url.pathname]){const a=NOVA_PURCHASING_ASSETS[url.pathname];event.respondWith(new Response(a.body,{headers:{'Content-Type':a.type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}));return;}";
code=code.replace(listener,block+listener+route);
fs.writeFileSync(out,code);console.log(JSON.stringify({out,bytes:Buffer.byteLength(code),sha256:createHash('sha256').update(code).digest('hex')}));
