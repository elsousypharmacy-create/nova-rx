// Baseline-only audit. All UI files read from the agreed main SHA; no real network, payments, carts or personal data.
import {chromium} from '@playwright/test';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const SHA='7bcd919cf2dc01c88bf20f31486034b141c013d2',OUT='/workspace/scratch/ac0daa6ab513/ux-payment-after';fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const cache=new Map(),evidence={sha:SHA,synthetic:true,requests:[],screens:{},pageErrors:[]};
function baseline(file){return fs.readFileSync(file)}
const stock={source:'STOCK LIVE',exportedAt:'2026-11-16T12:00:00Z',items:Array.from({length:60},(_,i)=>({code:String(990000+i),namear:i===0?'صنف اختبار 500G — بيانات وهمية':`صنف اختبار ${i+1} — بيانات وهمية`,nameen:i===0?'TEST ITEM 500G':`TEST ITEM ${i+1} 20mg`,price:100+i}))};
async function open(route='sale',width=1280,height=800,purchases=false){
 const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',locale:'ar-EG'});
 await context.addInitScript(()=>{localStorage.setItem('nova-rx-language','ar');localStorage.setItem('novaApiPin','isolated-fake');window.NOVA_STOCK_PROBE=true;});
 await context.route('**/*',r=>{const q=r.request(),u=new URL(q.url());
  if(u.pathname.includes('/api/')){evidence.requests.push({method:q.method(),path:u.pathname,intercepted:true});
   if(u.pathname==='/api/suppliers/status')return r.fulfill({json:{suppliers:[{id:'aumet',name:'أوميت',state:'expired'},{id:'pharmaoverseas',name:'فارما أوفرسيز',state:'off'}]}});
   if(u.pathname.includes('/inbox/history/'))return r.fulfill({json:{ok:true,conversations:[],enabled:false}});
   return r.fulfill({status:503,json:{ok:false,error:'isolated-audit-no-operation'}});
  }
  if(u.origin!=='http://nova-audit.test'||q.method()!=='GET')return r.abort();
  if(u.pathname==='/emergency/stock.json')return r.fulfill({json:stock});
  let rel=u.pathname.replace(/^\//,'');if(!rel||rel==='whatsapp')rel='index.html';if(rel==='purchases')rel='purchases.html';
  if(rel.includes('..'))return r.abort();
  try{return r.fulfill({body:baseline(rel),contentType:rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(rel)?'application/javascript':rel.endsWith('.svg')?'image/svg+xml':'application/octet-stream'})}catch{return r.fulfill({status:404,body:''})}
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>evidence.pageErrors.push(e.message));
 await page.goto('http://nova-audit.test/'+(purchases?'purchases':'index.html#'+route));
 if(!purchases){await page.locator('#novaSplash').waitFor({state:'hidden'});await page.waitForFunction(()=>window.novaCatalog?.source==='STOCK LIVE');}
 return {page,context};
}
async function shot(id,page,detail){await page.screenshot({path:`${OUT}/${id}-after.png`});evidence.screens[id]={file:`${id}-after.png`,viewport:page.viewportSize(),url:page.url(),...detail};console.log('CAPTURED',id);}
async function addProduct(page){await page.locator('#mainSearchInput').fill('990000');await page.locator('#suggestionsBox .suggestion-item').first().click();}
async function checkout(page){await addProduct(page);await page.locator('#btnCheckout').click();await page.locator('#checkoutModal.active').waitFor();await page.waitForTimeout(250);}
try{for(const [w,h] of [[1280,800],[1280,720],[390,844]]){const {page,context}=await open('sale',w,h);await checkout(page);await page.locator('[data-method=split]').click();await page.waitForTimeout(400);const g=await page.locator('#btnConfirmPayment').boundingBox();if(!g||g.y<0||g.y+g.height>h)throw Error('Confirmation outside viewport '+w+'x'+h+JSON.stringify(g));await shot('13-'+w+'x'+h,page,{geometry:g});await context.close();}console.log('PASS checkout confirmation visible at all 3 sizes')}finally{await browser.close()}
