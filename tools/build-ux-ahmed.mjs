// Local-only UX build. No commit, push, workflow dispatch, credentials or deployment.
// Preserve Worker logic and asset routing; refresh only app HTML, SW/PWA and changed purchase UI bodies.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const base='worker/live/nova-rx-preview.ux-406.js';
const out=process.argv[2]||'worker/live/nova-rx-preview.ux-407.js';
const run=(file,...args)=>execFileSync(process.execPath,[file,...args],{stdio:'pipe'});
run('tools/build-worker-artifact.mjs',base,'index.html',out,'--sw','sw.js');
run('tools/inject-pwa-assets.mjs',out);
run('tools/whatsapp-spa.mjs','--inject',out);
let code=readFileSync(out,'utf8');const pattern=/const NOVA_PURCHASING_ASSETS=(.*);/;
const matches=[...code.matchAll(new RegExp(pattern.source,'g'))];
if(matches.length!==1)throw Error('Expected exactly one purchasing asset table');
const table=JSON.parse(matches[0][1]);
for(const [route,path] of [['/purchases','purchases.html'],['/purchases.html','purchases.html'],['/purchases.css','purchases.css'],['/purchases.js','purchases.js'],['/supplier-status.js','supplier-status.js']]){
 if(!table[route]||typeof table[route].body!=='string')throw Error('Missing purchase UI route '+route);
 table[route].body=readFileSync(path,'utf8');
}
code=code.replace(pattern,()=>`const NOVA_PURCHASING_ASSETS=${JSON.stringify(table)};`);
writeFileSync(out,code);
console.log('Built local UX artifact:',out,'(not deployed)');
