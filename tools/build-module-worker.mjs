// Adapts the existing fetch listener without rewriting its POS/settings/AI routes.
// Per-env runtimes preserve existing in-isolate rate limits and supplier caches.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('input/output required');
const source=fs.readFileSync(input,'utf8');if(/^export default/m.test(source))throw Error('already a module');
const code=`// NOVA_MODULE_ADAPTER_V1\nconst NOVA_RUNTIMES=new WeakMap();\nfunction novaRuntime(env){\nconst {GEMINI_API_KEY,NOVA_API_PIN,NOVA_INGEST_SECRET,NOVA_SECRET_ENCRYPTION_KEY,NOVA_SECRETS_KV,NOVA_PURCHASE_OPS}=env;\nlet listener;\nconst addEventListener=(type,callback)=>{if(type!=='fetch'||listener)throw Error('unexpected Worker listener');listener=callback;};\n${source}\nif(!listener)throw Error('fetch listener missing');return listener;\n}\nexport default {fetch(request,env,ctx){\nlet listener=NOVA_RUNTIMES.get(env);if(!listener){listener=novaRuntime(env);NOVA_RUNTIMES.set(env,listener);}\nlet response;listener({request,respondWith(value){if(response!==undefined)throw Error('duplicate response');response=value;},waitUntil:ctx.waitUntil.bind(ctx),passThroughOnException:ctx.passThroughOnException.bind(ctx)});\nif(response===undefined)throw Error('fetch listener did not respond');return Promise.resolve(response);\n}};\n`;
fs.writeFileSync(output,code);console.log(JSON.stringify({output,bytes:Buffer.byteLength(code),sha256:createHash('sha256').update(code).digest('hex')}));
