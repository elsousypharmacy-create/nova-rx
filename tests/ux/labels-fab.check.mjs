import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const h=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
assert.match(h,/\.nova-page-view\{padding-bottom:calc\(72px/,'page-view bottom padding rule');
assert.match(h,/\.totals-breakdown\{margin-bottom:72px\}/,'totals spacing rule');
assert.match(h,/@media\(max-width:600px\)\{#novaAiLaunch\{[^}]*border-radius:50%/,'icon-only round FAB <=600px');
assert.match(h,/<button id="novaAiLaunch"[^>]*aria-label="طباعة استيكرات الأدوية"/,'Arabic aria-label');
assert.match(h,/body:not\(\[data-active-page="products"\]\) #novaAiLaunch\{display:none!important\}/,'UX41: FAB hidden outside products page');

// UX41 geometry: at both viewports on every page the FAB (when displayed) must not intersect rows, checkout, toasts or modal footers.
const {chromium}=await import('@playwright/test');
const BASE=process.env.NOVA_URL||'http://127.0.0.1:8765/';
const snapshot=readFileSync(new URL('../../data/emergency-stock.json',import.meta.url),'utf8');
const hit=(a,b)=>!(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
try{
 for(const vp of [{width:390,height:844},{width:1366,height:768}]){
  const ctx=await browser.newContext({viewport:vp,locale:'ar-EG'});
  await ctx.route('**/*',r=>{const u=r.request().url();return u.startsWith(new URL(BASE).origin)||u.startsWith('data:')?r.continue():r.abort()});
  const page=await ctx.newPage();
  await page.route('**/emergency/stock.json',r=>r.fulfill({status:200,contentType:'application/json',body:snapshot}));
  await page.addInitScript(()=>{try{localStorage.setItem('nova-rx-language','ar')}catch{}});
  await page.goto(BASE,{waitUntil:'load'});
  await page.waitForFunction(()=>window.novaPay,null,{timeout:8000});
  for(const pg of ['sale','products','customers','reports','settings']){
   await page.locator(`.nova-tab[data-page="${pg}"]`).click();
   await page.waitForTimeout(200);
   const fab=page.locator('#novaAiLaunch');
   const vis=await fab.isVisible();
   if(pg!=='products')assert.ok(!vis,`${vp.width}: FAB must be hidden on ${pg}`);
   if(!vis)continue;
   const f=await fab.boundingBox();
   for(const sel of ['tr','#btnCheckout','.toast','.modal-footer,.modal.active footer,.modal-actions']){
    const els=page.locator(sel);
    for(let i=0;i<await els.count();i++){
     const e=els.nth(i);if(!await e.isVisible())continue;
     const b=await e.boundingBox();
     if(b)assert.ok(!hit(f,b),`${vp.width}/${pg}: FAB overlaps ${sel}[${i}]`);
    }
   }
  }
  await ctx.close();
 }
}finally{await browser.close()}
console.log('labels-fab check passed');
